import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { nextNumber } from "@/lib/sequence";
import { stockEntry, reservedQty } from "@/lib/inventory";
import { transition } from "@/lib/workflow";
import { submitPurchaseOrder, approvePurchaseOrder, markSent, receivePurchaseOrder, cancelPurchaseOrder, purchaseSuggestions } from "@/lib/purchasing";
import { createTitles, settleTitle, reverseSettlement, cancelTitle, transferFunds, accountBalance, receiveOnWorkOrder, billWorkOrder, splitAmount, parseTerms, woFinance, CATEGORY } from "@/lib/finance";
import type { SessionUser } from "@/lib/auth";

const db = new PrismaClient();
const run = <T,>(fn: Parameters<typeof db.$transaction<T>>[0]) => db.$transaction(fn);
const uid = Math.random().toString(36).slice(2, 7).toUpperCase();
const ACC = { CAIXA: "00000000-0000-4000-8000-000000000001", BANCO: "00000000-0000-4000-8000-000000000002" };
const DESPESA = "00000000-0000-4000-8000-000000000299";

let branchId: string, comprador: SessionUser, gestor: SessionUser, fin: SessionUser, caixaAcc: string, supplierId: string, customerId: string, vehicleId: string;
const mk = async (role: SessionUser["role"], name: string): Promise<SessionUser> => {
  const u = await db.user.create({ data: { branchId, name, email: `${name}-${uid}@t.test`, passwordHash: "x", role } });
  return { id: u.id, name, email: u.email, role, branchId };
};

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "T", document: "1" } });
  branchId = (await db.branch.create({ data: { companyId: c.id, code: `S${uid}`, name: "T" } })).id;
  comprador = await mk("COMPRADOR", "comprador"); gestor = await mk("GESTOR", "gestor"); fin = await mk("FINANCEIRO", "fin");
  supplierId = (await db.supplier.create({ data: { document: `S${uid}${Date.now()}`, name: "Fornecedor Teste", paymentTerms: "30/60" } })).id;
  customerId = (await db.customer.create({ data: { type: "PF", name: "C", document: `C${uid}${Date.now()}` } })).id;
  vehicleId = (await db.vehicle.create({ data: { customerId, plate: `S${uid}X`.slice(0, 7), make: "BMW", model: "M3" } })).id;
  caixaAcc = (await db.financialAccount.create({ data: { name: `Caixa ${uid}`, type: "CAIXA", openingBalance: 10000 } })).id;
});

describe("utilitários financeiros", () => {
  it("parcelas e condições", () => {
    expect(splitAmount(1000, 3)).toEqual([334, 333, 333]);
    expect(parseTerms("30/60/90")).toEqual([30, 60, 90]);
    expect(parseTerms("")).toEqual([0]);
    expect(woFinance(1000, [{ amount: 600, settled: 600, status: "PAGO" }, { amount: 100, settled: 0, status: "CANCELADO" }])).toEqual({ billed: 600, paid: 600, openTitles: 0, unbilled: 400, due: 400 });
  });
});

