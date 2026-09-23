import type { PurchaseOrderItem, PurchaseStatus } from "@prisma/client";
import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { can, purchaseLimit } from "./rbac";
import { RuleError, transition } from "./workflow";
import { stockEntry, reservedQty } from "./inventory";
import { createTitles, parseTerms, CATEGORY, COST_CENTER_OFICINA } from "./finance";
import { money } from "./format";

// Compras (spec §6.15): RASCUNHO → (AGUARDANDO_APROVACAO) → APROVADO → ENVIADO → RECEBIDO_PARCIAL → RECEBIDO.
// O recebimento dá entrada no estoque (custo com frete rateado) e gera os títulos a pagar pela condição do pedido.

export const PO_STATUS_LABEL: Record<PurchaseStatus, string> = {
  RASCUNHO: "Rascunho", AGUARDANDO_APROVACAO: "Aguardando aprovação", APROVADO: "Aprovado", ENVIADO: "Enviado ao fornecedor",
  RECEBIDO_PARCIAL: "Recebido parcialmente", RECEBIDO: "Recebido", CANCELADO: "Cancelado",
};
export const PO_OPEN: PurchaseStatus[] = ["RASCUNHO", "AGUARDANDO_APROVACAO", "APROVADO", "ENVIADO", "RECEBIDO_PARCIAL"];

export const poGoods = (items: Pick<PurchaseOrderItem, "quantity" | "unitCost">[]) => items.reduce((s, i) => s + Math.round(i.quantity * i.unitCost), 0);

/** Quantidade já pedida e ainda não recebida, por item de estoque. */
export async function onOrderQty(tx: Tx, itemIds?: string[]) {
  const rows = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrder: { status: { in: PO_OPEN } }, ...(itemIds && { inventoryItemId: { in: itemIds } }) },
    select: { inventoryItemId: true, quantity: true, receivedQty: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.inventoryItemId, (map.get(r.inventoryItemId) ?? 0) + Math.max(0, r.quantity - r.receivedQty));
  return map;
}

/** Sugestão de compra: itens abaixo do mínimo e peças de OS aguardando compra, descontando o que já está pedido. */
export async function purchaseSuggestions(tx: Tx) {
  const [items, waiting] = await Promise.all([
    tx.inventoryItem.findMany({ where: { active: true }, include: { supplier: true } }),
    tx.workOrderPart.findMany({ where: { status: "AGUARDANDO_COMPRA", inventoryItemId: { not: null } }, include: { workOrder: true } }),
  ]);
  const onOrder = await onOrderQty(tx);
  const out: { item: (typeof items)[number]; available: number; onOrder: number; waitingQty: number; suggested: number; reason: string; workOrders: string[] }[] = [];
  for (const item of items) {
    const reserved = await reservedQty(tx, item.id);
    const wait = waiting.filter((w) => w.inventoryItemId === item.id);
    const waitingQty = wait.reduce((s, w) => s + w.quantity, 0);
    const available = item.onHand - reserved;
    const ordered = onOrder.get(item.id) ?? 0;
    const target = Math.max(item.maxQty ?? item.minQty, item.minQty);
    const need = Math.max(0, waitingQty + target - available - ordered);
    const belowMin = available + ordered < item.minQty;
    if (need > 0 && (belowMin || waitingQty > ordered)) {
      out.push({
        item, available, onOrder: ordered, waitingQty, suggested: Math.ceil(need), workOrders: wait.map((w) => w.workOrder.number),
        reason: waitingQty > ordered ? "OS aguardando peça" : "Abaixo do mínimo",
      });
    }
  }
  return out.sort((a, b) => (a.reason === b.reason ? a.item.name.localeCompare(b.item.name) : a.reason === "OS aguardando peça" ? -1 : 1));
}

