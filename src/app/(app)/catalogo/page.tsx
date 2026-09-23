import { revalidatePath } from "next/cache";
import { requireUser, assertUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { run, req, str, int, bool, type ActionState } from "@/lib/action";
import { money, minutesLabel, parseMoney, centsToInput } from "@/lib/format";
import { PageHeader, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Catálogo de serviços" };

async function saveService(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return run(async () => {
    const user = await assertUser("catalogo:editar");
    const id = str(fd, "id");
    const fixed = str(fd, "fixedPrice");
    const data = {
      code: req(fd, "code", "Código").toUpperCase(), name: req(fd, "name", "Nome"), category: req(fd, "category", "Categoria"),
      standardMin: int(fd, "standardMin") ?? 60, hourlyRate: parseMoney(fd.get("hourlyRate")), fixedPrice: fixed ? parseMoney(fixed) : null, active: id ? bool(fd, "active") : true,
    };
    await db.$transaction(async (tx) => {
      const before = id ? await tx.serviceCatalog.findUnique({ where: { id } }) : null;
      const s = id ? await tx.serviceCatalog.update({ where: { id }, data }) : await tx.serviceCatalog.create({ data });
      await audit({ action: id ? "UPDATE" : "CREATE", entity: "ServiceCatalog", entityId: s.id, userId: user.id, userName: user.name, before, after: data }, tx);
    });
    revalidatePath("/catalogo");
    return "Serviço salvo.";
  });
}

export default async function Catalog() {
  const user = await requireUser("orcamento:editar");
  const edit = can(user.role, "catalogo:editar");
  const rows = await db.serviceCatalog.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader title="Catálogo de serviços" subtitle="Tabela de tempos (hora vendida) e valor/hora por serviço. Alterações de preço ficam na auditoria." />
      {edit && (
        <div className="card card-pad mb-5">
          <h2 className="mb-3 font-semibold">Novo serviço</h2>
          <ActionForm action={saveService} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" reset>
            <Field label="Código"><input name="code" className="input uppercase" required /></Field>
            <Field label="Nome" className="sm:col-span-2"><input name="name" className="input" required /></Field>
            <Field label="Categoria"><input name="category" className="input" required /></Field>
            <Field label="Tempo padrão (min)"><input name="standardMin" className="input" inputMode="numeric" defaultValue={60} /></Field>
            <Field label="Valor/hora (R$)"><input name="hourlyRate" className="input" inputMode="decimal" required /></Field>
            <Field label="Preço fechado (R$, opcional)"><input name="fixedPrice" className="input" inputMode="decimal" /></Field>
            <div className="flex items-end"><Submit>Adicionar</Submit></div>
          </ActionForm>
        </div>
      )}
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((s) => (
            <details key={s.id} className="card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><span className="font-mono text-xs text-muted">{s.code}</span> · <b>{s.name}</b> <span className="text-muted">({s.category})</span>{!s.active && <span className="badge ml-2">inativo</span>}</span>
                <span className="tabular-nums">{minutesLabel(s.standardMin)} · {money(s.hourlyRate)}/h · <b>{money(s.fixedPrice ?? Math.round(s.standardMin / 60 * s.hourlyRate))}</b></span>
              </summary>
              {edit && (
                <ActionForm action={saveService} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3 lg:grid-cols-6">
                  <input type="hidden" name="id" value={s.id} />
                  <Field label="Código"><input name="code" className="input uppercase" defaultValue={s.code} required /></Field>
                  <Field label="Nome" className="sm:col-span-2"><input name="name" className="input" defaultValue={s.name} required /></Field>
                  <Field label="Categoria"><input name="category" className="input" defaultValue={s.category} required /></Field>
                  <Field label="Tempo (min)"><input name="standardMin" className="input" defaultValue={s.standardMin} /></Field>
                  <Field label="Valor/hora (R$)"><input name="hourlyRate" className="input" defaultValue={centsToInput(s.hourlyRate)} /></Field>
                  <Field label="Preço fechado (R$)"><input name="fixedPrice" className="input" defaultValue={s.fixedPrice ? centsToInput(s.fixedPrice) : ""} /></Field>
                  <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} /> Ativo</label>
                  <div className="flex items-end"><Submit className="btn">Salvar</Submit></div>
                </ActionForm>
              )}
            </details>
          ))}
        </div>
      ) : <Empty>Nenhum serviço cadastrado.</Empty>}
    </>
  );
}
