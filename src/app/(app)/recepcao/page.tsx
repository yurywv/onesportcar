import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { time, dateTime } from "@/lib/format";
import { PageHeader, Plate, Empty, Section, StatusBadge } from "@/components/ui";

export const metadata = { title: "Recepção" };
export const dynamic = "force-dynamic";

const OFFSET = 3 * 3600_000;
function today() {
  const l = new Date(Date.now() - OFFSET);
  const start = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) + OFFSET);
  return { start, end: new Date(+start + 86400_000) };
}

// Tela do consultor da recepção: chegadas do dia, check-ins a completar (fotos/assinatura), pedidos do app e entregas.
export default async function Reception() {
  const user = await requireUser("agenda:ver");
  const { start, end } = today();
  const [appts, requests, checkins, ready] = await Promise.all([
    db.appointment.findMany({ where: { startsAt: { gte: start, lt: end }, status: { notIn: ["CANCELADO"] } }, include: { vehicle: true, customer: true, workOrder: true }, orderBy: { startsAt: "asc" } }),
    db.appointment.findMany({ where: { origin: "PORTAL", status: "AGENDADO", startsAt: { gte: new Date() } }, include: { vehicle: true, customer: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.workOrder.findMany({ where: { status: "CHECK_IN" }, include: { vehicle: true, customer: true, checkIn: { select: { locked: true } }, _count: { select: { photos: { where: { phase: "CHECK_IN" } } } } }, orderBy: { openedAt: "asc" } }),
    db.workOrder.findMany({ where: { status: "PRONTO_ENTREGA" }, include: { vehicle: true, customer: true }, orderBy: { updatedAt: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Recepção" subtitle="Chegadas do dia, check-ins e entregas" actions={<><Link href="/agenda" className="btn">Agenda completa</Link>{can(user.role, "os:criar") && <Link href="/os/nova" className="btn btn-primary">Check-in sem agendamento</Link>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={`Chegadas de hoje (${appts.length})`}>
          {appts.length ? (
            <ul className="divide-y divide-line text-sm">
              {appts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div><b className="font-mono">{time(a.startsAt)}</b> · {a.vehicle.model} <Plate plate={a.vehicle.plate} />
                    <div className="text-xs text-muted">{a.customer.name} · {a.kind === "DIAGNOSTICO" ? "Diagnóstico" : a.services}{a.origin === "PORTAL" && " · pedido pelo app"}</div>
                  </div>
                  {a.workOrder ? <Link href={`/os/${a.workOrder.id}`} className="btn btn-sm">{a.workOrder.number}</Link>
                    : ["AGENDADO", "CONFIRMADO"].includes(a.status) && can(user.role, "os:criar") ? <Link href={`/os/nova?agendamento=${a.id}`} className="btn btn-primary btn-sm">Fazer check-in</Link>
                    : <span className="badge">{a.status}</span>}
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum agendamento hoje.</Empty>}
        </Section>
        <Section title={`Check-ins em andamento (${checkins.length})`}>
          {checkins.length ? (
            <ul className="divide-y divide-line text-sm">
              {checkins.map((wo) => (
                <li key={wo.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div><Link href={`/os/${wo.id}`} className="link font-semibold">{wo.number}</Link> · {wo.vehicle.model} <Plate plate={wo.vehicle.plate} /><div className="text-xs text-muted">{wo.customer.name}</div></div>
                  <div className="flex gap-1">
                    <Link href={`/os/${wo.id}?tab=midia`} className={`badge ${wo._count.photos ? "badge-ok" : "badge-warn"}`}>{wo._count.photos} foto(s)</Link>
                    <span className={`badge ${wo.checkIn?.locked ? "badge-ok" : "badge-warn"}`}>{wo.checkIn?.locked ? "assinado" : "falta assinatura"}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum check-in pendente.</Empty>}
        </Section>
        <Section title={`Pedidos de agendamento pelo app (${requests.length})`}>
          {requests.length ? (
            <ul className="divide-y divide-line text-sm">
              {requests.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex flex-wrap justify-between gap-2"><span><b>{dateTime(a.startsAt)}</b> · {a.vehicle.model} <Plate plate={a.vehicle.plate} /></span><Link href={`/agenda?editar=${a.id}`} className="btn btn-sm">Confirmar / ajustar</Link></div>
                  <div className="text-xs text-muted">{a.customer.name}{a.customer.whatsapp && ` · ${a.customer.whatsapp}`} · {a.kind === "DIAGNOSTICO" ? "Diagnóstico" : a.services}</div>
                  {a.complaint && <div className="text-xs">{a.complaint}</div>}
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum pedido novo.</Empty>}
        </Section>
        <Section title={`Prontos para entrega (${ready.length})`}>
          {ready.length ? (
            <ul className="divide-y divide-line text-sm">
              {ready.map((wo) => <li key={wo.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><Link href={`/os/${wo.id}`} className="link font-semibold">{wo.number}</Link> · {wo.vehicle.model} <Plate plate={wo.vehicle.plate} /> · {wo.customer.name}</span><span className="flex gap-1"><StatusBadge status={wo.status} /><Link href={`/os/${wo.id}?tab=entrega`} className="btn btn-sm">Check-out</Link></span></li>)}
            </ul>
          ) : <Empty>Nenhum veículo pronto.</Empty>}
        </Section>
      </div>
    </>
  );
}
