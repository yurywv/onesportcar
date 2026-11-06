import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth";
import { db } from "@/lib/db";
import { dateTime, date } from "@/lib/format";
import { formatPlate } from "@/lib/validators";
import { STATUS_LABEL } from "@/lib/workflow";
import { phaseOf, PHASE_LABEL } from "@/lib/phases";
import { camerasForPhase } from "@/lib/cameras";
import { PhaseStepper } from "@/components/phase-stepper";
import { CameraPlayer } from "@/components/camera-player";
import { ActionForm, Submit } from "@/components/forms";
import { portalCancelAppointment } from "./actions";

export const metadata = { title: "Início" };

export default async function PortalHome() {
  const c = await requireCustomer();
  const [vehicles, open, appts] = await Promise.all([
    db.vehicle.findMany({ where: { customerId: c.id, active: true }, orderBy: { model: "asc" } }),
    db.workOrder.findMany({
      where: { customerId: c.id, legacy: false, status: { notIn: ["ENTREGUE", "CANCELADA"] } },
      include: { vehicle: true, estimates: { where: { status: "ENVIADO" }, select: { id: true } } },
      orderBy: { openedAt: "desc" },
    }),
    db.appointment.findMany({ where: { customerId: c.id, workOrderId: null, status: { in: ["AGENDADO", "CONFIRMADO"] }, startsAt: { gte: new Date(Date.now() - 3 * 3600_000) } }, include: { vehicle: true }, orderBy: { startsAt: "asc" } }),
  ]);
  const past = await db.vehicle.findMany({ where: { customerId: { not: c.id }, OR: [{ ownerships: { some: { customerId: c.id } } }, { workOrders: { some: { customerId: c.id } } }] }, orderBy: { model: "asc" } });
  const live = open[0] ? await camerasForPhase(open[0].id, phaseOf(open[0].status), { customer: true }) : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Olá, {c.name.split(" ")[0]}</h1>

      {open.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Na oficina agora</h2>
          {open.map((wo, i) => {
            const phase = phaseOf(wo.status);
            return (
              <Link key={wo.id} href={`/cliente/os/${wo.id}`} className="card card-pad block space-y-3 hover:ring-1 hover:ring-accent">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">{wo.vehicle.make} {wo.vehicle.model} <span className="plate">{formatPlate(wo.vehicle.plate)}</span></div>
                  <span className="badge badge-accent">{phase ? PHASE_LABEL[phase] : STATUS_LABEL[wo.status]}</span>
                </div>
                <PhaseStepper current={phase} />
                <div className="text-xs text-muted">{wo.number} · {STATUS_LABEL[wo.status]}{wo.promisedAt && ` · previsão ${dateTime(wo.promisedAt)}`}</div>
                {wo.estimates.length > 0 && <div className="alert alert-warn">Há um orçamento aguardando sua aprovação. Toque para ver.</div>}
                {i === 0 && live.length > 0 && <div className="text-sm font-medium text-accent">● {live.length} câmera(s) ao vivo nesta etapa</div>}
              </Link>
            );
          })}
          {live[0] && <CameraPlayer cam={live[0]} />}
        </section>
      )}

      {appts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Próximos agendamentos</h2>
          {appts.map((a) => (
            <div key={a.id} className="card card-pad flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <div className="font-semibold">{dateTime(a.startsAt)} · {a.kind === "DIAGNOSTICO" ? "Diagnóstico" : a.services}</div>
                <div className="text-muted">{a.vehicle.model} {formatPlate(a.vehicle.plate)} · {a.status === "CONFIRMADO" ? "confirmado" : "aguardando confirmação"}</div>
              </div>
              <ActionForm action={portalCancelAppointment} confirm="Cancelar este agendamento?"><input type="hidden" name="id" value={a.id} /><Submit className="btn btn-sm">Cancelar</Submit></ActionForm>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Meus veículos</h2>
          <Link href="/cliente/agendar" className="btn btn-primary btn-sm">Agendar serviço ou diagnóstico</Link>
        </div>
        {vehicles.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {vehicles.map((v) => (
              <li key={v.id}>
                <Link href={`/cliente/veiculos/${v.id}`} className="card card-pad block hover:ring-1 hover:ring-accent">
                  <div className="font-semibold">{v.make} {v.model}</div>
                  <div className="text-sm text-muted">{v.version} {v.yearModel && `· ${v.yearModel}`} · <span className="plate">{formatPlate(v.plate)}</span></div>
                  <div className="mt-1 text-xs text-muted">Último km registrado: {v.mileage.toLocaleString("pt-BR")} · ver histórico →</div>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="card card-pad text-sm text-muted">Nenhum veículo cadastrado. Fale com a recepção.</p>}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Veículos que já foram seus</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {past.map((v) => (
              <li key={v.id}><Link href={`/cliente/veiculos/${v.id}`} className="card card-pad block text-sm hover:ring-1 hover:ring-accent"><b>{v.make} {v.model}</b> <span className="plate">{formatPlate(v.plate)}</span><div className="text-xs text-muted">Seus atendimentos neste carro →</div></Link></li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-center text-xs text-muted">Atualizado em {date(new Date())}</p>
    </div>
  );
}
