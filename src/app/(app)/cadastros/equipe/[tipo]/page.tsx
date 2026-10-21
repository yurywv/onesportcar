import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Prisma, Role } from "@prisma/client";
import { requireUser, assertUser } from "@/lib/auth";
import { can, ROLE_LABEL } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createPasswordToken, unusableHash } from "@/lib/password";
import { run, req, str, num, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { centsToInput, dateTime, money, parseMoney } from "@/lib/format";
import { isValidCPF, isValidEmail, onlyDigits } from "@/lib/validators";
import { PageHeader, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";

// Cadastros de equipe no padrão do SYSCAR (Mecânicos, Vendedores, Administradores).
// Cada pessoa é um usuário do sistema; o tipo define o perfil e os campos extras.

const TYPES = {
  mecanicos: { title: "Mecânicos", one: "mecânico", roles: ["TECNICO"] as Role[], defaultRole: "TECNICO" as Role, where: { role: "TECNICO" } as Prisma.UserWhereInput },
  vendedores: { title: "Vendedores", one: "vendedor", roles: ["CONSULTOR", "GESTOR", "CAIXA"] as Role[], defaultRole: "CONSULTOR" as Role, where: { OR: [{ isSeller: true }, { role: "CONSULTOR" }] } as Prisma.UserWhereInput },
  administradores: { title: "Administradores", one: "administrador", roles: ["ADMIN", "GESTOR", "FINANCEIRO", "AUDITOR"] as Role[], defaultRole: "GESTOR" as Role, where: { role: { in: ["ADMIN", "GESTOR"] } } as Prisma.UserWhereInput },
} as const;
type Tipo = keyof typeof TYPES;

async function linkBase() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https")}://${host}`;
}

async function saveMember(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return run(async () => {
    const tipo = String(fd.get("tipo")) as Tipo;
    const cfg = TYPES[tipo];
    if (!cfg) throw new RuleError("Tipo inválido.");
    const id = str(fd, "id");
    // Criar pessoa (= usuário com acesso) ou mudar perfil/e-mail exige administração de usuários; o resto, gestor.
    const user = await assertUser(id ? "equipe:editar" : "admin:usuarios");
    const isAdmin = can(user.role, "admin:usuarios");
    const cpf = str(fd, "document") ? onlyDigits(str(fd, "document")!) : null;
    if (cpf && !isValidCPF(cpf)) throw new RuleError("CPF inválido.");
    const pct = (k: string) => {
      const v = num(fd, k);
      if (v !== null && (v < 0 || v > 100)) throw new RuleError("Comissão deve estar entre 0 e 100%.");
      return v;
    };
    const data: Prisma.UserUncheckedUpdateInput = {
      name: req(fd, "name", "Nome"), phone: str(fd, "phone"), document: cpf,
      commissionServicePct: pct("commissionServicePct"), commissionPartPct: pct("commissionPartPct"),
      isSeller: tipo === "vendedores" ? true : bool(fd, "isSeller"),
    };
    if (tipo === "mecanicos") {
      Object.assign(data, {
        specialties: str(fd, "specialties"), level: str(fd, "level"), brands: str(fd, "brands"), certifications: str(fd, "certifications"),
        hourlyRate: str(fd, "hourlyRate") ? parseMoney(fd.get("hourlyRate")) : null, hourlyCost: str(fd, "hourlyCost") ? parseMoney(fd.get("hourlyCost")) : null,
      });
    }
    if (isAdmin) {
      const email = req(fd, "email", "E-mail").toLowerCase();
      if (!isValidEmail(email)) throw new RuleError("E-mail inválido.");
      const role = (String(fd.get("role") || cfg.defaultRole)) as Role;
      if (!(role in ROLE_LABEL)) throw new RuleError("Perfil inválido.");
      if (id === user.id && role !== user.role) throw new RuleError("Você não pode alterar o próprio perfil.");
      Object.assign(data, { email, role });
      if (id) data.active = bool(fd, "active");
      if (id === user.id && data.active === false) throw new RuleError("Você não pode se desativar.");
    }
    const token = await db.$transaction(async (tx) => {
      const before = id ? await tx.user.findUniqueOrThrow({ where: { id } }) : null;
      const u = id
        ? await tx.user.update({ where: { id }, data })
        : await tx.user.create({ data: { ...(data as Prisma.UserUncheckedCreateInput), branchId: user.branchId, passwordHash: await unusableHash() } });
      if (id && data.active === false) await tx.session.deleteMany({ where: { userId: id } });
      const { passwordHash: _p, ...safeBefore } = before ?? ({} as Record<string, unknown>);
      await audit({ action: id ? "UPDATE" : "CREATE", entity: "User", entityId: u.id, userId: user.id, userName: user.name, before: before ? safeBefore : null, after: data as object }, tx);
      return id ? null : await createPasswordToken(tx, u.id, "PRIMEIRO_ACESSO", user.id);
    });
    revalidatePath(`/cadastros/equipe/${tipo}`);
    if (token) return { message: `${cfg.one[0].toUpperCase() + cfg.one.slice(1)} cadastrado. Envie o link de primeiro acesso à própria pessoa (48 h, uso único):`, data: { link: `${await linkBase()}/definir-senha/${token}` } };
    return "Cadastro atualizado.";
  });
}

export default async function TeamRegistry({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  if (!(tipo in TYPES)) notFound();
  const cfg = TYPES[tipo as Tipo];
  const user = await requireUser("equipe:editar");
  const isAdmin = can(user.role, "admin:usuarios");
  const people = await db.user.findMany({ where: cfg.where, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const since = new Date(Date.now() - 30 * 86400_000);
  const stats = tipo === "vendedores"
    ? await db.workOrder.groupBy({ by: ["sellerId"], where: { sellerId: { in: people.map((p) => p.id) }, openedAt: { gte: since } }, _count: true })
    : tipo === "mecanicos"
      ? await db.workOrder.groupBy({ by: ["technicianId"], where: { technicianId: { in: people.map((p) => p.id) }, status: { notIn: ["ENTREGUE", "CANCELADA", "ENCERRADA_SEM_SERVICO"] }, legacy: false }, _count: true })
      : [];
  const count = (id: string) => (stats as { sellerId?: string | null; technicianId?: string | null; _count: number }[]).find((s) => s.sellerId === id || s.technicianId === id)?._count ?? 0;

  const form = (p?: (typeof people)[number]) => (
    <ActionForm action={saveMember} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" reset={!p}>
      <input type="hidden" name="tipo" value={tipo} />
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Nome *"><input name="name" className="input" required defaultValue={p?.name} /></Field>
      <Field label="E-mail (login) *"><input name="email" type="email" className="input" required defaultValue={p?.email} disabled={!isAdmin} /></Field>
      <Field label="Celular"><input name="phone" className="input" defaultValue={p?.phone ?? ""} inputMode="tel" /></Field>
      <Field label="CPF"><input name="document" className="input" defaultValue={p?.document ?? ""} inputMode="numeric" /></Field>
      {isAdmin && (
        <Field label="Perfil de acesso">
          <select name="role" className="select" defaultValue={p?.role ?? cfg.defaultRole}>{cfg.roles.concat(p && !cfg.roles.includes(p.role) ? [p.role] : []).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </Field>
      )}
      {tipo === "mecanicos" && (
        <>
          <Field label="Especialidades"><input name="specialties" className="input" defaultValue={p?.specialties ?? ""} placeholder="Motor, câmbio PDK, elétrica" /></Field>
          <Field label="Marcas habilitadas"><input name="brands" className="input" defaultValue={p?.brands ?? ""} placeholder="Porsche, Ferrari, McLaren" /></Field>
          <Field label="Certificações"><input name="certifications" className="input" defaultValue={p?.certifications ?? ""} placeholder="NR-10 (alta tensão)" /></Field>
          <Field label="Nível"><input name="level" className="input" defaultValue={p?.level ?? ""} placeholder="Júnior, Pleno, Sênior, Master" /></Field>
          <Field label="Valor/hora de venda (R$)"><input name="hourlyRate" className="input" inputMode="decimal" defaultValue={p?.hourlyRate ? centsToInput(p.hourlyRate) : ""} /></Field>
          <Field label="Custo/hora (R$)"><input name="hourlyCost" className="input" inputMode="decimal" defaultValue={p?.hourlyCost ? centsToInput(p.hourlyCost) : ""} /></Field>
        </>
      )}
      <Field label="Comissão sobre serviços (%)"><input name="commissionServicePct" className="input" inputMode="decimal" defaultValue={p?.commissionServicePct ?? ""} /></Field>
      <Field label="Comissão sobre produtos (%)"><input name="commissionPartPct" className="input" inputMode="decimal" defaultValue={p?.commissionPartPct ?? ""} /></Field>
      {tipo !== "vendedores" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isSeller" defaultChecked={p?.isSeller} /> Também atua como vendedor</label>}
      {p && isAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.active} /> Ativo</label>}
      <div className="flex items-end"><Submit>{p ? "Salvar" : `Cadastrar ${cfg.one}`}</Submit></div>
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title={cfg.title}
        subtitle={isAdmin ? `Cada ${cfg.one} recebe acesso ao sistema com o perfil escolhido. Sem senha no cadastro: o sistema gera um link de primeiro acesso.` : "Você pode ajustar comissões e dados profissionais. Novos cadastros e perfis de acesso são feitos por um administrador."}
        back={<Link href="/cadastros" className="link text-xs">← Cadastros</Link>}
      />
      {isAdmin && <div className="card card-pad mb-5"><h2 className="mb-3 font-semibold">Novo {cfg.one}</h2>{form()}</div>}
      {people.length ? (
        <div className="space-y-2">
          {people.map((p) => (
            <details key={p.id} className="card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><b>{p.name}</b> · {ROLE_LABEL[p.role]}{p.isSeller && tipo !== "vendedores" && " · vendedor"}{!p.active && <span className="badge ml-2">inativo</span>}</span>
                <span className="text-muted">
                  {tipo === "mecanicos" && <>{p.specialties ?? "—"} · {p.hourlyRate ? `${money(p.hourlyRate)}/h` : "sem valor/hora"} · {count(p.id)} OS em aberto</>}
                  {tipo === "vendedores" && <>comissão {p.commissionServicePct ?? 0}% serv. / {p.commissionPartPct ?? 0}% prod. · {count(p.id)} OS em 30 dias</>}
                  {tipo === "administradores" && <>último acesso {dateTime(p.lastLoginAt)}</>}
                </span>
              </summary>
              <div className="border-t border-line p-4">{form(p)}</div>
            </details>
          ))}
        </div>
      ) : <Empty>Nenhum {cfg.one} cadastrado.</Empty>}
    </>
  );
}
