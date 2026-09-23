import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, time } from "@/lib/format";
import { KANBAN_COLUMNS, STATUS_LABEL, OPEN_STATUSES, allowedManualTargets } from "@/lib/workflow";
import { formatPlate } from "@/lib/validators";
import { PageHeader } from "@/components/ui";
import { Kanban } from "@/components/kanban";
import { moveWorkOrder } from "../../os/actions";

export const metadata = { title: "Kanban da oficina" };
export const dynamic = "force-dynamic";

export default async function KanbanPage({ searchParams }: { searchParams: Promise<{ tecnico?: string }> }) {
  const user = await requireUser("os:ver");
  const sp = await searchParams;
  const all = can(user.role, "os:ver_todas");
  const now = new Date();
  const startToday = new Date(now.getTime() - ((now.getTime() - 3 * 3600_000) % 86400_000));
  const [orders, appts, staff] = await Promise.all([
    db.workOrder.findMany({
      where: {
        technicianId: all ? sp.tecnico || undefined : user.id,
        OR: [{ status: { in: OPEN_STATUSES } }, { status: "ENTREGUE", closedAt: { gte: new Date(now.getTime() - 24 * 3600_000) } }],
      },
      include: { vehicle: true, customer: true, parts: { where: { status: "AGUARDANDO_COMPRA" } }, estimates: { where: { status: "ENVIADO" } } },
      orderBy: [{ promisedAt: "asc" }],
    }),
    all ? db.appointment.findMany({ where: { startsAt: { gte: startToday, lt: new Date(startToday.getTime() + 86400_000) }, workOrderId: null, status: { in: ["AGENDADO", "CONFIRMADO"] } }, include: { vehicle: true, customer: true }, orderBy: { startsAt: "asc" } }) : [],
    db.user.findMany({ select: { id: true, name: true, role: true } }),
  ]);
  const name = new Map(staff.map((u) => [u.id, u.name.split(" ").slice(0, 2).join(" ")]));
  const canMove = can(user.role, "os:transicionar");
  return (
    <>
      <PageHeader
        title="Kanban da oficina"
        subtitle="Arraste os cards ou use “Mover para…”. As regras de negócio são validadas no servidor."
        actions={all && (
          <form className="flex gap-2">
            <select name="tecnico" defaultValue={sp.tecnico ?? ""} className="select">
              <option value="">Todos os técnicos</option>
              {staff.filter((s) => s.role === "TECNICO").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="btn">Filtrar</button>
          </form>
        )}
      />
      <Kanban
        canMove={canMove}
        move={moveWorkOrder}
        columns={KANBAN_COLUMNS.map((k) => ({ key: k, label: STATUS_LABEL[k] }))}
        appts={appts.map((a) => ({ id: a.id, time: time(a.startsAt), vehicle: `${a.vehicle.make} ${a.vehicle.model}`, plate: formatPlate(a.vehicle.plate), customer: a.customer.name }))}
        cards={orders.map((w) => ({
          id: w.id, number: w.number, status: w.status, vehicle: `${w.vehicle.make} ${w.vehicle.model}`, plate: formatPlate(w.vehicle.plate),
          customer: w.customer.name, technician: w.technicianId ? name.get(w.technicianId) ?? null : null,
          consultant: w.consultantId ? name.get(w.consultantId) ?? null : null, promisedAt: w.promisedAt ? dateTime(w.promisedAt) : null,
          late: !!w.promisedAt && w.promisedAt < now && OPEN_STATUSES.includes(w.status), priority: w.priority,
          flags: [...(w.parts.length ? ["Peça pendente"] : []), ...(w.estimates.length ? ["Aprovação pendente"] : [])],
          targets: allowedManualTargets(w.status).filter((t) => t !== "CANCELADA"),
        }))}
      />
    </>
  );
}
