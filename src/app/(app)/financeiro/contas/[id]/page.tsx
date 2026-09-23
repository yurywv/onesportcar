import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/finance";
import { PageHeader, Empty, Stat } from "@/components/ui";

const OFFSET = 3 * 3600_000;
const ymd = (d: Date) => new Date(d.getTime() - OFFSET).toISOString().slice(0, 10);

export default async function Statement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ de?: string; ate?: string }> }) {
  await requireUser("financeiro:ver");
  const { id } = await params;
  const sp = await searchParams;
  const acc = await db.financialAccount.findUnique({ where: { id } });
  if (!acc) notFound();
  const from = sp.de ? new Date(`${sp.de}T00:00:00-03:00`) : new Date(Date.now() - 30 * 86400_000);
  const to = sp.ate ? new Date(`${sp.ate}T23:59:59-03:00`) : new Date(Date.now() + 86400_000);
  const [settlements, tin, tout, before] = await Promise.all([
    db.settlement.findMany({ where: { accountId: id, date: { gte: from, lte: to } }, include: { title: { include: { customer: true, supplier: true } } } }),
    db.transfer.findMany({ where: { toAccountId: id, date: { gte: from, lte: to } }, include: { fromAccount: true } }),
    db.transfer.findMany({ where: { fromAccountId: id, date: { gte: from, lte: to } }, include: { toAccount: true } }),
    Promise.all([
      db.settlement.aggregate({ where: { accountId: id, date: { lt: from } }, _sum: { cash: true } }),
      db.transfer.aggregate({ where: { toAccountId: id, date: { lt: from } }, _sum: { amount: true } }),
      db.transfer.aggregate({ where: { fromAccountId: id, date: { lt: from } }, _sum: { amount: true } }),
    ]),
  ]);
  const opening = acc.openingBalance + (before[0]._sum.cash ?? 0) + (before[1]._sum.amount ?? 0) - (before[2]._sum.amount ?? 0);
  const lines = [
    ...settlements.map((s) => ({ key: s.id, date: s.date, at: s.createdAt, desc: `${s.number} · ${s.title.number} — ${s.title.customer?.name ?? s.title.supplier?.tradeName ?? s.title.supplier?.name ?? s.title.counterparty ?? ""}`, sub: `${s.title.description} · ${METHOD_LABEL[s.method] ?? s.method}${s.reversalOfId ? ` · ESTORNO: ${s.reason}` : ""}`, value: s.cash, href: `/financeiro/titulos/${s.titleId}` })),
    ...tin.map((t) => ({ key: t.id, date: t.date, at: t.createdAt, desc: `Transferência de ${t.fromAccount.name}`, sub: t.description ?? "", value: t.amount, href: null })),
    ...tout.map((t) => ({ key: t.id, date: t.date, at: t.createdAt, desc: `Transferência para ${t.toAccount.name}`, sub: t.description ?? "", value: -t.amount, href: null })),
  ].sort((a, b) => +a.date - +b.date || +a.at - +b.at);
  let bal = opening;
  const withBal = lines.map((l) => ({ ...l, bal: (bal += l.value) }));
  const ins = lines.filter((l) => l.value > 0).reduce((s, l) => s + l.value, 0);
  const outs = lines.filter((l) => l.value < 0).reduce((s, l) => s + l.value, 0);
  return (
    <>
      <PageHeader title={`Extrato — ${acc.name}`} back={<Link href="/financeiro/contas" className="link text-xs">← Contas</Link>} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">De <input name="de" type="date" defaultValue={ymd(from)} className="input !min-h-9" /></label>
        <label className="text-xs text-muted">até <input name="ate" type="date" defaultValue={ymd(to)} className="input !min-h-9" /></label>
        <button className="btn">Filtrar</button>
      </form>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo anterior" value={money(opening)} />
        <Stat label="Entradas" value={money(ins)} tone="ok" />
        <Stat label="Saídas" value={money(outs)} tone={outs ? "danger" : undefined} />
        <Stat label="Saldo final" value={money(bal)} tone={bal < 0 ? "danger" : undefined} />
      </div>
      {withBal.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Data</th><th>Histórico</th><th className="text-right">Valor</th><th className="text-right">Saldo</th></tr></thead>
            <tbody>
              {withBal.map((l) => (
                <tr key={l.key}>
                  <td className="text-xs whitespace-nowrap">{date(l.date)}</td>
                  <td>{l.href ? <Link href={l.href} className="link">{l.desc}</Link> : l.desc}<div className="text-xs text-muted">{l.sub}</div></td>
                  <td className={`text-right tabular-nums ${l.value < 0 ? "text-danger" : "text-ok"}`}>{money(l.value)}</td>
                  <td className="text-right tabular-nums">{money(l.bal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Sem movimentos no período.</Empty>}
    </>
  );
}
