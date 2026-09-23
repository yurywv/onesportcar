import Link from "next/link";
import type { Prisma, WorkOrderStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { STATUS_LABEL, OPEN_STATUSES } from "@/lib/workflow";
import { PageHeader, Empty, Plate, StatusBadge, Pager } from "@/components/ui";

export const metadata = { title: "Ordens de serviço" };
const PAGE = 40;

export default async function WorkOrders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; tecnico?: string; p?: string }> }) {
  const user = await requireUser("os:ver");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const all = can(user.role, "os:ver_todas");
  const q = sp.q?.trim();
  const status = sp.status && sp.status in STATUS_LABEL ? (sp.status as WorkOrderStatus) : undefined;
  const where: Prisma.WorkOrderWhereInput = {
    status: status ?? (sp.status === "todas" ? undefined : { in: OPEN_STATUSES }),
    technicianId: all ? sp.tecnico || undefined : user.id,
    ...(q && { OR: [{ number: { contains: q.toUpperCase() } }, { vehicle: { plate: { contains: q.toUpperCase().replace(/[^0-9A-Z]/g, "") } } }, { customer: { name: { contains: q, mode: "insensitive" } } }] }),
  };
  const [rows, total, techs] = await Promise.all([
    db.workOrder.findMany({ where, include: { vehicle: true, customer: true, bay: true }, orderBy: { openedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.workOrder.count({ where }),
    all ? db.user.findMany({ where: { role: "TECNICO" }, orderBy: { name: "asc" } }) : [],
  ]);
  const techName = new Map(techs.map((t) => [t.id, t.name]));
  const now = new Date();
  return (
    <>
      <PageHeader
        title={all ? "Ordens de serviço" : "Minhas OS"}
        subtitle={`${total} OS ${status ? `em "${STATUS_LABEL[status]}"` : sp.status === "todas" ? "no total" : "em aberto"}`}
        actions={can(user.role, "os:criar") && <Link href="/os/nova" className="btn btn-primary">Novo check-in</Link>}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Nº da OS, placa ou cliente" />
        <select name="status" defaultValue={sp.status ?? ""} className="select max-w-56">
          <option value="">Em aberto</option><option value="todas">Todas</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {all && <select name="tecnico" defaultValue={sp.tecnico ?? ""} className="select max-w-52"><option value="">Todos os técnicos</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>OS</th><th>Veículo</th><th>Cliente</th><th>Status</th><th>Técnico</th><th>Box</th><th>Previsão</th></tr></thead>
            <tbody>
              {rows.map((w) => {
                const late = w.promisedAt && w.promisedAt < now && OPEN_STATUSES.includes(w.status);
                return (
                  <tr key={w.id}>
                    <td><Link href={`/os/${w.id}`} className="link">{w.number}</Link>{w.priority !== "NORMAL" && <div className="text-xs text-warn">{w.priority}</div>}</td>
                    <td>{w.vehicle.make} {w.vehicle.model} <Plate plate={w.vehicle.plate} /></td>
                    <td>{w.customer.name}</td>
                    <td><StatusBadge status={w.status} /></td>
                    <td className="text-xs">{w.technicianId ? techName.get(w.technicianId) ?? "—" : "—"}</td>
                    <td className="text-xs">{w.bay?.code ?? "—"}</td>
                    <td className={`text-xs ${late ? "font-semibold text-danger" : ""}`}>{dateTime(w.promisedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhuma OS encontrada.</Empty>}
      <Pager page={page} total={total} size={PAGE} params={{ q, status: sp.status, tecnico: sp.tecnico }} />
    </>
  );
}
