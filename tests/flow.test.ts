import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient, type ItemType, type ItemClass } from "@prisma/client";
import { transition, RuleError } from "@/lib/workflow";
import { sendEstimate, recordDecisions, type Snapshot } from "@/lib/estimate";
import { stockEntry, applyPart, returnPart, stockAdjust } from "@/lib/inventory";
import { startTimer, stopTimer, woTotals } from "@/lib/wo";
import { nextNumber } from "@/lib/sequence";
import type { SessionUser } from "@/lib/auth";

const db = new PrismaClient();
const run = <T,>(fn: Parameters<typeof db.$transaction<T>>[0]) => db.$transaction(fn);
const uid = Math.random().toString(36).slice(2, 7).toUpperCase();

let branchId: string, consultor: SessionUser, tec: SessionUser, tec2: SessionUser, customerId: string, vehicleId: string;
const inv: Record<string, string> = {};

async function mkUser(role: SessionUser["role"], name: string): Promise<SessionUser> {
  const u = await db.user.create({ data: { branchId, name, email: `${name.toLowerCase()}-${uid}@t.test`, passwordHash: "x", role, hourlyCost: 10000 } });
  return { id: u.id, name, email: u.email, role, branchId };
}

async function openWO() {
  return run(async (tx) => {
    const wo = await tx.workOrder.create({ data: { number: await nextNumber(tx, branchId, "OS"), branchId, customerId, vehicleId, status: "CHECK_IN", createdById: consultor.id, complaint: "Ruído" } });
    await tx.checkIn.create({ data: { number: await nextNumber(tx, branchId, "CHK"), workOrderId: wo.id, km: 1000, fuelLevel: 50, broughtBy: "Titular", broughtByRelation: "TITULAR", arrivalMode: "RODANDO", conditions: {}, createdById: consultor.id } });
    return wo;
  });
}

async function makeEstimate(woId: string, lines: { type: ItemType; cls?: ItemClass; desc: string; qty?: number; price: number; cost?: number; inv?: string; min?: number }[], kind = "INICIAL") {
  return run(async (tx) => {
    const e = await tx.estimate.create({ data: { number: await nextNumber(tx, branchId, "ORC"), workOrderId: woId, kind, createdById: consultor.id } });
    for (const [i, l] of lines.entries())
      await tx.estimateItem.create({ data: { estimateId: e.id, type: l.type, classification: l.cls ?? "OBRIGATORIO", description: l.desc, quantity: l.qty ?? 1, unitPrice: l.price, unitCost: l.cost ?? 0, inventoryItemId: l.inv ? inv[l.inv] : null, minutes: l.min, sortOrder: i } });
    return e;
  });
}

const status = async (id: string) => (await db.workOrder.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "Teste", document: "11222333000181" } });
  branchId = (await db.branch.create({ data: { companyId: c.id, code: `T${uid}`, name: "Teste" } })).id;
  consultor = await mkUser("CONSULTOR", "Consultor");
  tec = await mkUser("TECNICO", "Tec");
  tec2 = await mkUser("TECNICO", "Tec2");
  customerId = (await db.customer.create({ data: { type: "PF", name: "Cliente Teste", document: `T${uid}${Date.now()}` } })).id;
  vehicleId = (await db.vehicle.create({ data: { customerId, plate: `T${uid}`.slice(0, 7), make: "Porsche", model: "911" } })).id;
  for (const sku of ["PAST", "DISCO", "OLEO"]) inv[sku] = (await db.inventoryItem.create({ data: { sku: `${sku}-${uid}`, name: sku, category: "PECAS", price: 10000 } })).id;
  await run((tx) => stockEntry(tx, consultor, inv.PAST, 2, 5000));
  await run((tx) => stockEntry(tx, consultor, inv.OLEO, 10, 1000));
});

