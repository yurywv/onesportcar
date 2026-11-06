import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { transition } from "@/lib/workflow";
import { phaseOf, ensurePhaseCameras } from "@/lib/phases";
import { priceFor, parseDiagItems } from "@/lib/quote";
import { sendEstimate, recordDecisions, type Snapshot } from "@/lib/estimate";
import { nextNumber } from "@/lib/sequence";
import type { SessionUser } from "@/lib/auth";

const db = new PrismaClient();
const uid = Math.random().toString(36).slice(2, 7).toUpperCase();

describe("precificação e itens do diagnóstico", () => {
  it("serviço = tempo × hora; peça = custo × (1 + margem)", () => {
    expect(priceFor({ type: "SERVICO", quantity: 1, minutes: 90, unitCost: null }, { hourly: 40000, margin: 40 }).unitPrice).toBe(60000);
    expect(priceFor({ type: "PECA", quantity: 2, minutes: null, unitCost: 10000 }, { hourly: 40000, margin: 40 })).toEqual({ unitPrice: 14000, unitCost: 10000 });
    expect(priceFor({ type: "PECA", quantity: 1, minutes: null, unitCost: 10000 }, { hourly: 1, margin: 40, override: 19900 }).unitPrice).toBe(19900);
  });
  it("valida itens do mecânico", () => {
    const r = parseDiagItems(JSON.stringify([{ type: "SERVICO", description: "Trocar pastilhas", minutes: "60" }, { type: "PECA", description: "Pastilhas", quantity: "1", reference: "PN1" }, { description: "" }]));
    expect(r).toHaveLength(2);
    expect(() => parseDiagItems(JSON.stringify([{ type: "SERVICO", description: "Sem tempo" }]))).toThrow();
  });
  it("mapeia status → fase", () => {
    expect(phaseOf("EM_DIAGNOSTICO")).toBe("DIAGNOSTICO");
    expect(phaseOf("PREPARACAO")).toBe("LAVAGEM");
    expect(phaseOf("PRONTO_ENTREGA")).toBe("CHECK_OUT");
    expect(phaseOf("ENTREGUE")).toBeNull();
  });
});

describe("câmeras por fase e aprovação pelo app", () => {
  let branchId: string, user: SessionUser, woId: string, camExec: string;
  beforeAll(async () => {
    const co = await db.company.create({ data: { name: "T", document: `X${uid}` } });
    branchId = (await db.branch.create({ data: { companyId: co.id, code: `C${uid}`, name: "T" } })).id;
    const u = await db.user.create({ data: { branchId, name: "Cons", email: `c-${uid}@t.test`, passwordHash: "x", role: "CONSULTOR" } });
    user = { id: u.id, name: u.name, email: u.email, role: "CONSULTOR", branchId };
    const cust = await db.customer.create({ data: { type: "PF", name: "Cliente Teste", document: `D${uid}` } });
    const veh = await db.vehicle.create({ data: { customerId: cust.id, plate: `T${uid.slice(0, 2)}1A23`.slice(0, 7), make: "Porsche", model: "911" } });
    camExec = (await db.camera.create({ data: { name: `Box ${uid}`, url: "https://cam.test/box.m3u8", phases: { create: [{ phase: "EXECUCAO" }] } } })).id;
    const wo = await db.workOrder.create({ data: { number: `OS-${uid}`, branchId, customerId: cust.id, vehicleId: veh.id, status: "ORCAMENTO", createdById: u.id } });
    woId = wo.id;
  });

  it("ao entrar na fase, a OS recebe as câmeras padrão (sem duplicar)", async () => {
    await db.$transaction((tx) => ensurePhaseCameras(tx, woId, "EXECUCAO"));
    await db.$transaction((tx) => ensurePhaseCameras(tx, woId, "EXECUCAO"));
    const a = await db.workOrderCamera.findMany({ where: { workOrderId: woId, phase: "EXECUCAO" } });
    expect(a.map((x) => x.cameraId)).toContain(camExec);
    expect(new Set(a.map((x) => x.cameraId)).size).toBe(a.length);
  });

  it("cliente aprova pelo app (canal APP) e a OS sai para execução", async () => {
    const est = await db.$transaction(async (tx) => {
      const e = await tx.estimate.create({ data: { number: await nextNumber(tx, branchId, "ORC"), workOrderId: woId, createdById: user.id } });
      await tx.estimateItem.create({ data: { estimateId: e.id, type: "SERVICO", description: "Substituição das pastilhas", minutes: 60, unitPrice: 40000 } });
      return e;
    });
    const { version } = await db.$transaction((tx) => sendEstimate(tx, est.id, user));
    const snap = version.snapshot as unknown as Snapshot;
    // O snapshot que o cliente vê não carrega diagnóstico, só itens comerciais
    expect(JSON.stringify(snap)).not.toMatch(/diagnos/i);
    const r = await db.$transaction((tx) => recordDecisions(tx, version.id, snap.items.map((i) => ({ itemId: i.id, decision: "APROVADO" as const })), { channel: "APP", approverName: "Cliente Teste" }, null));
    expect(r.approved).toBe(1);
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId } });
    expect(["EM_EXECUCAO", "AGUARDANDO_PECAS"]).toContain(wo.status);
    // transição para execução associa a câmera do box automaticamente
    expect(await db.workOrderCamera.count({ where: { workOrderId: woId, phase: "EXECUCAO", cameraId: camExec } })).toBe(1);
    void transition;
  });
});
