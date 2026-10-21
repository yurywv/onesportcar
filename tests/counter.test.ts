import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { parseItemLines, parseQuantity, openCounterWorkOrder } from "@/lib/counter";
import { sendEstimate, recordDecisions, type Snapshot } from "@/lib/estimate";
import { printData, qtyLabel } from "@/lib/os-print";
import { WO_INCLUDE } from "@/app/(app)/os/[id]/data";
import type { SessionUser } from "@/lib/auth";

const db = new PrismaClient();
const uid = Math.random().toString(36).slice(2, 7).toUpperCase();

// Itens da OS 4891 do SYSCAR (Porsche Macan GTS — Jean Fausto Petri), colados como o consultor faria.
export const OS4891_PRODUCTS = [
  "2 ; PNEU PIRELLI P ZERO (PZ4) 275/40R21 107Y XL (*) RUN FLAT ; 7.400,00",
  "1 ; TUBO DE AGUA ; 2.583,75",
  "1 ; PASTILHA TRASEIRA ; 2.262,81",
  "2 ; BATENTE DO AMORTECEDOR DIANTEIRO ; 485,48",
  "2 ; COIFA DO AMORTECEDOR DIANTEIRO ; 209,22",
  "2 ; BATENTE DO AMORTECEDOR TRASEIRO ; 1.247,19",
  "2 ; COIFA DO AMORTECEDOR TRASEIRO ; 190,94",
  "2 ; COXIM DO AMORTECEDOR TRASEIRO ; 2.514,69",
  "1 ; PALHETA TRASEIRA ; 468,59",
  "4 ; BRAÇO SUPERIOR DA SUSPENSÃO DIANTEIRA ; ",
  `1 ; ADITIVO RADIADOR 1 LT (ROSA) ; 31,23 ; 9432-${uid} ; 175010 ; UN`,
].join("\n");
export const OS4891_SERVICES = [
  "2 ; MAO DE OBRA MECANICA - PNEU ; 100,00 ; 256",
  "2 ; RETIFICA DE DISCO (P/ DISCO) ; 110,00 ; 264",
  "1 ; ALINHAMENTO 3D ; 510,00 ; 218",
  "4 ; BALANCEAMENTO RODA ; 100,00 ; 216",
  "H01:00 ; MAO DE OBRA - TROCA PASTILHA DE FREIO ; 510,00 ; 201",
  "H01:00 ; MAO DE OBRA MECANICA GERAL(DEMOSTAR E MONTAR AMORTECEDOR TRASEIRO) ; 510,00 ; 263",
  "H02:00 ; MAO DE OBRA MECANICA GERAL(DESMONTAR E MONTAR AMORTECEDOR DIANTEIRO ) ; 510,00 ; 263",
  "H01:00 ; MAO DE OBRA MECANICA GERAL(DESMONTAR E MONTAR TUBO DE AGUA ) ; 510,00 ; 263",
].join("\n");

let user: SessionUser, vehicleId: string, invId: string;

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "Teste", document: "11222333000181" } });
  const branchId = (await db.branch.create({ data: { companyId: c.id, code: `B${uid}`, name: "Teste" } })).id;
  const u = await db.user.create({ data: { branchId, name: "Milene", email: `milene-${uid}@t.test`, passwordHash: "x", role: "CONSULTOR", isSeller: true } });
  user = { id: u.id, name: u.name, email: u.email, role: u.role, branchId };
  const customerId = (await db.customer.create({ data: { type: "PF", name: "JEAN FAUSTO PETRI", document: `C${uid}${Date.now()}` } })).id;
  vehicleId = (await db.vehicle.create({ data: { customerId, plate: `P${uid}`.slice(0, 7), make: "PORSCHE", model: "MACAN GTS 3.0", mileage: 1000 } })).id;
  invId = (await db.inventoryItem.create({ data: { sku: `9432-${uid}`, name: "ADITIVO RADIADOR 1 LT (ROSA)", category: "FLUIDOS", price: 3123, avgCost: 1500, onHand: 10 } })).id;
});