describe("compras", () => {
  it("alçada, aprovação segregada, recebimento parcial com frete rateado, contas a pagar e liberação da OS", async () => {
    const disco = await db.inventoryItem.create({ data: { sku: `DSC-${uid}`, name: "Disco", category: "PECAS", minQty: 0 } });
    const past = await db.inventoryItem.create({ data: { sku: `PST-${uid}`, name: "Pastilha", category: "PECAS", minQty: 5 } });
    await run((tx) => stockEntry(tx, gestor, past.id, 1, 1000));

    // OS aguardando o disco
    const wo = await db.workOrder.create({ data: { number: `OS-S${uid}`, branchId, customerId, vehicleId, status: "AGUARDANDO_PECAS", createdById: gestor.id } });
    await db.workOrderPart.create({ data: { workOrderId: wo.id, inventoryItemId: disco.id, description: "Disco", quantity: 2, price: 50000, status: "AGUARDANDO_COMPRA" } });

    const sug = await purchaseSuggestions(db);
    expect(sug.find((s) => s.item.id === disco.id)?.reason).toBe("OS aguardando peça");
    expect(sug.find((s) => s.item.id === past.id)?.reason).toBe("Abaixo do mínimo");

    // Pedido de R$ 6.000 + frete: acima da alçada do comprador (R$ 5.000)
    const po = await run(async (tx) => tx.purchaseOrder.create({ data: {
      number: await nextNumber(tx, branchId, "PED"), branchId, supplierId, paymentTerms: "30/60", freight: 1000, createdById: comprador.id, createdByName: comprador.name,
      items: { create: [{ inventoryItemId: disco.id, description: "Disco", quantity: 2, unitCost: 250000 }, { inventoryItemId: past.id, description: "Pastilha", quantity: 4, unitCost: 25000 }] },
    } }));
    expect(await run((tx) => submitPurchaseOrder(tx, comprador, po.id))).toBe(false);
    await expect(run((tx) => markSent(tx, comprador, po.id))).rejects.toThrow(/aprovados/);
    await expect(run((tx) => receivePurchaseOrder(tx, comprador, { purchaseOrderId: po.id, lines: [] }))).rejects.toThrow(/aprovado/);
    const gestor2 = { ...comprador, role: "GESTOR" as const };
    await expect(run((tx) => approvePurchaseOrder(tx, gestor2, po.id, true))).rejects.toThrow(/Segregação/);
    await run((tx) => approvePurchaseOrder(tx, gestor, po.id, true));
    await run((tx) => markSent(tx, gestor, po.id));

    const items = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, orderBy: { sortOrder: "asc" } });
    const dItem = items.find((i) => i.inventoryItemId === disco.id)!, pItem = items.find((i) => i.inventoryItemId === past.id)!;
    await expect(run((tx) => receivePurchaseOrder(tx, gestor, { purchaseOrderId: po.id, lines: [{ poItemId: dItem.id, quantity: 3 }] }))).rejects.toThrow(/pendente/);

    // 1ª entrega: só os discos, com o frete todo
    const r1 = await run((tx) => receivePurchaseOrder(tx, gestor, { purchaseOrderId: po.id, lines: [{ poItemId: dItem.id, quantity: 2 }], invoiceNumber: "NF1", invoiceDate: new Date() }));
    expect(r1.complete).toBe(false);
    expect(r1.released).toEqual([wo.number]);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("EM_EXECUCAO");
    expect(await reservedQty(db, disco.id)).toBe(2);
    const d = await db.inventoryItem.findUniqueOrThrow({ where: { id: disco.id } });
    expect(d.avgCost).toBe(250000 + 500); // frete de R$ 10 rateado em 2 unidades
    expect(r1.titles.map((t) => t.amount)).toEqual([250500, 250500]);
    expect(r1.titles.every((t) => t.kind === "PAGAR" && t.supplierId === supplierId)).toBe(true);
    expect(Math.round((+r1.titles[1].dueDate - +r1.titles[0].dueDate) / 86400_000)).toBe(30);

    // Pedido com recebimento não pode ser cancelado; recebimento imutável
    await expect(run((tx) => cancelPurchaseOrder(tx, gestor, po.id, "x"))).rejects.toThrow(/recebimento/);
    await expect(db.goodsReceipt.delete({ where: { id: r1.receipt.id } })).rejects.toThrow(/imutável/);
    // Título gerado por recebimento não pode ser cancelado diretamente
    await expect(run((tx) => cancelTitle(tx, fin, r1.titles[0].id, "x"))).rejects.toThrow(/recebimento/);

    const r2 = await run((tx) => receivePurchaseOrder(tx, gestor, { purchaseOrderId: po.id, lines: [{ poItemId: pItem.id, quantity: 4 }] }));
    expect(r2.complete).toBe(true);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEBIDO");
    const p = await db.inventoryItem.findUniqueOrThrow({ where: { id: past.id } });
    expect(p.onHand).toBe(5);
    expect(p.avgCost).toBe(Math.round((1 * 1000 + 4 * 25000) / 5));
    expect(r2.titles.reduce((a, t) => a + t.amount, 0)).toBe(100000);
  });
});

