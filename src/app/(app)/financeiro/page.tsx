import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date } from "@/lib/format";
import { accountBalance } from "@/lib/finance";
import { PageHeader, Section, Stat, Empty } from "@/components/ui";

export const metadata = { title: "Tesouraria" };
export const dynamic = "force-dynamic";

const OFFSET = 3 * 3600_000;
const localDay = (d: Date) => new Date(d.getTime() - OFFSET).toISOString().slice(0, 10);
const startOfToday = () => { const l = new Date(Date.now() - OFFSET); return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) + OFFSET); };

export default async function Treasury({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  await requireUser("financeiro:ver");
  const days = Math.min(90, Math.max(7, Number((await searchParams).dias) || 30));
  const today = startOfToday();
  const horizon = new Date(today.getTime() + days * 86400_000);
  const l = new Date(Date.now() - OFFSET);
  const month = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) + OFFSET);

  const [accounts, open, monthSettlements] = await Promise.all([
    db.financialAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.title.findMany({ where: { status: { in: ["ABERTO", "PARCIAL"] }, dueDate: { lt: horizon } }, select: { kind: true, amount: true, settled: true, dueDate: true } }),
    db.settlement.findMany({ where: { date: { gte: month } }, include: { title: { include: { category: true } } } }),
  ]);
  const balances = await Promise.all(accounts.map(async (a) => ({ a, bal: await accountBalance(db, a.id) })));
  const cash = balances.reduce((s, b) => s + b.bal, 0);
  const sum = (kind: "RECEBER" | "PAGAR", f: (d: Date) => boolean) => open.filter((t) => t.kind === kind && f(t.dueDate)).reduce((s, t) => s + t.amount - t.settled, 0);
  const overdueR = sum("RECEBER", (d) => d < today), overdueP = sum("PAGAR", (d) => d < today);

  // Fluxo previsto por dia (vencidos entram no dia de hoje)
  const flow = new Map<string, { in: number; out: number }>();
  for (const t of open) {
    const k = localDay(t.dueDate < today ? today : t.dueDate);
    const e = flow.get(k) ?? { in: 0, out: 0 };
    if (t.kind === "RECEBER") e.in += t.amount - t.settled; else e.out += t.amount - t.settled;
    flow.set(k, e);
  }
  let running = cash;
  const rows = [...flow.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => { running += v.in - v.out; return { d, ...v, bal: running }; });
  const minBal = rows.reduce((m, r) => Math.min(m, r.bal), cash);

  // Realizado no mês (regime de caixa) por categoria
  const byCat = new Map<string, { name: string; kind: string; cash: number }>();
  for (const s of monthSettlements) {
    const c = s.title.category;
    const e = byCat.get(c.id) ?? { name: `${c.code} · ${c.name}`, kind: c.kind, cash: 0 };
    e.cash += s.cash;
    byCat.set(c.id, e);
  }
  const inMonth = monthSettlements.filter((s) => s.title.kind === "RECEBER").reduce((a, s) => a + s.cash, 0);
  const outMonth = -monthSettlements.filter((s) => s.title.kind === "PAGAR").reduce((a, s) => a + s.cash, 0);

  return (
    <>
      <PageHeader title="Tesouraria" subtitle="Saldos, compromissos e fluxo de caixa"
        actions={<><Link href="/financeiro/receber" className="btn">A receber</Link><Link href="/financeiro/pagar" className="btn">A pagar</Link><Link href="/financeiro/contas" className="btn">Contas e extratos</Link></>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo em contas" value={money(cash)} tone={cash < 0 ? "danger" : undefined} />
        <Stat label="A receber vencido" value={money(overdueR)} tone={overdueR ? "warn" : "ok"} />
        <Stat label="A pagar vencido" value={money(overdueP)} tone={overdueP ? "danger" : "ok"} />
        <Stat label={`Menor saldo previsto (${days} dias)`} value={money(minBal)} tone={minBal < 0 ? "danger" : "ok"} hint={minBal < 0 ? "Há risco de caixa negativo no período" : undefined} />
        <Stat label="Entradas no mês" value={money(inMonth)} />
        <Stat label="Saídas no mês" value={money(outMonth)} />
        <Stat label="Resultado de caixa no mês" value={money(inMonth - outMonth)} tone={inMonth - outMonth < 0 ? "danger" : "ok"} />
        <Stat label={`A receber / a pagar (${days} dias)`} value={<span className="text-lg">{money(sum("RECEBER", () => true))} / {money(sum("PAGAR", () => true))}</span>} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={`Fluxo de caixa previsto — próximos ${days} dias`} className="lg:col-span-2"
          actions={<span className="flex gap-1">{[7, 30, 60, 90].map((d) => <Link key={d} href={`?dias=${d}`} className={`btn btn-sm ${d === days ? "btn-primary" : ""}`}>{d}d</Link>)}</span>}>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Data</th><th className="text-right">Entradas previstas</th><th className="text-right">Saídas previstas</th><th className="text-right">Saldo projetado</th></tr></thead>
                <tbody>
                  <tr className="text-muted"><td>Saldo atual</td><td /><td /><td className="text-right tabular-nums">{money(cash)}</td></tr>
                  {rows.map((r) => (
                    <tr key={r.d}>
                      <td>{date(new Date(`${r.d}T12:00:00-03:00`))}{r.d === localDay(today) && (overdueR || overdueP) ? <span className="text-xs text-muted"> (inclui vencidos)</span> : null}</td>
                      <td className="text-right tabular-nums text-ok">{r.in ? money(r.in) : "—"}</td>
                      <td className="text-right tabular-nums text-danger">{r.out ? money(r.out) : "—"}</td>
                      <td className={`text-right font-medium tabular-nums ${r.bal < 0 ? "text-danger" : ""}`}>{money(r.bal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhum título em aberto no período.</Empty>}
        </Section>
        <div className="space-y-5">
          <Section title="Saldos por conta" actions={<Link href="/financeiro/contas" className="link text-xs">Extratos</Link>}>
            <ul className="space-y-2 text-sm">
              {balances.map(({ a, bal }) => (
                <li key={a.id} className="flex justify-between gap-2"><Link href={`/financeiro/contas/${a.id}`} className="link">{a.name}</Link><span className={`tabular-nums ${bal < 0 ? "text-danger" : ""}`}>{money(bal)}</span></li>
              ))}
            </ul>
          </Section>
          <Section title="Realizado no mês por categoria">
            {byCat.size ? (
              <ul className="space-y-1.5 text-sm">
                {[...byCat.values()].sort((a, b) => b.cash - a.cash).map((c) => (
                  <li key={c.name} className="flex justify-between gap-2"><span className="truncate">{c.name}</span><span className={`tabular-nums ${c.cash < 0 ? "text-danger" : "text-ok"}`}>{money(c.cash)}</span></li>
                ))}
              </ul>
            ) : <Empty>Sem movimentos no mês.</Empty>}
            <p className="mt-3 text-xs text-muted">Regime de caixa. A DRE por competência fica para a fase de BI.</p>
          </Section>
        </div>
      </div>
    </>
  );
}
