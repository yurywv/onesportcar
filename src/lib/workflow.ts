import type { WorkOrderStatus } from "@prisma/client";
import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import { audit } from "./audit";

// Máquina de estados da OS (spec §5.2). Toda transição passa por transition(), que valida no servidor.

export const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  PRE_OS: "Agendado",
  CHECK_IN: "Check-in",
  AGUARDANDO_DIAGNOSTICO: "Aguardando diagnóstico",
  EM_DIAGNOSTICO: "Em diagnóstico",
  ORCAMENTO: "Orçamento",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  AGUARDANDO_PECAS: "Aguardando peças",
  EM_EXECUCAO: "Em execução",
  CONTROLE_QUALIDADE: "Controle de qualidade",
  PREPARACAO: "Lavagem/preparação",
  PRONTO_ENTREGA: "Pronto para entrega",
  ENTREGUE: "Entregue",
  ENCERRADA_SEM_SERVICO: "Encerrada sem serviço",
  CANCELADA: "Cancelada",
};

export const KANBAN_COLUMNS: WorkOrderStatus[] = [
  "PRE_OS", "CHECK_IN", "AGUARDANDO_DIAGNOSTICO", "EM_DIAGNOSTICO", "ORCAMENTO", "AGUARDANDO_APROVACAO",
  "AGUARDANDO_PECAS", "EM_EXECUCAO", "CONTROLE_QUALIDADE", "PREPARACAO", "PRONTO_ENTREGA", "ENTREGUE",
];

export const OPEN_STATUSES: WorkOrderStatus[] = KANBAN_COLUMNS.filter((s) => s !== "ENTREGUE" && s !== "PRE_OS");
export const FINAL_STATUSES: WorkOrderStatus[] = ["ENTREGUE", "CANCELADA"];

/** Arestas permitidas. As marcadas como "auto" só acontecem como efeito de outra operação (check-in, envio, CQ, check-out). */
const EDGES: Record<WorkOrderStatus, { to: WorkOrderStatus; manual: boolean }[]> = {
  PRE_OS: [{ to: "CHECK_IN", manual: false }, { to: "CANCELADA", manual: true }],
  CHECK_IN: [{ to: "AGUARDANDO_DIAGNOSTICO", manual: false }, { to: "CANCELADA", manual: true }],
  AGUARDANDO_DIAGNOSTICO: [{ to: "EM_DIAGNOSTICO", manual: true }, { to: "CANCELADA", manual: true }],
  EM_DIAGNOSTICO: [{ to: "ORCAMENTO", manual: true }, { to: "CANCELADA", manual: true }],
  ORCAMENTO: [{ to: "AGUARDANDO_APROVACAO", manual: false }, { to: "CANCELADA", manual: true }],
  AGUARDANDO_APROVACAO: [
    { to: "EM_EXECUCAO", manual: false }, { to: "AGUARDANDO_PECAS", manual: false },
    { to: "ENCERRADA_SEM_SERVICO", manual: false }, { to: "CANCELADA", manual: true },
  ],
  AGUARDANDO_PECAS: [{ to: "EM_EXECUCAO", manual: true }, { to: "AGUARDANDO_APROVACAO", manual: false }],
  EM_EXECUCAO: [
    { to: "CONTROLE_QUALIDADE", manual: true }, { to: "AGUARDANDO_APROVACAO", manual: false },
    { to: "AGUARDANDO_PECAS", manual: true },
  ],
  CONTROLE_QUALIDADE: [{ to: "PREPARACAO", manual: false }, { to: "EM_EXECUCAO", manual: false }],
  PREPARACAO: [{ to: "PRONTO_ENTREGA", manual: true }],
  PRONTO_ENTREGA: [{ to: "ENTREGUE", manual: false }, { to: "PREPARACAO", manual: true }],
  ENCERRADA_SEM_SERVICO: [{ to: "ENTREGUE", manual: false }],
  ENTREGUE: [],
  CANCELADA: [],
};

export class RuleError extends Error {}