describe("tesouraria", () => {
  it("baixa parcial com juros/desconto/taxa, estorno por lançamento inverso, saldo e bloqueios", async () => {
    const [t] = await run((tx) => createTitles(tx, fin, { kind: "PAGAR", description: "Energia", amount: 10000, categoryId: DESPESA, counterparty: "Energia" }));
    await expect(run((tx) => createTitles(tx, fin, { kind: "RECEBER", description: "x", amount: 1, categoryId: DESPESA, counterparty: "x" }))).rejects.toThrow(/compatível/);

    const before = await accountBalance(db, ACC.BANCO);
    await expect(run((tx) => settleTitle(tx, fin, { titleId: t.id, accountId: ACC.BANCO, amount: 9000, discount: 2000, method: "PIX" }))).rejects.toThrow(/maior que o saldo/);
    const s1 = await run((tx) => settleTitle(tx, fin, { titleId: t.id, accountId: ACC.BANCO, amount: 6000, interest: 100, fee: 50, method: "PIX" }));
    expect(s1.cash).toBe(-6150);
    expect((await db.title.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("PARCIAL");
    await run((tx) => settleTitle(tx, fin, { titleId: t.id, accountId: ACC.BANCO, amount: 3500, discount: 500, method: "PIX" }));
    expect((await db.title.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("PAGO");
    expect(await accountBalance(db, ACC.BANCO)).toBe(before - 6150 - 3500);

    // Estorno: lançamento inverso, título volta a parcial, baixa imutável
    await run((tx) => reverseSettlement(tx, fin, s1.id, "valor errado"));
    await expect(run((tx) => reverseSettlement(tx, fin, s1.id, "de novo"))).rejects.toThrow(/já estornada/);
    const after = await db.title.findUniqueOrThrow({ where: { id: t.id } });
    expect([after.status, after.settled]).toEqual(["PARCIAL", 4000]);
    expect(await accountBalance(db, ACC.BANCO)).toBe(before - 3500);
    await expect(db.settlement.update({ where: { id: s1.id }, data: { amount: 1 } })).rejects.toThrow(/imutável/);
    await expect(run((tx) => cancelTitle(tx, fin, t.id, "x"))).rejects.toThrow(/baixas/);

    // Caixa não pode ficar negativo; transferência
    const [t2] = await run((tx) => createTitles(tx, fin, { kind: "PAGAR", description: "Grande", amount: 50000, categoryId: DESPESA, counterparty: "x" }));
    await expect(run((tx) => settleTitle(tx, fin, { titleId: t2.id, accountId: caixaAcc, amount: 50000, method: "DINHEIRO" }))).rejects.toThrow(/Saldo insuficiente/);
    await expect(run((tx) => transferFunds(tx, fin, caixaAcc, ACC.BANCO, 20000, new Date()))).rejects.toThrow(/Saldo insuficiente/);
    await run((tx) => transferFunds(tx, fin, caixaAcc, ACC.BANCO, 4000, new Date(), "depósito"));
    expect(await accountBalance(db, caixaAcc)).toBe(6000);
    await run((tx) => cancelTitle(tx, fin, t2.id, "lançado em duplicidade"));
  });

  it("OS: fatura a prazo, recebe no balcão abatendo títulos e não permite receber além do total", async () => {
    const wo = await db.workOrder.create({ data: { number: `OS-F${uid}`, branchId, customerId, vehicleId, status: "PRONTO_ENTREGA", createdById: gestor.id } });
    await db.workOrderService.create({ data: { workOrderId: wo.id, description: "Serviço", soldMin: 60, price: 100000, status: "CONCLUIDO" } });
    await db.workOrderPart.create({ data: { workOrderId: wo.id, description: "Taxa", quantity: 1, price: 20000, status: "APLICADA", type: "TAXA" } });

    const titles = await run((tx) => billWorkOrder(tx, fin, { workOrderId: wo.id, dueDays: [30, 60], method: "BOLETO" }));
    expect(titles.map((t) => t.amount)).toEqual([60000, 60000]);
    await expect(run((tx) => billWorkOrder(tx, fin, { workOrderId: wo.id, dueDays: [30], method: "BOLETO" }))).rejects.toThrow(/Não há valor/);

    await expect(run((tx) => receiveOnWorkOrder(tx, gestor, { workOrderId: wo.id, amount: 130000, accountId: ACC.BANCO, method: "PIX" }))).rejects.toThrow(/maior que o saldo/);
    const nums = await run((tx) => receiveOnWorkOrder(tx, gestor, { workOrderId: wo.id, amount: 90000, accountId: ACC.BANCO, method: "PIX" }));
    expect(nums).toHaveLength(2);
    const ts = await db.title.findMany({ where: { workOrderId: wo.id }, orderBy: { dueDate: "asc" } });
    expect(ts.map((t) => [t.status, t.settled])).toEqual([["PAGO", 60000], ["PARCIAL", 30000]]);

    // Recebimento à vista sem título prévio cria o título automaticamente
    const wo2 = await db.workOrder.create({ data: { number: `OS-G${uid}`, branchId, customerId, vehicleId, status: "PRONTO_ENTREGA", createdById: gestor.id } });
    await db.workOrderService.create({ data: { workOrderId: wo2.id, description: "S", soldMin: 60, price: 5000, status: "CONCLUIDO" } });
    await run((tx) => receiveOnWorkOrder(tx, gestor, { workOrderId: wo2.id, amount: 5000, accountId: ACC.BANCO, method: "CREDITO", fee: 150 }));
    const t = await db.title.findFirstOrThrow({ where: { workOrderId: wo2.id }, include: { settlements: true } });
    expect([t.status, t.categoryId, t.settlements[0].cash]).toEqual(["PAGO", CATEGORY.RECEITA_OS, 4850]);

    // OS com recebimento não pode ser cancelada
    await expect(run((tx) => transition(tx, wo2.id, "CANCELADA", gestor, { reason: "x" }))).rejects.toThrow();
  });
});
