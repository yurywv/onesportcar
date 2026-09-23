import type { Payment, TimeEntry, WorkOrderPart, WorkOrderService } from "@prisma/client";
import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { RuleError } from "./workflow";

export const PART_ACTIVE = ["RESERVADA", "AGUARDANDO_COMPRA", "APLICADA"];

export const entryMinutes = (t: Pick<TimeEntry, "startedAt" | "endedAt">, now = new Date()) =>
  Math.max(0, ((t.endedAt ?? now).getTime() - t.startedAt.getTime()) / 60000);

/** Totais da OS conforme os KPIs da spec §9. Custos de mão de obra usam o custo/hora do técnico. */
export function woTotals(input: {
  services: WorkOrderService[];
  parts: WorkOrderPart[];
  payments: Payment[];
  timeEntries: TimeEntry[];
  techCost: Map<string, number>;
}) {
  const services = input.services.filter((s) => s.status !== "CANCELADO");
  const parts = input.parts.filter((p) => PART_ACTIVE.includes(p.status));
  const servicesTotal = services.reduce((s, x) => s + x.price, 0);
  const partsTotal = parts.reduce((s, x) => s + x.price, 0);
  const total = servicesTotal + partsTotal;
  const paid = input.payments.filter((p) => p.status === "CONFIRMADO").reduce((s, p) => s + p.amount, 0);
  const workedMin = input.timeEntries.reduce((s, t) => s + entryMinutes(t), 0);
  const soldMin = services.reduce((s, x) => s + x.soldMin, 0);
  const laborCost = Math.round(input.timeEntries.reduce((s, t) => s + (entryMinutes(t) / 60) * (input.techCost.get(t.technicianId) ?? 0), 0));
  const partsCost = parts.filter((p) => p.status === "APLICADA").reduce((s, p) => s + Math.round(p.unitCost * p.quantity), 0);
  const margin = total - laborCost - partsCost;
  return {
    servicesTotal, partsTotal, total, paid, due: total - paid, workedMin, soldMin,
    efficiency: workedMin ? soldMin / workedMin : null, laborCost, partsCost, margin, marginPct: total ? margin / total : null,
  };
}

export async function startTimer(tx: Tx, user: SessionUser, serviceId: string) {
  const svc = await tx.workOrderService.findUniqueOrThrow({ where: { id: serviceId }, include: { workOrder: true } });
  if (svc.workOrder.status !== "EM_EXECUCAO") throw new RuleError("A OS precisa estar em execução para iniciar serviços.");
  if (svc.status === "CONCLUIDO" || svc.status === "CANCELADO") throw new RuleError("Serviço já encerrado.");
  const open = await tx.timeEntry.findFirst({ where: { technicianId: user.id, endedAt: null }, include: { service: true } });
  if (open) throw new RuleError(`Você já tem um apontamento aberto: "${open.service.description}". Pause-o primeiro.`);
  await tx.timeEntry.create({ data: { workOrderId: svc.workOrderId, serviceId, technicianId: user.id, technicianName: user.name } });
  await tx.workOrderService.update({ where: { id: serviceId }, data: { status: "EM_EXECUCAO", technicianId: user.id } });
  await audit({ action: "TIMER_START", entity: "WorkOrderService", entityId: serviceId, userId: user.id, userName: user.name }, tx);
}

export async function stopTimer(tx: Tx, user: SessionUser, serviceId: string, reason: "PAUSA" | "FINALIZADO" | "AGUARDANDO_PECA") {
  const open = await tx.timeEntry.findFirst({ where: { serviceId, technicianId: user.id, endedAt: null } });
  if (!open && reason !== "FINALIZADO") throw new RuleError("Não há apontamento aberto seu neste serviço.");
  if (open) await tx.timeEntry.update({ where: { id: open.id }, data: { endedAt: new Date(), endReason: reason } });
  if (reason === "FINALIZADO") {
    const others = await tx.timeEntry.count({ where: { serviceId, endedAt: null } });
    if (others) throw new RuleError("Outro técnico ainda tem apontamento aberto neste serviço.");
    const worked = await tx.timeEntry.count({ where: { serviceId } });
    if (!worked) throw new RuleError("Inicie o serviço antes de finalizá-lo (o apontamento é obrigatório).");
    await tx.workOrderService.update({ where: { id: serviceId }, data: { status: "CONCLUIDO", finishedAt: new Date() } });
  } else {
    await tx.workOrderService.update({ where: { id: serviceId }, data: { status: "PAUSADO" } });
  }
  await audit({ action: "TIMER_" + reason, entity: "WorkOrderService", entityId: serviceId, userId: user.id, userName: user.name }, tx);
}
