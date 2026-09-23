import Link from "next/link";
import { redirect } from "next/navigation";
import type { WorkOrderStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { money, time, dateTime } from "@/lib/format";
import { KANBAN_COLUMNS, OPEN_STATUSES, STATUS_LABEL } from "@/lib/workflow";
import { PageHeader, Stat, Section, Plate, StatusBadge, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const TZ_OFFSET = 3 * 3600_000;
function dayBounds(d = new Date()) {
  const local = new Date(d.getTime() - TZ_OFFSET);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + TZ_OFFSET);
  return { start, end: new Date(start.getTime() + 86400_000) };
}
function monthStart(d = new Date()) {
  const local = new Date(d.getTime() - TZ_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + TZ_OFFSET);
}

export default async function Dashboard() {
  const user = await requireUser();
  if (!can(user.role, "dashboard:ver")) redirect("/os");
  const showMoney = can(user.role, "financeiro:ver_valores");
  const { start, end } = dayBounds();
  const month = monthStart();

  const [byStatus, late, appointments, paymentsToday, paymentsMonth, deliveredMonth, lowStock, pendingApproval, bays] = await Promise.all([
    db.workOrder.groupBy({ by: ["status"], _count: true, where: { status: { in: KANBAN_COLUMNS } } }),
    db.workOrder.findMany({
      where: { status: { in: OPEN_STATUSES }, promisedAt: { lt: new Date() } },
      include: { vehicle: true, customer: true }, orderBy: { promisedAt: "asc" }, take: 8,
    }),
    db.appointment.findMany({
      where: { startsAt: { gte: start, lt: end }, status: { notIn: ["CANCELADO"] } },
      include: { vehicle: true, customer: true }, orderBy: { startsAt: "asc" },
    }),
    db.settlement.aggregate({ where: { date: { gte: start, lt: end }, title: { kind: "RECEBER" } }, _sum: { amount: true } }),
    db.settlement.aggregate({ where: { date: { gte: month }, title: { kind: "RECEBER" } }, _sum: { amount: true } }),
    db.workOrder.findMany({ where: { status: "ENTREGUE", closedAt: { gte: month } }, include: { services: true, parts: true } }),
    db.$queryRaw<{ sku: string; name: string; onHand: number; minQty: number; unit: string }[]>`
      SELECT sku, name, "onHand", "minQty", unit FROM "InventoryItem" WHERE active AND "onHand" < "minQty" ORDER BY name LIMIT 8`,
    db.workOrder.findMany({ where: { status: "AGUARDANDO_APROVACAO" }, include: { vehicle: true, customer: true }, orderBy: { updatedAt: "asc" }, take: 6 }),
    db.workshopBay.findMany({ where: { active: true }, include: { workOrders: { where: { status: { in: OPEN_STATUSES } }, include: { vehicle: true } } }, orderBy: { code: "asc" } }),
  ]);

  const count = (s: WorkOrderStatus) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const inShop = OPEN_STATUSES.reduce((s, st) => s + count(st), 0);
  const billed = deliveredMonth.map((w) =>
    w.services.filter((s) => s.status !== "CANCELADO").reduce((a, s) => a + s.price, 0) +
    w.parts.filter((p) => p.status === "APLICADA").reduce((a, p) => a + p.price, 0));
  const billedMonth = billed.reduce((a, b) => a + b, 0);
  const ticket = billed.length ? Math.round(billedMonth / billed.length) : 0;
  const busyBays = bays.filter((b) => b.workOrders.length).length;

  return (
    <>
      <PageHeader title={`Olá, ${user.name.split(" ")[0]}`} subtitle="Visão da oficina em tempo real" actions={<Link href="/os/nova" className="btn btn-primary">Novo check-in</Link>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Agendados hoje" value={appointments.length} />
        <Stat label="Veículos na oficina" value={inShop} hint={`${busyBays}/${bays.length} boxes ocupados`} />
        <Stat label="OS atrasadas" value={late.length} tone={late.length ? "danger" : "ok"} />
        <Stat label="Prontos para entrega" value={count("PRONTO_ENTREGA")} tone={count("PRONTO_ENTREGA") ? "ok" : undefined} />
        {showMoney && (
          <>
            <Stat label="Recebido hoje" value={money(paymentsToday._sum.amount)} />
            <Stat label="Recebido no mês" value={money(paymentsMonth._sum.amount)} />
            <Stat label="Faturado no mês (OS entregues)" value={money(billedMonth)} hint={`${billed.length} OS`} />
            <Stat label="Ticket médio" value={money(ticket)} />
          </>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Section title="Funil da oficina" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {KANBAN_COLUMNS.filter((s) => s !== "ENTREGUE").map((s) => (
              <Link key={s} href={`/os?status=${s}`} className="rounded-lg border border-line p-3 transition-colors hover:bg-surface-2">
                <div className="text-xs text-muted">{STATUS_LABEL[s]}</div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums">{count(s)}</div>
              </Link>
            ))}
          </div>
        </Section>

        <Section title="Agenda de hoje" actions={<Link href="/agenda" className="link text-xs">Ver agenda</Link>}>
          {appointments.length ? (
            <ul className="space-y-2">
              {appointments.map((a) => (
                <li key={a.id} className="flex items-start gap-3 text-sm">
                  <span className="w-12 shrink-0 font-mono text-muted">{time(a.startsAt)}</span>
                  <span className="min-w-0">
                    <span className="block font-medium">{a.vehicle.make} {a.vehicle.model} <Plate plate={a.vehicle.plate} /></span>
                    <span className="block truncate text-muted">{a.customer.name} · {a.services ?? "—"}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum agendamento hoje.</Empty>}
        </Section>

        <Section title="OS atrasadas" className="lg:col-span-2">
          {late.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>OS</th><th>Veículo</th><th>Cliente</th><th>Status</th><th>Previsão</th></tr></thead>
                <tbody>
                  {late.map((w) => (
                    <tr key={w.id}>
                      <td><Link href={`/os/${w.id}`} className="link">{w.number}</Link></td>
                      <td>{w.vehicle.make} {w.vehicle.model} <Plate plate={w.vehicle.plate} /></td>
                      <td>{w.customer.name}</td>
                      <td><StatusBadge status={w.status} /></td>
                      <td className="text-danger">{dateTime(w.promisedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhuma OS atrasada.</Empty>}
        </Section>

        <div className="space-y-5">
          <Section title="Aguardando aprovação">
            {pendingApproval.length ? (
              <ul className="space-y-2 text-sm">
                {pendingApproval.map((w) => (
                  <li key={w.id} className="flex justify-between gap-2">
                    <Link href={`/os/${w.id}?tab=orcamento`} className="link">{w.number}</Link>
                    <span className="truncate text-muted">{w.vehicle.model} · {w.customer.name}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nada pendente.</Empty>}
          </Section>
          <Section title="Estoque crítico" actions={<Link href="/estoque?critico=1" className="link text-xs">Ver</Link>}>
            {lowStock.length ? (
              <ul className="space-y-1.5 text-sm">
                {lowStock.map((i) => (
                  <li key={i.sku} className="flex justify-between gap-2">
                    <span className="truncate">{i.name}</span>
                    <span className="shrink-0 tabular-nums text-warn">{i.onHand}/{i.minQty} {i.unit}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nenhum item abaixo do mínimo.</Empty>}
          </Section>
        </div>
      </div>
    </>
  );
}
