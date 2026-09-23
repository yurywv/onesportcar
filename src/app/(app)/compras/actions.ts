"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, req, num, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { nextNumber } from "@/lib/sequence";
import { parseMoney, fromLocalInput, money } from "@/lib/format";
import { parseTerms } from "@/lib/finance";
import { submitPurchaseOrder, approvePurchaseOrder, markSent, cancelPurchaseOrder, receivePurchaseOrder } from "@/lib/purchasing";

const refresh = (id: string) => { revalidatePath(`/compras/${id}`); revalidatePath("/compras"); };

export async function createPurchaseOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const user = await assertUser("compras:editar");
    const supplier = await db.supplier.findUniqueOrThrow({ where: { id: req(fd, "supplierId", "Fornecedor") } });
    if (!supplier.active) throw new RuleError("Fornecedor inativo.");
    // Itens vindos das sugestões: item_<inventoryId> = quantidade
    const lines = [...fd.entries()].filter(([k, v]) => k.startsWith("item_") && Number(String(v).replace(",", ".")) > 0)
      .map(([k, v]) => ({ id: k.slice(5), qty: Number(String(v).replace(",", ".")) }));
    const inv = lines.length ? await db.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.id) } } }) : [];
    const woId = str(fd, "workOrderId");
    id = await db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          number: await nextNumber(tx, user.branchId, "PED"), branchId: user.branchId, supplierId: supplier.id, workOrderId: woId,
          paymentTerms: supplier.paymentTerms ?? "30", expectedAt: supplier.leadTimeDays != null ? new Date(Date.now() + supplier.leadTimeDays * 86400_000) : null,
          createdById: user.id, createdByName: user.name,
          items: { create: lines.map((l, i) => { const it = inv.find((x) => x.id === l.id)!; return { inventoryItemId: it.id, description: it.name, quantity: l.qty, unitCost: it.avgCost, sortOrder: i }; }) },
        },
      });
      await audit({ action: "CREATE", entity: "PurchaseOrder", entityId: po.id, userId: user.id, userName: user.name, after: { number: po.number, supplier: supplier.name, items: lines.length } }, tx);
      return po.id;
    });
  });
  if (id) redirect(`/compras/${id}`);
  return r;
}

async function draft(id: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id } });
  if (po.status !== "RASCUNHO") throw new RuleError("Só é possível alterar pedidos em rascunho.");
  return po;
}

export async function updatePurchaseOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("compras:editar");
    const id = String(fd.get("id"));
    const before = await draft(id);
    const terms = req(fd, "paymentTerms", "Condição de pagamento");
    parseTerms(terms);
    const freight = parseMoney(fd.get("freight"));
    if (freight < 0) throw new RuleError("Frete inválido.");
    const exp = str(fd, "expectedAt");
    const data = { paymentTerms: terms, freight, expectedAt: exp ? fromLocalInput(`${exp}T12:00`) : null, notes: str(fd, "notes"), workOrderId: str(fd, "workOrderId") };
    await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data });
      await audit({ action: "UPDATE", entity: "PurchaseOrder", entityId: id, userId: user.id, userName: user.name, before: { paymentTerms: before.paymentTerms, freight: before.freight }, after: data }, tx);
    });
    refresh(id);
    return "Pedido atualizado.";
  });
}

export async function addPOItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("compras:editar");
    const id = String(fd.get("id"));
    await draft(id);
    const item = await db.inventoryItem.findUniqueOrThrow({ where: { id: req(fd, "inventoryItemId", "Item") } });
    const qty = num(fd, "quantity") ?? 0;
    if (qty <= 0) throw new RuleError("Quantidade deve ser maior que zero.");
    const cost = str(fd, "unitCost") ? parseMoney(fd.get("unitCost")) : item.avgCost;
    if (cost <= 0) throw new RuleError("Informe o custo unitário negociado.");
    const count = await db.purchaseOrderItem.count({ where: { purchaseOrderId: id } });
    await db.$transaction(async (tx) => {
      await tx.purchaseOrderItem.create({ data: { purchaseOrderId: id, inventoryItemId: item.id, description: item.name, quantity: qty, unitCost: cost, sortOrder: count } });
      await audit({ action: "ADD_ITEM", entity: "PurchaseOrder", entityId: id, userId: user.id, userName: user.name, after: { sku: item.sku, qty, unitCost: cost, lastAvgCost: item.avgCost } }, tx);
    });
    refresh(id);
    return cost > item.avgCost * 1.1 && item.avgCost > 0 ? `Item adicionado. Atenção: custo ${money(cost)} está mais de 10% acima do custo médio (${money(item.avgCost)}).` : "Item adicionado.";
  });
}

export async function removePOItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("compras:editar");
    const it = await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: String(fd.get("itemId")) } });
    await draft(it.purchaseOrderId);
    await db.$transaction(async (tx) => {
      await tx.purchaseOrderItem.delete({ where: { id: it.id } });
      await audit({ action: "REMOVE_ITEM", entity: "PurchaseOrder", entityId: it.purchaseOrderId, userId: user.id, userName: user.name, before: { description: it.description, quantity: it.quantity, unitCost: it.unitCost } }, tx);
    });
    refresh(it.purchaseOrderId);
    return "Item removido.";
  });
}

export async function poWorkflow(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const op = String(fd.get("op"));
    const id = String(fd.get("id"));
    const user = await assertUser(op === "approve" || op === "reject" ? "compras:aprovar" : "compras:editar");
    let msg = "";
    await db.$transaction(async (tx) => {
      if (op === "submit") msg = (await submitPurchaseOrder(tx, user, id)) ? "Pedido aprovado automaticamente (dentro da sua alçada)." : "Pedido enviado para aprovação do gestor (acima da sua alçada).";
      else if (op === "approve") { await approvePurchaseOrder(tx, user, id, true); msg = "Pedido aprovado."; }
      else if (op === "reject") { await approvePurchaseOrder(tx, user, id, false, str(fd, "reason")); msg = "Pedido devolvido para rascunho."; }
      else if (op === "send") { await markSent(tx, user, id); msg = "Pedido marcado como enviado ao fornecedor. (Envio automático por e-mail: canal não configurado — use Imprimir/PDF.)"; }
      else if (op === "cancel") { await cancelPurchaseOrder(tx, user, id, str(fd, "reason") ?? ""); msg = "Pedido cancelado."; }
      else throw new RuleError("Operação inválida.");
    });
    refresh(id);
    return msg;
  });
}

export async function receivePO(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("compras:receber");
    const id = String(fd.get("id"));
    const lines = [...fd.entries()].filter(([k]) => k.startsWith("rq_")).map(([k, v]) => ({ poItemId: k.slice(3), quantity: Number(String(v).replace(",", ".")) || 0 }));
    const invDate = str(fd, "invoiceDate");
    const res = await db.$transaction((tx) => receivePurchaseOrder(tx, user, {
      purchaseOrderId: id, lines, invoiceNumber: str(fd, "invoiceNumber"), invoiceDate: invDate ? fromLocalInput(`${invDate}T12:00`) : null,
      freight: str(fd, "freight") !== null ? parseMoney(fd.get("freight")) : undefined, notes: str(fd, "notes"),
    }));
    refresh(id);
    revalidatePath("/estoque");
    return `${res.message}${res.released.length ? ` OS liberada(s) para execução: ${res.released.join(", ")}.` : ""}`;
  });
}
