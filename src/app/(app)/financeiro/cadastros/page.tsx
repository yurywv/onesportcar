import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader, Section } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveCategory } from "../actions";

export const metadata = { title: "Categorias e centros de custo" };

export default async function FinanceRegistry() {
  const user = await requireUser("financeiro:ver");
  const manage = can(user.role, "financeiro:contas");
  const [cats, centers] = await Promise.all([db.financialCategory.findMany({ orderBy: { code: "asc" } }), db.costCenter.findMany({ orderBy: { code: "asc" } })]);
  const row = (what: "category" | "center", r: { id: string; code: string; name: string; active: boolean }) => manage ? (
    <ActionForm key={r.id} action={saveCategory} className="grid grid-cols-[80px_1fr_auto_auto] items-center gap-2 border-b border-line py-1.5">
      <input type="hidden" name="what" value={what} /><input type="hidden" name="id" value={r.id} />
      <input name="code" className="input !min-h-8" defaultValue={r.code} /><input name="name" className="input !min-h-8" defaultValue={r.name} />
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={r.active} /> ativo</label>
      <Submit className="btn btn-sm">Salvar</Submit>
    </ActionForm>
  ) : <div key={r.id} className="border-b border-line py-1.5 text-sm">{r.code} · {r.name}{!r.active && " (inativo)"}</div>;
  return (
    <>
      <PageHeader title="Categorias e centros de custo" subtitle="Plano de contas gerencial simplificado — substituir pelo plano da contabilidade (decisão C5)." back={<Link href="/financeiro/contas" className="link text-xs">← Contas</Link>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Categorias">
          {(["RECEITA", "DESPESA"] as const).map((k) => (
            <div key={k} className="mb-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{k === "RECEITA" ? "Receitas" : "Despesas"}</h3>
              {cats.filter((c) => c.kind === k).map((c) => row("category", c))}
            </div>
          ))}
          {manage && (
            <ActionForm action={saveCategory} className="mt-3 grid grid-cols-[80px_1fr_130px_auto] gap-2" reset>
              <input type="hidden" name="what" value="category" />
              <input name="code" className="input" placeholder="2.08" required /><input name="name" className="input" placeholder="Nova categoria" required />
              <select name="kind" className="select"><option value="DESPESA">Despesa</option><option value="RECEITA">Receita</option></select>
              <Submit className="btn">Adicionar</Submit>
            </ActionForm>
          )}
        </Section>
        <Section title="Centros de custo">
          {centers.map((c) => row("center", c))}
          {manage && (
            <ActionForm action={saveCategory} className="mt-3 grid grid-cols-[80px_1fr_auto] gap-2" reset>
              <input type="hidden" name="what" value="center" />
              <input name="code" className="input" placeholder="COD" required /><input name="name" className="input" placeholder="Novo centro de custo" required />
              <Submit className="btn">Adicionar</Submit>
            </ActionForm>
          )}
        </Section>
      </div>
    </>
  );
}
