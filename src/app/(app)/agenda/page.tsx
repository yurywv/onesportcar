import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { time, toLocalInput, minutesLabel } from "@/lib/format";
import { PageHeader, Field, Plate, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveAppointment, setAppointmentStatus } from "./actions";

export const metadata = { title: "Agenda" };
const OFFSET = 3 * 3600_000;
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function localMidnight(d: Date) {
  const l = new Date(d.getTime() - OFFSET);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) + OFFSET);
}

const STATUS_BADGE: Record<string, string> = { AGENDADO: "badge", CONFIRMADO: "badge badge-info", CHEGOU: "badge badge-ok", NAO_COMPARECEU: "badge badge-warn", CANCELADO: "badge badge-danger" };
const STATUS_TXT: Record<string, string> = { AGENDADO: "Agendado", CONFIRMADO: "Confirmado", CHEGOU: "Chegou", NAO_COMPARECEU: "Não compareceu", CANCELADO: "Cancelado" };

export default async function Agenda({ searchParams }: { searchParams: Promise<{ d?: string; view?: string; tecnico?: string; box?: string; novo?: string; cliente?: string; editar?: string }> }) {
  const user = await requireUser("agenda:ver");
  const sp = await searchParams;
  const view = sp.view === "dia" ? "dia" : "semana";
  const base = sp.d ? new Date(`${sp.d}T12:00:00-03:00`) : new Date();
  let start = localMidnight(base);
  if (view === "semana") start = new Date(start.getTime() - ((new Date(start.getTime() - OFFSET).getUTCDay() + 6) % 7) * 86400_000);
  const days = view === "semana" ? 7 : 1;
  const end = new Date(start.getTime() + days * 86400_000);
  const ymd = (d: Date) => new Date(d.getTime() - OFFSET).toISOString().slice(0, 10);

  const [appts, techs, bays, consultants, vehicles, editing] = await Promise.all([
    db.appointment.findMany({
      where: { startsAt: { gte: start, lt: end }, technicianId: sp.tecnico || undefined, bayId: sp.box || undefined },
      include: { vehicle: true, customer: true, bay: true, workOrder: true }, orderBy: { startsAt: "asc" },
    }),
    db.user.findMany({ where: { role: "TECNICO", active: true }, orderBy: { name: "asc" } }),
    db.workshopBay.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.user.findMany({ where: { role: { in: ["CONSULTOR", "GESTOR"] }, active: true }, orderBy: { name: "asc" } }),
    db.vehicle.findMany({ where: { active: true, ...(sp.cliente ? { customerId: sp.cliente } : {}) }, include: { customer: true }, orderBy: { model: "asc" } }),
    sp.editar ? db.appointment.findUnique({ where: { id: sp.editar } }) : null,
  ]);
  const names = new Map([...techs, ...consultants].map((u) => [u.id, u.name]));
  const canEdit = can(user.role, "agenda:editar");
  const showForm = canEdit && (sp.novo || editing);
  const nav = (delta: number) => `?${new URLSearchParams({ ...sp, novo: "", editar: "", d: ymd(new Date(start.getTime() + delta * 86400_000)) } as Record<string, string>)}`;
  const e = editing;

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={view === "semana" ? `Semana de ${start.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : start.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full" })}
        actions={<>
          <Link href={nav(-days)} className="btn">←</Link>
          <Link href="/agenda" className="btn">Hoje</Link>
          <Link href={nav(days)} className="btn">→</Link>
          <Link href={`?${new URLSearchParams({ d: ymd(start), view: view === "semana" ? "dia" : "semana" })}`} className="btn">{view === "semana" ? "Dia" : "Semana"}</Link>
          {canEdit && <Link href="?novo=1" className="btn btn-primary">Novo agendamento</Link>}
        </>}
      />

      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="d" value={ymd(start)} /><input type="hidden" name="view" value={view} />
        <select name="tecnico" defaultValue={sp.tecnico ?? ""} className="select max-w-52"><option value="">Todos os técnicos</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select name="box" defaultValue={sp.box ?? ""} className="select max-w-52"><option value="">Todos os boxes</option>{bays.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.description}</option>)}</select>
        <button className="btn">Filtrar</button>
      </form>

      {showForm && (
        <div className="card card-pad mb-5">
          <h2 className="mb-3 font-semibold">{e ? "Editar / reagendar" : "Novo agendamento"}</h2>
          <ActionForm action={saveAppointment} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" reset={!e}>
            {e && <input type="hidden" name="id" value={e.id} />}
            <Field label="Veículo *" className="sm:col-span-2">
              <select name="vehicleId" className="select" required defaultValue={e?.vehicleId ?? ""}>
                <option value="">Selecione…</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.make} {v.model} — {v.customer.name}</option>)}
              </select>
            </Field>
            <Field label="Data e hora *"><input type="datetime-local" name="startsAt" className="input" required defaultValue={e ? toLocalInput(e.startsAt) : ""} /></Field>
            <Field label="Duração (min)"><input name="durationMin" className="input" inputMode="numeric" defaultValue={e?.durationMin ?? 60} /></Field>
            <Field label="Serviços previstos" className="sm:col-span-2"><input name="services" className="input" defaultValue={e?.services ?? ""} placeholder="Ex.: revisão 20.000 km" /></Field>
            <Field label="Problema relatado" className="sm:col-span-2"><input name="complaint" className="input" defaultValue={e?.complaint ?? ""} /></Field>
            <Field label="Consultor"><select name="consultantId" className="select" defaultValue={e?.consultantId ?? user.id}>{consultants.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Técnico"><select name="technicianId" className="select" defaultValue={e?.technicianId ?? ""}><option value="">A definir</option>{techs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Box"><select name="bayId" className="select" defaultValue={e?.bayId ?? ""}><option value="">A definir</option>{bays.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.description}</option>)}</select></Field>
            <Field label="Prioridade"><select name="priority" className="select" defaultValue={e?.priority ?? "NORMAL"}>{["BAIXA", "NORMAL", "ALTA", "URGENTE"].map((p) => <option key={p}>{p}</option>)}</select></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="pickup" defaultChecked={e?.pickup} /> Leva-e-traz</label>
            <Field label="Endereço de coleta" className="sm:col-span-2"><input name="pickupAddress" className="input" defaultValue={e?.pickupAddress ?? ""} /></Field>
            <Field label="Observações" className="sm:col-span-2 lg:col-span-4"><input name="notes" className="input" defaultValue={e?.notes ?? ""} /></Field>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-4"><Submit>{e ? "Salvar" : "Agendar"}</Submit><Link href="/agenda" className="btn">Fechar</Link></div>
          </ActionForm>
        </div>
      )}

      <div className={`grid gap-3 ${view === "semana" ? "md:grid-cols-2 xl:grid-cols-7" : ""}`}>
        {Array.from({ length: days }, (_, i) => {
          const day = new Date(start.getTime() + i * 86400_000);
          const next = new Date(day.getTime() + 86400_000);
          const list = appts.filter((a) => a.startsAt >= day && a.startsAt < next);
          const isToday = ymd(day) === ymd(new Date());
          const load = list.filter((a) => !["CANCELADO", "NAO_COMPARECEU"].includes(a.status)).reduce((s, a) => s + a.durationMin, 0);
          return (
            <section key={i} className={`card min-h-32 p-3 ${isToday ? "ring-1 ring-accent" : ""}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold">{DAYS[new Date(day.getTime() - OFFSET).getUTCDay()]} {day.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })}</span>
                <span className="text-xs text-muted">{list.length ? minutesLabel(load) : ""}</span>
              </div>
              {list.length ? (
                <ul className="space-y-2">
                  {list.map((a) => (
                    <li key={a.id} className="rounded-lg border border-line p-2 text-sm">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-xs font-semibold">{time(a.startsAt)}</span>
                        <span className={STATUS_BADGE[a.workOrder ? "CHEGOU" : a.status]}>{a.workOrder ? "Chegou" : STATUS_TXT[a.status]}</span>
                      </div>
                      <div className="mt-1 font-medium">{a.vehicle.model} <Plate plate={a.vehicle.plate} /></div>
                      <div className="truncate text-xs text-muted">{a.customer.name}</div>
                      <div className="truncate text-xs">{a.services}</div>
                      <div className="mt-1 text-xs text-muted">{a.bay?.code ?? "sem box"} · {a.technicianId ? names.get(a.technicianId) : "técnico a definir"}{a.pickup && " · leva-e-traz"}</div>
                      {canEdit && !a.workOrder && ["AGENDADO", "CONFIRMADO"].includes(a.status) && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {can(user.role, "os:criar") && <Link href={`/os/nova?agendamento=${a.id}`} className="btn btn-primary btn-sm">Check-in</Link>}
                          <Link href={`?editar=${a.id}&d=${ymd(start)}&view=${view}`} className="btn btn-sm">Editar</Link>
                          {a.status === "AGENDADO" && (
                            <ActionForm action={setAppointmentStatus}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="CONFIRMADO" /><Submit className="btn btn-sm">Confirmar</Submit></ActionForm>
                          )}
                          <ActionForm action={setAppointmentStatus}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="NAO_COMPARECEU" /><Submit className="btn btn-sm">No-show</Submit></ActionForm>
                          <details className="w-full">
                            <summary className="cursor-pointer text-xs text-danger">Cancelar…</summary>
                            <ActionForm action={setAppointmentStatus} className="mt-1 flex gap-1">
                              <input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="CANCELADO" />
                              <input name="reason" className="input !min-h-8 text-xs" placeholder="Motivo" required />
                              <Submit className="btn btn-danger btn-sm">OK</Submit>
                            </ActionForm>
                          </details>
                        </div>
                      )}
                      {a.workOrder && <Link href={`/os/${a.workOrder.id}`} className="link mt-1 block text-xs">{a.workOrder.number} →</Link>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted">—</p>}
            </section>
          );
        })}
      </div>
      {!appts.length && view === "dia" && <div className="mt-3"><Empty>Nenhum agendamento neste dia.</Empty></div>}
    </>
  );
}
