import type { ServicePhase, WorkOrderStatus } from "@prisma/client";
import type { Tx } from "./db";

// Fases que o cliente acompanha (e às quais as câmeras são associadas).
export const PHASES: ServicePhase[] = ["AGENDAMENTO", "CHECK_IN", "DIAGNOSTICO", "ORCAMENTO", "EXECUCAO", "LAVAGEM", "CHECK_OUT"];

export const PHASE_LABEL: Record<ServicePhase, string> = {
  AGENDAMENTO: "Agendamento",
  CHECK_IN: "Check-in",
  DIAGNOSTICO: "Diagnóstico",
  ORCAMENTO: "Orçamento",
  EXECUCAO: "Execução",
  LAVAGEM: "Lavagem",
  CHECK_OUT: "Check-out",
};

const BY_STATUS: Partial<Record<WorkOrderStatus, ServicePhase>> = {
  PRE_OS: "AGENDAMENTO",
  CHECK_IN: "CHECK_IN",
  AGUARDANDO_DIAGNOSTICO: "DIAGNOSTICO",
  EM_DIAGNOSTICO: "DIAGNOSTICO",
  ORCAMENTO: "ORCAMENTO",
  AGUARDANDO_APROVACAO: "ORCAMENTO",
  AGUARDANDO_PECAS: "EXECUCAO",
  EM_EXECUCAO: "EXECUCAO",
  CONTROLE_QUALIDADE: "EXECUCAO",
  PREPARACAO: "LAVAGEM",
  PRONTO_ENTREGA: "CHECK_OUT",
};

/** Fase atual da OS (null quando entregue, encerrada ou cancelada). */
export const phaseOf = (s: WorkOrderStatus): ServicePhase | null => BY_STATUS[s] ?? null;

/** Associa à OS as câmeras padrão da fase, se a OS ainda não tiver câmera nessa fase. */
export async function ensurePhaseCameras(tx: Tx, workOrderId: string, phase: ServicePhase | null) {
  if (!phase) return;
  const has = await tx.workOrderCamera.count({ where: { workOrderId, phase } });
  if (has) return;
  const defaults = await tx.cameraPhaseDefault.findMany({ where: { phase, camera: { active: true } } });
  if (!defaults.length) return;
  await tx.workOrderCamera.createMany({ data: defaults.map((d) => ({ workOrderId, phase, cameraId: d.cameraId })), skipDuplicates: true });
}
