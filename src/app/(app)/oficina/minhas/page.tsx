import Link from "next/link";
import type { WorkOrderStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { minutesLabel, time } from "@/lib/format";
import { entryMinutes } from "@/lib/wo";
import { Empty, Plate, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { timerAction } from "../../os/actions";

export const metadata = { title: "Minha oficina" };

// Tela pensada para o celular do mecânico (instalável como app): só as OS dele, sem valores,
// com iniciar/pausar/finalizar no polegar.
const ACTIVE: WorkOrderStatus[] = ["AGUARDANDO_DIAGNOSTICO", "EM_DIAGNOSTICO", "AGUARDANDO_PECAS", "EM_EXECUCAO", "CONTROLE_QUALIDADE"];
const SVC_TXT: Record<string, string> = { PENDENTE: "Pendente", EM_EXECUCAO: "Em execução", PAUSADO: "Pausado", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };

export default async function MyWorkshop({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const user = await requireUser("os:ver");
  const all = can(user.role, "os:ver_todas") && (await searchParams).todos === "1";
  const rows = await db.workOrder.findMany({
    where: { status: { in: ACTIVE }, legacy: false, ...(all ? {} : { OR: [{ technicianId: user.id }, { services: { some: { technicianId: user.id } } }] }) },
    include: { vehicle: true, services: { where: { status: { not: "CANCELADO" } }, include: { timeEntries: true }, orderBy: { createdAt: "asc" } }, parts: { where: { status: { in: ["RESERVADA", "AGUARDANDO_COMPRA"] } } } },
    orderBy: [{ promisedAt: "asc" }, { openedAt: "asc" }],
  });
  const open = await db.timeEntry.findFirst({ where: { technicianId: user.id, endedAt: null }, include: { service: true, workOrder: { include: { vehicle: true } } } });
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{all ? "Oficina — todas as OS" : "Minhas OS"}</h1>
        {can(user.role, "os:ver_todas") && <Link href={all ? "?" : "?todos=1"} className="btn btn-sm">{all ? "Só as minhas" : "Ver todas"}</Link>}
      </div>
      {open && (
        <div className="alert alert-ok mb-4">
          <div className="text-xs uppercase tracking-wider">Em andamento desde {time(open.startedAt)}</div>
          <div className="font-semibold">{open.service.description}</div>
          <div className="text-sm">{open.workOrder.number} · {open.workOrder.vehicle.model} <Plate plate={open.workOrder.vehicle.plate} /></div>
        </div>
      )}
      {rows.length ? (
        <div className="space-y-4">
          {rows.map((w) => (
            <article key={w.id} className="card overflow-hidden">
              <header className="flex items-start justify-between gap-2 border-b border-line bg-surface-2 px-4 py-3">
                <div>
                  <div className="text-lg font-semibold">{w.vehicle.make} {w.vehicle.model}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-sm"><Plate plate={w.vehicle.plate} /> <span className="text-muted">{w.number}</span></div>
                </div>
                <StatusBadge status={w.status} />
              </header>
              <div className="space-y-3 px-4 py-3">
                {w.complaint && <p className="text-sm whitespace-pre-line"><span className="text-muted">Problema: </span>{w.complaint}</p>}
                {w.parts.some((p) => p.status === "AGUARDANDO_COMPRA") && <p className="alert alert-warn text-sm">Aguardando peça: {w.parts.filter((p) => p.status === "AGUARDANDO_COMPRA").map((p) => p.description).join(", ")}</p>}
                {w.services.map((s) => {
                  const mine = s.timeEntries.find((t) => !t.endedAt && t.technicianId === user.id);
                  const worked = s.timeEntries.reduce((a, t) => a + entryMinutes(t), 0);
                  const canRun = can(user.role, "os:executar") && w.status === "EM_EXECUCAO" && !["CONCLUIDO", "CANCELADO"].includes(s.status);
                  return (
                    <div key={s.id} className="rounded-lg border border-line p-3">
                      <div className="font-medium">{s.description}</div>
                      <div className="text-xs text-muted">{SVC_TXT[s.status]} · vendido {minutesLabel(s.soldMin)} · trabalhado {minutesLabel(worked)}</div>
                      {canRun && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {mine ? (["pause", "parts", "finish"] as const).map((op) => (
                            <ActionForm key={op} action={timerAction}>
                              <input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="op" value={op} />
                              <Submit className={`btn w-full !min-h-12 ${op === "finish" ? "btn-primary" : ""}`}>{op === "pause" ? "Pausar" : op === "parts" ? "Falta peça" : "Finalizar"}</Submit>
                            </ActionForm>
                          )) : (
                            <ActionForm action={timerAction} className="col-span-3">
                              <input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="op" value="start" />
                              <Submit className="btn btn-primary w-full !min-h-12">{s.status === "PAUSADO" ? "Retomar" : "Iniciar"}</Submit>
                            </ActionForm>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!w.services.length && <p className="text-sm text-muted">{w.status === "AGUARDANDO_DIAGNOSTICO" || w.status === "EM_DIAGNOSTICO" ? "Faça o diagnóstico na OS." : "Sem serviços aprovados ainda."}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/os/${w.id}?tab=${["AGUARDANDO_DIAGNOSTICO", "EM_DIAGNOSTICO"].includes(w.status) ? "diagnostico" : w.status === "CONTROLE_QUALIDADE" ? "qualidade" : "execucao"}`} className="btn w-full">Abrir OS</Link>
                  <a href={`/os/${w.id}/imprimir?via=oficina`} className="btn w-full">Ficha da oficina</a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>Nenhuma OS atribuída a você no momento.</Empty>}
    </div>
  );
}