describe("fluxo crítico da OS (spec §18)", () => {
  it("percorre check-in → entrega com aprovação parcial, falta de peça e orçamento complementar", async () => {
    const wo = await openWO();

    // Sem assinatura não avança
    await expect(run((tx) => transition(tx, wo.id, "AGUARDANDO_DIAGNOSTICO", consultor))).rejects.toThrow(/assinado/);
    await db.checkIn.update({ where: { workOrderId: wo.id }, data: { locked: true, signedName: "Titular", signedAt: new Date() } });
    await run((tx) => transition(tx, wo.id, "AGUARDANDO_DIAGNOSTICO", consultor));

    // Diagnóstico exige técnico e registro concluído
    await expect(run((tx) => transition(tx, wo.id, "EM_DIAGNOSTICO", tec, { manual: true }))).rejects.toThrow(/técnico/);
    await db.workOrder.update({ where: { id: wo.id }, data: { technicianId: tec.id } });
    await run((tx) => transition(tx, wo.id, "EM_DIAGNOSTICO", tec, { manual: true }));
    await expect(run((tx) => transition(tx, wo.id, "ORCAMENTO", tec, { manual: true }))).rejects.toThrow(/diagnóstico/);
    await db.diagnostic.create({ data: { workOrderId: wo.id, technicianId: tec.id, technicianName: tec.name, diagnosis: "Pastilhas e discos gastos", finishedAt: new Date() } });
    await run((tx) => transition(tx, wo.id, "ORCAMENTO", tec, { manual: true }));

    // Aprovação só é alcançada pelo envio, não manualmente
    await expect(run((tx) => transition(tx, wo.id, "AGUARDANDO_APROVACAO", consultor, { manual: true }))).rejects.toThrow(/automaticamente/);

    const est = await makeEstimate(wo.id, [
      { type: "SERVICO", desc: "Trocar freios", price: 60000, min: 120 },
      { type: "PECA", desc: "Pastilhas", qty: 1, price: 20000, cost: 5000, inv: "PAST" },
      { type: "PECA", desc: "Discos", qty: 2, price: 30000, cost: 15000, inv: "DISCO" },
      { type: "SERVICO", cls: "OPCIONAL", desc: "Higienização", price: 15000, min: 60 },
    ]);
    const { version, token } = await run((tx) => sendEstimate(tx, est.id, consultor));
    expect(token.length).toBeGreaterThan(20);
    expect(version.total).toBe(60000 + 20000 + 60000 + 15000);
    expect(await status(wo.id)).toBe("AGUARDANDO_APROVACAO");

    // Versão é imutável no banco
    await expect(db.estimateVersion.update({ where: { id: version.id }, data: { total: 1 } })).rejects.toThrow(/imutável/);
    // Reenvio sem mudança é bloqueado
    await expect(run((tx) => sendEstimate(tx, est.id, consultor))).rejects.toThrow(/Nada mudou/);

    // Aprovação parcial: recusa o opcional; decisão incompleta é rejeitada
    const snap = version.snapshot as unknown as Snapshot;
    await expect(run((tx) => recordDecisions(tx, version.id, [{ itemId: snap.items[0].id, decision: "APROVADO" }], { channel: "LINK", approverName: "Cliente" }, null))).rejects.toThrow(/todos os itens/);
    await expect(run((tx) => recordDecisions(tx, version.id, snap.items.map((i) => ({ itemId: i.id, decision: "APROVADO" as const })), { channel: "TELEFONE", approverName: "Cliente" }, consultor))).rejects.toThrow(/evidência/);
    await run((tx) => recordDecisions(tx, version.id, snap.items.map((i) => ({ itemId: i.id, decision: i.classification === "OPCIONAL" ? "RECUSADO" as const : "APROVADO" as const })), { channel: "LINK", approverName: "Cliente", ip: "203.0.113.9" }, null));
    expect(await db.approval.count({ where: { versionId: version.id } })).toBe(4);
    await expect(db.approval.deleteMany({ where: { versionId: version.id } })).rejects.toThrow(/imutável/);

    // Disco sem estoque → aguardando peças; pastilha reservada
    expect(await status(wo.id)).toBe("AGUARDANDO_PECAS");
    const parts = await db.workOrderPart.findMany({ where: { workOrderId: wo.id }, orderBy: { description: "asc" } });
    expect(parts.map((p) => p.status)).toEqual(["AGUARDANDO_COMPRA", "RESERVADA"]);
    expect(await db.workOrderService.count({ where: { workOrderId: wo.id } })).toBe(1);
    await expect(run((tx) => transition(tx, wo.id, "EM_EXECUCAO", consultor, { manual: true }))).rejects.toThrow(/aguardando compra/);

    // Chegada dos discos: entrada reserva automaticamente; custo médio
    await run((tx) => stockEntry(tx, consultor, inv.DISCO, 2, 15000));
    expect((await db.workOrderPart.findFirstOrThrow({ where: { workOrderId: wo.id, inventoryItemId: inv.DISCO } })).status).toBe("RESERVADA");
    await run((tx) => transition(tx, wo.id, "EM_EXECUCAO", consultor, { manual: true }));

    // Aplicação baixa estoque ao custo médio; estoque negativo bloqueado
    for (const p of await db.workOrderPart.findMany({ where: { workOrderId: wo.id } })) await run((tx) => applyPart(tx, tec, p.id));
    const past = await db.inventoryItem.findUniqueOrThrow({ where: { id: inv.PAST } });
    expect(past.onHand).toBe(1);
    await expect(run((tx) => stockAdjust(tx, consultor, inv.PAST, -5, "teste"))).rejects.toThrow(/negativo/);

    // Apontamento: um aberto por técnico; CQ bloqueado com serviço pendente
    const svc = await db.workOrderService.findFirstOrThrow({ where: { workOrderId: wo.id } });
    await run((tx) => startTimer(tx, tec, svc.id));
    await expect(run((tx) => startTimer(tx, tec, svc.id))).rejects.toThrow(/apontamento aberto/);
    await expect(run((tx) => transition(tx, wo.id, "CONTROLE_QUALIDADE", tec, { manual: true }))).rejects.toThrow(/não concluído|apontamento/);

    // Orçamento complementar durante a execução
    const comp = await makeEstimate(wo.id, [{ type: "PECA", desc: "Óleo", qty: 2, price: 3000, cost: 1000, inv: "OLEO" }], "COMPLEMENTAR");
    const { version: v2 } = await run((tx) => sendEstimate(tx, comp.id, consultor));
    expect(await status(wo.id)).toBe("AGUARDANDO_APROVACAO");
    await run((tx) => recordDecisions(tx, v2.id, (v2.snapshot as unknown as Snapshot).items.map((i) => ({ itemId: i.id, decision: "APROVADO" as const })), { channel: "PRESENCIAL", approverName: "Cliente" }, consultor));
    expect(await status(wo.id)).toBe("EM_EXECUCAO");
    // Serviço em andamento não foi perdido
    expect((await db.workOrderService.findUniqueOrThrow({ where: { id: svc.id } })).status).toBe("EM_EXECUCAO");
    // Orçamento respondido não pode ser reenviado
    await expect(run((tx) => sendEstimate(tx, est.id, consultor))).rejects.toThrow(/respondido/);

    const oil = await db.workOrderPart.findFirstOrThrow({ where: { workOrderId: wo.id, inventoryItemId: inv.OLEO } });
    await run((tx) => applyPart(tx, tec, oil.id));
    await run((tx) => stopTimer(tx, tec, svc.id, "FINALIZADO"));
    await run((tx) => transition(tx, wo.id, "CONTROLE_QUALIDADE", tec, { manual: true }));

    // Devolução estorna ao custo da baixa
    // (CQ reprovado volta para execução)
    await run((tx) => transition(tx, wo.id, "EM_EXECUCAO", tec2));
    await run((tx) => returnPart(tx, tec, oil.id, "não utilizado"));
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: inv.OLEO } })).onHand).toBe(10);
    await run((tx) => transition(tx, wo.id, "CONTROLE_QUALIDADE", tec, { manual: true }));
    await run((tx) => transition(tx, wo.id, "PREPARACAO", tec2));
    await run((tx) => transition(tx, wo.id, "PRONTO_ENTREGA", consultor, { manual: true }));

    // Totais e margem
    const full = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id }, include: { services: true, parts: true, titles: true, timeEntries: true } });
    const t = woTotals({ ...full, techCost: new Map([[tec.id, 10000]]) });
    expect(t.total).toBe(60000 + 20000 + 60000);
    expect(t.partsCost).toBe(5000 + 30000);
    expect(t.due).toBe(t.total);

    // Cancelamento bloqueado com pagamento
    const wo2 = await openWO();
    await db.title.create({ data: { number: `TIT-T${uid}`, kind: "RECEBER", status: "PAGO", description: "x", workOrderId: wo2.id, customerId, categoryId: "00000000-0000-4000-8000-000000000101", dueDate: new Date(), amount: 100, settled: 100, createdById: consultor.id, createdByName: "c" } });
    await expect(run((tx) => transition(tx, wo2.id, "CANCELADA", consultor, { manual: true, reason: "teste" }))).rejects.toThrow(/recebimento/);

    // Histórico de status completo e imutável
    const hist = await db.workOrderStatusHistory.findMany({ where: { workOrderId: wo.id } });
    expect(hist.length).toBeGreaterThanOrEqual(10);
    await expect(db.workOrderStatusHistory.delete({ where: { id: hist[0].id } })).rejects.toThrow(/imutável/);
  });

  it("gera números sequenciais únicos sob concorrência", async () => {
    const nums = await Promise.all(Array.from({ length: 20 }, () => run((tx) => nextNumber(tx, branchId, "REC"))));
    expect(new Set(nums).size).toBe(20);
  });

  it("recusa total encerra a OS sem serviço", async () => {
    const wo = await openWO();
    await db.checkIn.update({ where: { workOrderId: wo.id }, data: { locked: true } });
    await db.workOrder.update({ where: { id: wo.id }, data: { technicianId: tec.id } });
    await db.diagnostic.create({ data: { workOrderId: wo.id, technicianId: tec.id, technicianName: "t", diagnosis: "x", finishedAt: new Date() } });
    for (const s of ["AGUARDANDO_DIAGNOSTICO", "EM_DIAGNOSTICO", "ORCAMENTO"] as const) await run((tx) => transition(tx, wo.id, s, tec));
    const e = await makeEstimate(wo.id, [{ type: "SERVICO", desc: "X", price: 1000 }]);
    const { version } = await run((tx) => sendEstimate(tx, e.id, consultor));
    await run((tx) => recordDecisions(tx, version.id, (version.snapshot as unknown as Snapshot).items.map((i) => ({ itemId: i.id, decision: "RECUSADO" as const })), { channel: "LINK", approverName: "C" }, null));
    expect(await status(wo.id)).toBe("ENCERRADA_SEM_SERVICO");
    expect(RuleError).toBeDefined();
  });
});
