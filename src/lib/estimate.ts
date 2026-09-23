import { randomBytes } from "crypto";
import type { EstimateItem, ItemClass, ItemType } from "@prisma/client";
import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import { sha256 } from "./hash";
import { audit } from "./audit";
import { transition, RuleError } from "./workflow";
import { reservedQty } from "./inventory";

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  SERVICO: "Serviço", PECA: "Peça", CONSUMIVEL: "Consumível", TERCEIRO: "Terceiro", TAXA: "Taxa",
};
export const ITEM_CLASS_LABEL: Record<ItemClass, string> = {
  OBRIGATORIO: "Obrigatório", RECOMENDADO: "Recomendado", PREVENTIVO: "Preventivo", OPCIONAL: "Opcional",
};

export type SnapshotItem = {
  id: string;
  type: ItemType;
  classification: ItemClass;
  description: string;
  quantity: number;
  minutes: number | null;
  unitPrice: number;
  discount: number;
  gross: number;
  total: number;
  unitCost: number;
  inventoryItemId: string | null;
  serviceId: string | null;
};
export type Snapshot = { items: SnapshotItem[]; subtotal: number; discount: number; total: number; notes: string | null };

export const lineGross = (i: Pick<EstimateItem, "quantity" | "unitPrice">) => Math.round(i.quantity * i.unitPrice);
export const lineTotal = (i: Pick<EstimateItem, "quantity" | "unitPrice" | "discount">) => lineGross(i) - i.discount;

export function buildSnapshot(items: EstimateItem[], notes: string | null): Snapshot {
  const snap = items
    .sort((a, b) => a.sortOrder - b.sortOrder || +a.createdAt - +b.createdAt)
    .map<SnapshotItem>((i) => ({
      id: i.id, type: i.type, classification: i.classification, description: i.description, quantity: i.quantity,
      minutes: i.minutes, unitPrice: i.unitPrice, discount: i.discount, gross: lineGross(i), total: lineTotal(i),
      unitCost: i.unitCost, inventoryItemId: i.inventoryItemId, serviceId: i.serviceId,
    }));
  const subtotal = snap.reduce((s, i) => s + i.gross, 0);
  const discount = snap.reduce((s, i) => s + i.discount, 0);
  return { items: snap, subtotal, discount, total: subtotal - discount, notes };
}

const LINK_DAYS = 7;

