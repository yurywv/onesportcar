import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { headers } from "next/headers";
import { requireUser, assertUser, hashPassword } from "@/lib/auth";
import { createPasswordToken, checkPasswordStrength, unusableHash } from "@/lib/password";
import { ROLE_LABEL, ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { run, req, str, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { dateTime, parseMoney, centsToInput } from "@/lib/format";
import { isValidEmail } from "@/lib/validators";
import { PageHeader, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Usuários" };

async function linkBase() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https")}://${host}`;
}

async function passwordLink(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return run(async () => {
    const admin = await assertUser("admin:usuarios");
    const id = String(fd.get("id"));
    const token = await db.$transaction(async (tx) => {
      const t = await createPasswordToken(tx, id, "REDEFINICAO", admin.id);
      await audit({ action: "PASSWORD_LINK", entity: "User", entityId: id, userId: admin.id, userName: admin.name }, tx);
      return t;
    });
    return { message: "Link gerado (válido por 48 h, uso único). Envie somente ao próprio usuário.", data: { link: `${await linkBase()}/definir-senha/${token}` } };
  });
}

async function saveUser(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return run(async () => {
    const admin = await assertUser("admin:usuarios");
    const id = str(fd, "id");
    const role = String(fd.get("role")) as Role;
    if (!(role in ROLE_LABEL)) throw new RuleError("Perfil inválido.");
    const email = req(fd, "email", "E-mail").toLowerCase();
    if (!isValidEmail(email)) throw new RuleError("E-mail inválido.");
    const password = str(fd, "password");
    if (password) checkPasswordStrength(password);
    if (id === admin.id && (role !== admin.role || !bool(fd, "active"))) throw new RuleError("Você não pode alterar o próprio perfil nem se desativar.");
    const data = {
      name: req(fd, "name", "Nome"), email, role, active: id ? bool(fd, "active") : true,
      specialties: str(fd, "specialties"), level: str(fd, "level"),
      hourlyRate: str(fd, "hourlyRate") ? parseMoney(fd.get("hourlyRate")) : null, hourlyCost: str(fd, "hourlyCost") ? parseMoney(fd.get("hourlyCost")) : null,
    };
    const token = await db.$transaction(async (tx) => {
      const before = id ? await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true, active: true, email: true } }) : null;
      const u = id
        ? await tx.user.update({ where: { id }, data: { ...data, ...(password && { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null }) } })
        : await tx.user.create({ data: { ...data, branchId: admin.branchId, passwordHash: password ? await hashPassword(password) : await unusableHash() } });
      if (id && (!data.active || password)) await tx.session.deleteMany({ where: { userId: id } });
      await audit({ action: id ? "UPDATE" : "CREATE", entity: "User", entityId: u.id, userId: admin.id, userName: admin.name, before, after: { email, role, active: data.active, passwordChanged: !!password } }, tx);
      return !id && !password ? await createPasswordToken(tx, u.id, "PRIMEIRO_ACESSO", admin.id) : null;
    });
    revalidatePath("/admin/usuarios");
    if (token) return { message: "Usuário criado. Envie o link de primeiro acesso ao próprio usuário (48 h, uso único):", data: { link: `${await linkBase()}/definir-senha/${token}` } };
    return id ? "Usuário atualizado." : "Usuário criado.";
  });
}

export default async function Users() {
  await requireUser("admin:usuarios");
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  const roles = Object.entries(ROLE_LABEL) as [Role, string][];
  const form = (u?: (typeof users)[number]) => (
    <ActionForm action={saveUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" reset={!u}>
      {u && <input type="hidden" name="id" value={u.id} />}
      <Field label="Nome *"><input name="name" className="input" required defaultValue={u?.name} /></Field>
      <Field label="E-mail *"><input name="email" type="email" className="input" required defaultValue={u?.email} /></Field>
      <Field label="Perfil"><select name="role" className="select" defaultValue={u?.role ?? "CONSULTOR"}>{roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label={u ? "Nova senha (opcional)" : "Senha inicial (opcional)"} hint={u ? undefined : "Em branco: o sistema gera um link de primeiro acesso"}><input name="password" type="password" className="input" autoComplete="new-password" /></Field>
      <Field label="Especialidades (técnico)"><input name="specialties" className="input" defaultValue={u?.specialties ?? ""} /></Field>
      <Field label="Nível"><input name="level" className="input" defaultValue={u?.level ?? ""} /></Field>
      <Field label="Valor/hora venda (R$)"><input name="hourlyRate" className="input" defaultValue={u?.hourlyRate ? centsToInput(u.hourlyRate) : ""} /></Field>
      <Field label="Custo/hora (R$)"><input name="hourlyCost" className="input" defaultValue={u?.hourlyCost ? centsToInput(u.hourlyCost) : ""} /></Field>
      {u && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Ativo</label>}
      <div className="flex items-end"><Submit>{u ? "Salvar" : "Criar usuário"}</Submit></div>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Usuários e perfis" subtitle="Desativar um usuário ou trocar a senha encerra as sessões abertas dele." />
      <div className="card card-pad mb-5"><h2 className="mb-3 font-semibold">Novo usuário</h2>{form()}</div>
      <div className="space-y-2">
        {users.map((u) => (
          <details key={u.id} className="card">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span><b>{u.name}</b> · {u.email}{!u.active && <span className="badge ml-2">inativo</span>}{u.lockedUntil && u.lockedUntil > new Date() && <span className="badge badge-danger ml-2">bloqueado</span>}</span>
              <span className="text-muted">{ROLE_LABEL[u.role]} · último acesso {dateTime(u.lastLoginAt)}</span>
            </summary>
            <div className="space-y-3 border-t border-line p-4">
              {form(u)}
              <ActionForm action={passwordLink}><input type="hidden" name="id" value={u.id} /><Submit className="btn btn-sm">Gerar link para o usuário definir a senha</Submit></ActionForm>
            </div>
          </details>
        ))}
      </div>
      <details className="card mt-6">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Matriz de permissões por perfil</summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="table text-xs">
            <thead><tr><th>Permissão</th>{roles.map(([k, l]) => <th key={k} className="text-center">{l}</th>)}</tr></thead>
            <tbody>
              {Object.entries(PERMISSIONS).map(([p, label]) => (
                <tr key={p}><td>{label}<div className="font-mono text-[10px] text-muted">{p}</div></td>{roles.map(([k]) => <td key={k} className="text-center">{ROLE_PERMISSIONS[k].includes(p as keyof typeof PERMISSIONS) ? "●" : ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
