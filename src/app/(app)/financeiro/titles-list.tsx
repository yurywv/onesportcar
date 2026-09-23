import Link from "next/link";
import type { Prisma, TitleKind } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/finance";
import { PageHeader, Empty, Stat, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { TitleBadge } from "@/components/finance-ui";
import { newTitle } from "./actions";

export type TitleFilters = { status?: string; de?: string; ate?: string; q?: string; novo?: string };

const OFFSET = 3 * 3600_000;
const startOfToday = () => { const l = new Date(Date.now() - OFFSET); return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) + OFFSET); };
const ymd = (d: Date) => new Date(d.getTime() - OFFSET).toISOString().slice(0, 10);

export async function TitlesList({ kind, user, sp }: { kind: TitleKind; user: SessionUser; sp: TitleFilters }) {
  const receber = kind === "RECEBER";
  const today = startOfToday();
  const q = sp.q?.trim();
  const status = sp.status ?? "abertos";
  const where: Prisma.TitleWhereInput = {
    kind,
    ...(status === "abertos" && { status: { in: ["ABERTO", "PARCIAL"] } }),
    ...(status === "vencidos" && { status: { in: ["ABERTO", "PARCIAL"] }, dueDate: { lt: today } }),
    ...(status === "quitados" && { status: "PAGO" }),
    ...(status === "cancelados" && { status: "CANCELADO" }),
    ...((sp.de || sp.ate) && { dueDate: { gte: sp.de ? new Date(`${sp.de}T00:00:00-03:00`) : undefined, lte: sp.ate ? new Date(`${sp.ate}T23:59:59-03:00`) : undefined } }),
    ...(q && { OR: [
      { number: { contains: q.toUpperCase() } }, { description: { contains: q, mode: "insensitive" } }, { document: { contains: q, mode: "insensitive" } },
      { counterparty: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { supplier: { name: { contains: q, mode: "insensitive" } } },
      { supplier: { tradeName: { contains: q, mode: "insensitive" } } }, { workOrder: { number: { contains: q.toUpperCase() } } },
    ] }),
  };
  const openWhere: Prisma.TitleWhereInput = { kind, status: { in: ["ABERTO", "PARCIAL"] } };
  const [rows, allOpen, categories, centers, parties] = await Promise.all([
    db.title.findMany({ where, include: { customer: true, supplier: true, category: true, workOrder: true, purchaseOrder: true }, orderBy: [{ dueDate: "asc" }, { number: "asc" }], take: 300 }),
    db.title.findMany({ where: openWhere, select: { amount: true, settled: true, dueDate: true } }),
    db.financialCategory.findMany({ where: { active: true, kind: receber ? "RECEITA" : "DESPESA" }, orderBy: { code: "asc" } }),
    db.costCenter.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    receber ? db.customer.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const bal = (t: { amount: number; settled: number }) => t.amount - t.settled;
  const in7 = new Date(today.getTime() + 8 * 86400_000);
  const totalOpen = allOpen.reduce((s, t) => s + bal(t), 0);
  const overdue = allOpen.filter((t) => t.dueDate < today).reduce((s, t) => s + bal(t), 0);
  const dueToday = allOpen.filter((t) => t.dueDate >= today && t.dueDate < new Date(today.getTime() + 86400_000)).reduce((s, t) => s + bal(t), 0);
  const next7 = allOpen.filter((t) => t.dueDate >= today && t.dueDate < in7).reduce((s, t) => s + bal(t), 0);
  const listed = rows.reduce((s, t) => s + (t.status === "CANCELADO" ? 0 : bal(t)), 0);
  const label = receber ? "Contas a receber" : "Contas a pagar";
  const tabs: [string, string][] = [["abertos", "Em aberto"], ["vencidos", "Vencidos"], ["quitados", "Quitados"], ["cancelados", "Cancelados"], ["todos", "Todos"]];

  return (
    <>
      <PageHeader title={label} subtitle={receber ? "Cobranças de clientes (OS e lançamentos avulsos)" : "Obrigações com fornecedores e despesas"}
        actions={can(user.role, "financeiro:lancar") && <Link href="?novo=1" className="btn btn-primary">{receber ? "Nova cobrança" : "Nova conta a pagar"}</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total em aberto" value={money(totalOpen)} />
        <Stat label="Vencido" value={money(overdue)} tone={overdue ? "danger" : "ok"} />
        <Stat label="Vence hoje" value={money(dueToday)} tone={dueToday ? "warn" : undefined} />
        <Stat label="Próximos 7 dias" value={money(next7)} />
      </div>

      {sp.novo && can(user.role, "financeiro:lancar") && (
        <ActionForm action={newTitle} className="card card-pad mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <h2 className="font-semibold sm:col-span-2 lg:col-span-4">{receber ? "Nova cobrança" : "Nova conta a pagar"}</h2>
          <input type="hidden" name="kind" value={kind} />
          <Field label={receber ? "Cliente" : "Fornecedor"}>
            <select name={receber ? "customerId" : "supplierId"} className="select" defaultValue=""><option value="">— sem cadastro —</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          <Field label="Favorecido (se sem cadastro)"><input name="counterparty" className="input" placeholder={receber ? "Nome do pagador" : "Ex.: Concessionária de energia"} /></Field>
          <Field label="Descrição *" className="sm:col-span-2"><input name="description" className="input" required /></Field>
          <Field label="Categoria *"><select name="categoryId" className="select" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
          <Field label="Centro de custo"><select name="costCenterId" className="select" defaultValue=""><option value="">—</option>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Valor total (R$) *"><input name="amount" className="input" inputMode="decimal" required /></Field>
          <Field label="Forma prevista"><select name="method" className="select" defaultValue="BOLETO">{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="1º vencimento *"><input name="firstDue" type="date" className="input" required defaultValue={ymd(today)} /></Field>
          <Field label="Parcelas (dias)" hint="0 = única; 0/30/60 = 3 parcelas mensais"><input name="terms" className="input" defaultValue="0" /></Field>
          <Field label="Competência"><input name="competence" type="date" className="input" defaultValue={ymd(today)} /></Field>
          <Field label="Documento (NF, boleto, contrato)"><input name="document" className="input" /></Field>
          <Field label="Observações" className="sm:col-span-2 lg:col-span-3"><input name="notes" className="input" /></Field>
          <div className="flex items-end gap-2"><Submit>Lançar</Submit><Link href="?" className="btn">Fechar</Link></div>
        </ActionForm>
      )}

      <nav className="mb-3 flex flex-wrap gap-1">
        {tabs.map(([k, l]) => <Link key={k} href={`?${new URLSearchParams({ status: k, ...(q && { q }), ...(sp.de && { de: sp.de }), ...(sp.ate && { ate: sp.ate }) })}`} className={`btn btn-sm ${status === k ? "btn-primary" : ""}`}>{l}</Link>)}
      </nav>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Nº, descrição, documento, nome, OS" />
        <label className="text-xs text-muted">Vencimento de <input name="de" type="date" defaultValue={sp.de} className="input !min-h-9" /></label>
        <label className="text-xs text-muted">até <input name="ate" type="date" defaultValue={sp.ate} className="input !min-h-9" /></label>
        <button className="btn">Filtrar</button>
      </form>

      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Título</th><th>{receber ? "Cliente" : "Fornecedor"}</th><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th className="text-right">Valor</th><th className="text-right">Saldo</th><th>Situação</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/financeiro/titulos/${t.id}`} className="link">{t.number}</Link>{t.installments > 1 && <div className="text-xs text-muted">parcela {t.installment}/{t.installments}</div>}</td>
                  <td>{t.customer?.name ?? t.supplier?.tradeName ?? t.supplier?.name ?? t.counterparty}</td>
                  <td className="max-w-72">{t.description}{(t.workOrder || t.purchaseOrder) && <div className="text-xs">{t.workOrder && <Link href={`/os/${t.workOrder.id}?tab=entrega`} className="link">{t.workOrder.number}</Link>}{t.purchaseOrder && <Link href={`/compras/${t.purchaseOrder.id}`} className="link">{t.purchaseOrder.number}</Link>}</div>}</td>
                  <td className="text-xs">{t.category.name}</td>
                  <td className={t.dueDate < today && (t.status === "ABERTO" || t.status === "PARCIAL") ? "font-semibold text-danger" : ""}>{date(t.dueDate)}</td>
                  <td className="text-right tabular-nums">{money(t.amount)}</td>
                  <td className="text-right tabular-nums">{t.status === "CANCELADO" ? "—" : money(bal(t))}</td>
                  <td><TitleBadge status={t.status} dueDate={t.dueDate} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={6} className="text-right font-semibold">Saldo dos títulos listados</td><td className="text-right font-semibold tabular-nums">{money(listed)}</td><td /></tr></tfoot>
          </table>
        </div>
      ) : <Empty>Nenhum título encontrado.</Empty>}
    </>
  );
}