export async function createApprovalLink(tx: Tx, versionId: string, user: SessionUser) {
  await tx.approvalLink.updateMany({ where: { versionId, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = randomBytes(24).toString("base64url");
  await tx.approvalLink.create({
    data: { versionId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + LINK_DAYS * 86400_000), createdById: user.id },
  });
  return token;
}

/** Congela o rascunho numa nova versão imutável, gera link de aprovação e move a OS para AGUARDANDO_APROVACAO. */
export async function sendEstimate(tx: Tx, estimateId: string, user: SessionUser) {
  const est = await tx.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    include: { items: true, versions: { orderBy: { version: "desc" }, take: 1 }, workOrder: true },
  });
  if (est.status === "RESPONDIDO")
    throw new RuleError("Este orçamento já foi respondido pelo cliente. Para novos itens, crie um orçamento complementar.");
  if (!est.items.length) throw new RuleError("Adicione ao menos um item antes de enviar.");
  if (!["ORCAMENTO", "AGUARDANDO_APROVACAO", "EM_EXECUCAO", "AGUARDANDO_PECAS"].includes(est.workOrder.status))
    throw new RuleError("A OS não está em uma etapa que permita enviar orçamento.");

  const snapshot = buildSnapshot(est.items, est.notes);
  const hash = sha256(JSON.stringify(snapshot));
  const last = est.versions[0];
  if (last && last.contentHash === hash && est.status === "ENVIADO")
    throw new RuleError(`Nada mudou desde a versão ${last.version}. Use "Gerar novo link" para reenviar.`);

  const version = await tx.estimateVersion.create({
    data: {
      estimateId, version: (last?.version ?? 0) + 1, snapshot, subtotal: snapshot.subtotal, discount: snapshot.discount,
      total: snapshot.total, contentHash: hash, sentById: user.id, sentByName: user.name,
    },
  });
  // Versões anteriores ainda abertas perdem o link
  await tx.approvalLink.updateMany({ where: { version: { estimateId }, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = await createApprovalLink(tx, version.id, user);
  await tx.estimate.update({ where: { id: estimateId }, data: { status: "ENVIADO" } });
  await transition(tx, est.workOrderId, "AGUARDANDO_APROVACAO", user, {
    source: "TELA", reason: `${est.number} v${version.version} enviado`,
  });
  await audit({ action: "SEND", entity: "Estimate", entityId: estimateId, userId: user.id, userName: user.name, after: { version: version.version, total: snapshot.total, hash } }, tx);
  return { version, token };
}

export type DecisionInput = { itemId: string; decision: "APROVADO" | "RECUSADO" };
type ApprovalMeta = {
  channel: string; approverName: string; evidence?: string | null; ip?: string | null; userAgent?: string | null;
  removedPartsDestination?: string | null;
};

/**
 * Registra a resposta do cliente para TODOS os itens da versão (append-only),
 * materializa os itens aprovados na OS (serviços, peças com reserva) e avança o status.
 */
export async function recordDecisions(tx: Tx, versionId: string, decisions: DecisionInput[], meta: ApprovalMeta, user: SessionUser | null) {
  const version = await tx.estimateVersion.findUniqueOrThrow({ where: { id: versionId }, include: { estimate: { include: { workOrder: true, versions: { select: { version: true } } } } } });
  const est = version.estimate;
  const latest = Math.max(...est.versions.map((v) => v.version));
  if (version.version !== latest) throw new RuleError("Esta versão foi substituída por uma mais recente.");
  if (est.status !== "ENVIADO") throw new RuleError("Este orçamento não está aguardando resposta.");
  if (!meta.approverName.trim()) throw new RuleError("Informe o nome de quem aprovou.");
  if (!user && meta.channel !== "LINK") throw new RuleError("Canal inválido.");
  if (user && ["TELEFONE", "EMAIL", "WHATSAPP"].includes(meta.channel) && !meta.evidence?.trim())
    throw new RuleError("Aprovação remota registrada pelo consultor exige evidência (ex.: horário da ligação, print, e-mail).");

  const snap = version.snapshot as unknown as Snapshot;
  const byId = new Map(decisions.map((d) => [d.itemId, d.decision]));
  const missing = snap.items.filter((i) => !byId.has(i.id));
  if (missing.length) throw new RuleError(`Decida todos os itens (faltam ${missing.length}).`);

  for (const item of snap.items) {
    await tx.approval.create({
      data: {
        versionId, itemId: item.id, decision: byId.get(item.id)!, channel: meta.channel, approverName: meta.approverName.trim(),
        evidence: meta.evidence, ip: meta.ip, userAgent: meta.userAgent, userId: user?.id, removedPartsDestination: meta.removedPartsDestination,
      },
    });
  }
  await tx.estimate.update({ where: { id: est.id }, data: { status: "RESPONDIDO" } });
  await tx.approvalLink.updateMany({ where: { versionId, revokedAt: null }, data: { revokedAt: new Date() } });

  const approved = snap.items.filter((i) => byId.get(i.id) === "APROVADO");
  for (const item of approved) {
    if (item.type === "SERVICO") {
      await tx.workOrderService.create({
        data: { workOrderId: est.workOrderId, sourceItemId: item.id, versionId, description: item.description, soldMin: Math.round((item.minutes ?? 60) * item.quantity), price: item.total, technicianId: est.workOrder.technicianId },
      });
    } else {
      let status = "APLICADA"; // terceiros, taxas e consumíveis sem controle de estoque
      if (item.inventoryItemId) {
        const inv = await tx.inventoryItem.findUniqueOrThrow({ where: { id: item.inventoryItemId } });
        const available = inv.onHand - (await reservedQty(tx, inv.id));
        status = available >= item.quantity ? "RESERVADA" : "AGUARDANDO_COMPRA";
      } else if (item.type === "PECA") {
        status = "AGUARDANDO_COMPRA";
      }
      await tx.workOrderPart.create({
        data: {
          workOrderId: est.workOrderId, sourceItemId: item.id, versionId, type: item.type, inventoryItemId: item.inventoryItemId,
          description: item.description, quantity: item.quantity, price: item.total, unitCost: item.unitCost, status,
          appliedAt: status === "APLICADA" ? new Date() : null,
        },
      });
    }
  }
  await audit({
    action: "APPROVE", entity: "EstimateVersion", entityId: versionId, userId: user?.id, userName: user?.name ?? `Cliente: ${meta.approverName}`,
    after: { channel: meta.channel, approved: approved.map((i) => i.id), refused: snap.items.filter((i) => byId.get(i.id) === "RECUSADO").map((i) => i.id), ip: meta.ip },
    ip: meta.ip, userAgent: meta.userAgent,
  }, tx);

  // Próximo status
  const wo = est.workOrder;
  const hasWork = (await tx.workOrderService.count({ where: { workOrderId: wo.id, status: { not: "CANCELADO" } } }))
    + (await tx.workOrderPart.count({ where: { workOrderId: wo.id, status: { not: "CANCELADA" } } }));
  const waitingParts = await tx.workOrderPart.count({ where: { workOrderId: wo.id, status: "AGUARDANDO_COMPRA" } });
  const opts = { source: user ? "TELA" : "CLIENTE", reason: `Resposta ao ${est.number} v${version.version} (${meta.channel})` };
  if (!hasWork) await transition(tx, wo.id, "ENCERRADA_SEM_SERVICO", user, opts);
  else if (waitingParts) await transition(tx, wo.id, "AGUARDANDO_PECAS", user, opts);
  else await transition(tx, wo.id, "EM_EXECUCAO", user, opts);

  return { approved: approved.length, total: snap.items.length };
}