async function loadPO(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`;
  return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true, receipts: true } });
}

export async function submitPurchaseOrder(tx: Tx, user: SessionUser, id: string) {
  const po = await loadPO(tx, id);
  if (po.status !== "RASCUNHO") throw new RuleError("Somente rascunhos podem ser enviados para aprovação.");
  if (!po.items.length) throw new RuleError("Adicione ao menos um item.");
  parseTerms(po.paymentTerms);
  const total = poGoods(po.items) + po.freight;
  const auto = total <= purchaseLimit(user.role);
  await tx.purchaseOrder.update({
    where: { id },
    data: auto
      ? { status: "APROVADO", approvedById: user.id, approvedByName: `${user.name} (dentro da alçada)`, approvedAt: new Date() }
      : { status: "AGUARDANDO_APROVACAO" },
  });
  await audit({ action: auto ? "APPROVE" : "SUBMIT", entity: "PurchaseOrder", entityId: id, userId: user.id, userName: user.name, after: { total, limit: purchaseLimit(user.role) } }, tx);
  return auto;
}

export async function approvePurchaseOrder(tx: Tx, user: SessionUser, id: string, approve: boolean, reason?: string | null) {
  if (!can(user.role, "compras:aprovar")) throw new RuleError("Você não tem alçada para aprovar pedidos.");
  const po = await loadPO(tx, id);
  if (po.status !== "AGUARDANDO_APROVACAO") throw new RuleError("Pedido não está aguardando aprovação.");
  if (po.createdById === user.id && user.role !== "ADMIN") throw new RuleError("Segregação de funções: quem criou o pedido não pode aprová-lo.");
  if (!approve && !reason?.trim()) throw new RuleError("Informe o motivo da reprovação.");
  await tx.purchaseOrder.update({
    where: { id },
    data: approve
      ? { status: "APROVADO", approvedById: user.id, approvedByName: user.name, approvedAt: new Date() }
      : { status: "RASCUNHO", notes: [po.notes, `Reprovado por ${user.name}: ${reason}`].filter(Boolean).join("\n") },
  });
  await audit({ action: approve ? "APPROVE" : "REJECT", entity: "PurchaseOrder", entityId: id, userId: user.id, userName: user.name, after: { total: poGoods(po.items) + po.freight, reason } }, tx);
}

export async function markSent(tx: Tx, user: SessionUser, id: string) {
  const po = await loadPO(tx, id);
  if (po.status !== "APROVADO") throw new RuleError("Só pedidos aprovados podem ser enviados ao fornecedor.");
  await tx.purchaseOrder.update({ where: { id }, data: { status: "ENVIADO", sentAt: new Date() } });
  await audit({ action: "SEND", entity: "PurchaseOrder", entityId: id, userId: user.id, userName: user.name }, tx);
}

export async function cancelPurchaseOrder(tx: Tx, user: SessionUser, id: string, reason: string) {
  if (!reason.trim()) throw new RuleError("Informe o motivo do cancelamento.");
  const po = await loadPO(tx, id);
  if (po.status === "CANCELADO" || po.status === "RECEBIDO") throw new RuleError("Pedido já encerrado.");
  if (po.receipts.length) throw new RuleError("Pedido com recebimento não pode ser cancelado. Encerre o saldo pendente com o fornecedor.");
  await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELADO", cancelReason: reason } });
  await audit({ action: "CANCEL", entity: "PurchaseOrder", entityId: id, userId: user.id, userName: user.name, after: { reason } }, tx);
}

type ReceiveInput = {
  purchaseOrderId: string; lines: { poItemId: string; quantity: number }[];
  invoiceNumber?: string | null; invoiceDate?: Date | null; freight?: number; notes?: string | null;
};

export async function receivePurchaseOrder(tx: Tx, user: SessionUser, r: ReceiveInput) {
  const po = await loadPO(tx, r.purchaseOrderId);
  if (!["APROVADO", "ENVIADO", "RECEBIDO_PARCIAL"].includes(po.status)) throw new RuleError("O pedido precisa estar aprovado para receber mercadorias.");
  const lines = r.lines.filter((l) => l.quantity > 0);
  if (!lines.length) throw new RuleError("Informe a quantidade recebida de ao menos um item.");
  for (const l of lines) {
    const it = po.items.find((i) => i.id === l.poItemId);
    if (!it) throw new RuleError("Item não pertence ao pedido.");
    const pending = Math.round((it.quantity - it.receivedQty) * 1000) / 1000;
    if (l.quantity > pending) throw new RuleError(`"${it.description}": recebendo ${l.quantity}, pendente ${pending}.`);
  }
  const freight = r.freight ?? (po.receipts.length ? 0 : po.freight);
  if (freight < 0) throw new RuleError("Frete inválido.");
  const goods = lines.reduce((s, l) => s + Math.round(l.quantity * po.items.find((i) => i.id === l.poItemId)!.unitCost), 0);

  const receipt = await tx.goodsReceipt.create({
    data: { purchaseOrderId: po.id, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, freight, total: goods + freight, notes: r.notes, userId: user.id, userName: user.name },
  });
  const touchedItems: string[] = [];
  let freightLeft = freight;
  for (const [idx, l] of lines.entries()) {
    const it = po.items.find((i) => i.id === l.poItemId)!;
    const value = Math.round(l.quantity * it.unitCost);
    const share = idx === lines.length - 1 ? freightLeft : goods ? Math.round((freight * value) / goods) : 0;
    freightLeft -= share;
    const unitCost = Math.round(it.unitCost + share / l.quantity);
    await tx.goodsReceiptItem.create({ data: { receiptId: receipt.id, poItemId: it.id, quantity: l.quantity, unitCost } });
    await tx.purchaseOrderItem.update({ where: { id: it.id }, data: { receivedQty: { increment: l.quantity } } });
    await stockEntry(tx, user, it.inventoryItemId, l.quantity, unitCost, `${po.number}${r.invoiceNumber ? ` · NF ${r.invoiceNumber}` : ""}`);
    touchedItems.push(it.inventoryItemId);
  }
  const after = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
  const complete = after.every((i) => i.receivedQty >= i.quantity - 1e-9);
  await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: complete ? "RECEBIDO" : "RECEBIDO_PARCIAL" } });

  const titles = await createTitles(tx, user, {
    kind: "PAGAR", description: `${po.number}${r.invoiceNumber ? ` — NF ${r.invoiceNumber}` : ""}`, amount: goods + freight,
    dueDays: parseTerms(po.paymentTerms), baseDate: r.invoiceDate ?? new Date(), categoryId: CATEGORY.COMPRAS, costCenterId: COST_CENTER_OFICINA,
    supplierId: po.supplierId, purchaseOrderId: po.id, goodsReceiptId: receipt.id, document: r.invoiceNumber, method: "BOLETO",
  });
  await audit({ action: "RECEIVE", entity: "PurchaseOrder", entityId: po.id, userId: user.id, userName: user.name, after: { receiptId: receipt.id, invoice: r.invoiceNumber, goods, freight, titles: titles.map((t) => t.number), complete } }, tx);

  // OS que aguardavam estas peças e agora têm tudo reservado voltam para execução
  const released: string[] = [];
  const waitingOrders = await tx.workOrder.findMany({ where: { status: "AGUARDANDO_PECAS", parts: { some: { inventoryItemId: { in: touchedItems } } } } });
  for (const wo of waitingOrders) {
    const missing = await tx.workOrderPart.count({ where: { workOrderId: wo.id, status: "AGUARDANDO_COMPRA" } });
    if (!missing) {
      await transition(tx, wo.id, "EM_EXECUCAO", user, { source: "AUTOMACAO", reason: `Peças recebidas (${po.number})` });
      released.push(wo.number);
    }
  }
  return { receipt, titles, complete, released, message: `Recebido ${money(goods + freight)} em ${titles.length} título(s) a pagar.` };
}
