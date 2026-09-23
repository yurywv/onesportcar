import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { RuleError } from "./workflow";

// Regras de estoque (spec §6.14): saldo é consequência dos movimentos; custo médio ponderado móvel;
// reserva na aprovação; baixa na aplicação à OS; estoque negativo bloqueado.

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function reservedQty(tx: Tx, itemId: string) {
  const r = await tx.workOrderPart.aggregate({ where: { inventoryItemId: itemId, status: "RESERVADA" }, _sum: { quantity: true } });
  return r._sum.quantity ?? 0;
}

type MoveInput = {
  itemId: string; type: string; quantity: number; unitCost?: number;
  workOrderId?: string; partId?: string; reference?: string; reason?: string;
};

async function move(tx: Tx, user: SessionUser, m: MoveInput) {
  // Trava a linha do item para evitar corrida no saldo/custo médio
  await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${m.itemId} FOR UPDATE`;
  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: m.itemId } });
  const qty = round3(m.quantity);
  const balance = round3(item.onHand + qty);
  if (balance < 0) throw new RuleError(`Saldo insuficiente de ${item.sku} (${item.onHand} ${item.unit}). Estoque negativo não é permitido.`);
  let unitCost = m.unitCost ?? item.avgCost;
  let avg = item.avgCost;
  if (qty > 0 && m.unitCost !== undefined) {
    avg = balance > 0 ? Math.round((Math.max(item.onHand, 0) * item.avgCost + qty * m.unitCost) / balance) : m.unitCost;
  }
  if (qty < 0) unitCost = item.avgCost;
  await tx.inventoryItem.update({ where: { id: item.id }, data: { onHand: balance, avgCost: avg } });
  const mv = await tx.inventoryMovement.create({
    data: {
      itemId: item.id, type: m.type, quantity: qty, unitCost, balanceAfter: balance, avgCostAfter: avg,
      workOrderId: m.workOrderId, partId: m.partId, reference: m.reference, reason: m.reason, userId: user.id, userName: user.name,
    },
  });
  await audit({ action: "STOCK_" + m.type, entity: "InventoryItem", entityId: item.id, userId: user.id, userName: user.name, before: { onHand: item.onHand, avgCost: item.avgCost }, after: { onHand: balance, avgCost: avg, quantity: qty, unitCost, workOrderId: m.workOrderId } }, tx);
  return mv;
}

export async function stockEntry(tx: Tx, user: SessionUser, itemId: string, quantity: number, unitCost: number, reference?: string) {
  if (quantity <= 0) throw new RuleError("Quantidade deve ser positiva.");
  if (unitCost < 0) throw new RuleError("Custo inválido.");
  const mv = await move(tx, user, { itemId, type: "ENTRADA", quantity, unitCost, reference });
  // Peças aguardando compra desse item passam a reservadas, por ordem de chegada da OS
  const waiting = await tx.workOrderPart.findMany({ where: { inventoryItemId: itemId, status: "AGUARDANDO_COMPRA" }, orderBy: { createdAt: "asc" } });
  let available = mv.balanceAfter - (await reservedQty(tx, itemId));
  for (const p of waiting) {
    if (available < p.quantity) break;
    await tx.workOrderPart.update({ where: { id: p.id }, data: { status: "RESERVADA" } });
    available -= p.quantity;
  }
  return mv;
}

export async function stockAdjust(tx: Tx, user: SessionUser, itemId: string, delta: number, reason: string) {
  if (!reason.trim()) throw new RuleError("Ajuste de estoque exige motivo.");
  if (!delta) throw new RuleError("Informe a diferença (positiva ou negativa).");
  return move(tx, user, { itemId, type: "AJUSTE", quantity: delta, reason });
}

/** Baixa a peça reservada na OS (requisição/entrega ao técnico). Grava o custo médio do momento na linha da OS. */
export async function applyPart(tx: Tx, user: SessionUser, partId: string) {
  const part = await tx.workOrderPart.findUniqueOrThrow({ where: { id: partId }, include: { workOrder: true } });
  if (part.status !== "RESERVADA") throw new RuleError("Só é possível aplicar peças reservadas.");
  if (!part.inventoryItemId) throw new RuleError("Peça sem item de estoque vinculado.");
  if (!["EM_EXECUCAO", "AGUARDANDO_PECAS"].includes(part.workOrder.status)) throw new RuleError("A OS precisa estar em execução.");
  // Libera a própria reserva e baixa o físico
  await tx.workOrderPart.update({ where: { id: part.id }, data: { status: "APLICANDO" } });
  const mv = await move(tx, user, { itemId: part.inventoryItemId, type: "SAIDA_OS", quantity: -part.quantity, workOrderId: part.workOrderId, partId: part.id, reference: part.workOrder.number });
  return tx.workOrderPart.update({ where: { id: part.id }, data: { status: "APLICADA", unitCost: mv.unitCost, appliedAt: new Date() } });
}

/** Devolve ao estoque uma peça aplicada (não usada), ao mesmo custo da baixa. */
export async function returnPart(tx: Tx, user: SessionUser, partId: string, reason: string) {
  const part = await tx.workOrderPart.findUniqueOrThrow({ where: { id: partId }, include: { workOrder: true } });
  if (!reason.trim()) throw new RuleError("Informe o motivo da devolução.");
  if (part.status === "RESERVADA") {
    return tx.workOrderPart.update({ where: { id: part.id }, data: { status: "DEVOLVIDA" } });
  }
  if (part.status !== "APLICADA" || !part.inventoryItemId) throw new RuleError("Esta peça não pode ser devolvida ao estoque.");
  if (["ENTREGUE", "CANCELADA"].includes(part.workOrder.status)) throw new RuleError("OS encerrada.");
  await move(tx, user, { itemId: part.inventoryItemId, type: "DEVOLUCAO_OS", quantity: part.quantity, unitCost: part.unitCost, workOrderId: part.workOrderId, partId: part.id, reference: part.workOrder.number, reason });
  return tx.workOrderPart.update({ where: { id: part.id }, data: { status: "DEVOLVIDA" } });
}