/** Pré-condições de negócio para entrar no status de destino. Retorna a mensagem de bloqueio ou null. */
async function precondition(tx: Tx, woId: string, to: WorkOrderStatus): Promise<string | null> {
  switch (to) {
    case "AGUARDANDO_DIAGNOSTICO": {
      const ci = await tx.checkIn.findUnique({ where: { workOrderId: woId } });
      return ci?.locked ? null : "O check-in precisa estar assinado pelo cliente.";
    }
    case "EM_DIAGNOSTICO": {
      const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: woId } });
      return wo.technicianId ? null : "Atribua um técnico à OS antes de iniciar o diagnóstico.";
    }
    case "ORCAMENTO": {
      const n = await tx.diagnostic.count({ where: { workOrderId: woId, finishedAt: { not: null } } });
      return n > 0 ? null : "Registre e conclua ao menos um diagnóstico.";
    }
    case "EM_EXECUCAO": {
      const waiting = await tx.workOrderPart.count({ where: { workOrderId: woId, status: "AGUARDANDO_COMPRA" } });
      return waiting === 0 ? null : `Há ${waiting} peça(s) aguardando compra/recebimento.`;
    }
    case "CONTROLE_QUALIDADE": {
      const [pendingSvc, openTime, pendingParts, pendingEst] = await Promise.all([
        tx.workOrderService.count({ where: { workOrderId: woId, status: { notIn: ["CONCLUIDO", "CANCELADO"] } } }),
        tx.timeEntry.count({ where: { workOrderId: woId, endedAt: null } }),
        tx.workOrderPart.count({ where: { workOrderId: woId, status: { in: ["RESERVADA", "AGUARDANDO_COMPRA"] } } }),
        tx.estimate.count({ where: { workOrderId: woId, status: "ENVIADO" } }),
      ]);
      if (pendingEst) return "Há orçamento aguardando resposta do cliente.";
      if (pendingSvc) return `Há ${pendingSvc} serviço(s) não concluído(s).`;
      if (openTime) return "Há apontamento de horas em aberto.";
      if (pendingParts) return `Há ${pendingParts} peça(s) reservada(s) ainda não aplicada(s) ou devolvida(s).`;
      return null;
    }
    case "CANCELADA": {
      const [paid, applied] = await Promise.all([
        tx.payment.count({ where: { workOrderId: woId, status: "CONFIRMADO" } }),
        tx.workOrderPart.count({ where: { workOrderId: woId, status: "APLICADA", inventoryItemId: { not: null } } }),
      ]);
      if (paid) return "OS com pagamento registrado não pode ser cancelada. Estorne os pagamentos primeiro.";
      if (applied) return "Devolva ao estoque as peças já aplicadas antes de cancelar.";
      return null;
    }
    default:
      return null;
  }
}

export function allowedManualTargets(from: WorkOrderStatus): WorkOrderStatus[] {
  return EDGES[from].filter((e) => e.manual).map((e) => e.to);
}

type TransitionOpts = { reason?: string; source?: string; manual?: boolean };

export async function transition(tx: Tx, woId: string, to: WorkOrderStatus, user: SessionUser | null, opts: TransitionOpts = {}) {
  const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: woId } });
  if (wo.status === to) return wo;
  const edge = EDGES[wo.status].find((e) => e.to === to);
  if (!edge) throw new RuleError(`Não é possível mover de "${STATUS_LABEL[wo.status]}" para "${STATUS_LABEL[to]}".`);
  if (opts.manual && !edge.manual)
    throw new RuleError(`"${STATUS_LABEL[to]}" é alcançado automaticamente pela operação correspondente (ex.: assinatura, envio de orçamento, CQ, check-out).`);
  if (to === "CANCELADA" && !opts.reason?.trim()) throw new RuleError("Informe o motivo do cancelamento.");
  const block = await precondition(tx, woId, to);
  if (block) throw new RuleError(block);

  if (to === "CANCELADA") {
    await tx.workOrderPart.updateMany({ where: { workOrderId: woId, status: { in: ["RESERVADA", "AGUARDANDO_COMPRA"] } }, data: { status: "CANCELADA" } });
  }
  const updated = await tx.workOrder.update({
    where: { id: woId },
    data: {
      status: to,
      closedAt: FINAL_STATUSES.includes(to) ? new Date() : undefined,
      cancelReason: to === "CANCELADA" ? opts.reason : undefined,
    },
  });
  await tx.workOrderStatusHistory.create({
    data: { workOrderId: woId, fromStatus: wo.status, toStatus: to, userId: user?.id, userName: user?.name ?? "Cliente", reason: opts.reason, source: opts.source ?? "TELA" },
  });
  await audit({ action: "STATUS", entity: "WorkOrder", entityId: woId, userId: user?.id, userName: user?.name, before: { status: wo.status }, after: { status: to, reason: opts.reason } }, tx);
  return updated;
}