describe("leitura de itens colados", () => {
  it("entende quantidade, horas, valores em reais e campos opcionais", () => {
    expect(parseQuantity("H02:00")).toEqual({ qty: 2, hours: true });
    expect(parseQuantity("1:30")).toEqual({ qty: 1.5, hours: true });
    expect(parseQuantity("1,5")).toEqual({ qty: 1.5, hours: false });
    expect(parseQuantity("0")).toBeNull();
    const { items, errors } = parseItemLines("2\tPNEU\t7.400,00\n\nx ; ERRO ; 1\n1 | COIFA | R$ 209,22 | 77 | REF | pc");
    expect(errors).toEqual(['Linha 3: quantidade inválida ("x").']);
    expect(items.map((i) => [i.quantity, i.description, i.unitPrice, i.code, i.reference, i.unit])).toEqual([
      [2, "PNEU", 740000, null, null, null],
      [1, "COIFA", 20922, "77", "REF", "PC"],
    ]);
    expect(qtyLabel({ quantity: 1.5, hours: true })).toBe("H01:30");
  });
});

describe("OS de balcão (padrão SYSCAR) — OS 4891", () => {
  it("abre como orçamento, confere os totais do SYSCAR, envia e materializa na aprovação", async () => {
    const products = parseItemLines(OS4891_PRODUCTS), services = parseItemLines(OS4891_SERVICES);
    expect(products.errors).toEqual([]);
    expect(services.errors).toEqual([]);
    const { workOrder, estimate } = await db.$transaction((tx) => openCounterWorkOrder(tx, user, {
      vehicleId, complaint: "CLIENTE RELATA VAZAMENTO DE AGUA E BARULHO", legacyNumber: "4891", kmIn: 1200,
      publicNotes: "TUBO DE AGUA, BATENTE TRASEIRO, BATENTE DIANTEIRO, PREVISÃO DE CHEGADA 20 DIAS ÚTEIS", products: products.items, services: services.items,
    }));
    expect(workOrder.status).toBe("ORCAMENTO");
    expect(workOrder.origin).toBe("BALCAO");
    expect(workOrder.sellerId).toBe(user.id);

    // Não abre duas OS para o mesmo carro
    await expect(db.$transaction((tx) => openCounterWorkOrder(tx, user, { vehicleId, complaint: "x", products: [], services: [] }))).rejects.toThrow(/em aberto/);

    const linked = await db.estimateItem.findFirstOrThrow({ where: { estimateId: estimate.id, inventoryItemId: invId } });
    expect(linked.type).toBe("CONSUMIVEL");
    expect(linked.reference).toBe("175010");

    let wo = await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id }, include: WO_INCLUDE });
    let d = printData(wo);
    expect(d.stage).toBe("ORCAMENTO");
    expect(d.products).toHaveLength(11);
    expect(d.services).toHaveLength(8);
    expect(d.productsTotal).toBe(2944142); // R$ 29.441,42
    expect(d.servicesTotal).toBe(388000); // R$ 3.880,00
    expect(d.total).toBe(3332142); // R$ 33.321,42
    expect(qtyLabel(d.services[6])).toBe("H02:00");

    await db.$transaction((tx) => sendEstimate(tx, estimate.id, user));
    wo = await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id }, include: WO_INCLUDE });
    expect(wo.status).toBe("AGUARDANDO_APROVACAO");
    expect(printData(wo).total).toBe(3332142);

    const version = wo.estimates[0].versions[0];
    const snap = version.snapshot as unknown as Snapshot;
    await db.$transaction((tx) => recordDecisions(tx, version.id, snap.items.map((i) => ({ itemId: i.id, decision: "APROVADO" as const })), { channel: "PRESENCIAL", approverName: "JEAN FAUSTO PETRI" }, user));
    wo = await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id }, include: WO_INCLUDE });
    expect(wo.status).toBe("AGUARDANDO_PECAS"); // peças avulsas aguardam compra
    d = printData(wo);
    expect(d.stage).toBe("OS");
    expect(d.total).toBe(3332142);
    expect(d.services.find((s) => s.code === "201")?.hours).toBe(true);
  });
});
