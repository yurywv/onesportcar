import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { checkRow, stageRows, importRow, revertRow } from "@/lib/importer";
import type { ImportEntity } from "@/lib/import-fields";
import type { SessionUser } from "@/lib/auth";

const db = new PrismaClient();
const uid = Math.random().toString(36).slice(2, 7).toUpperCase();
let admin: SessionUser, woId: string;

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "T", document: "1" } });
  const b = await db.branch.create({ data: { companyId: c.id, code: `S${uid}`, name: "T" } });
  const u = await db.user.create({ data: { branchId: b.id, name: "Admin", email: `adm2-${uid}@t.test`, passwordHash: "x", role: "ADMIN" } });
  admin = { id: u.id, name: u.name, email: u.email, role: "ADMIN", branchId: b.id };
  const cu = await db.customer.create({ data: { type: "PF", name: "Cli", document: `X${uid}${Date.now()}` } });
  const v = await db.vehicle.create({ data: { customerId: cu.id, plate: `Z${uid}`.slice(0, 7), make: "AUDI", model: "A3" } });
  woId = (await db.workOrder.create({ data: { number: `SYS-9${uid}`, legacy: true, legacyNumber: `9${uid}`, branchId: b.id, customerId: cu.id, vehicleId: v.id, status: "ENTREGUE", createdById: u.id, closedAt: new Date() } })).id;
});

async function stage(entity: ImportEntity, rows: Record<string, string>[]) {
  const job = await db.importJob.create({ data: { entity, fileName: "syscar", mapping: {}, userId: admin.id, userName: "A", totalRows: rows.length } });
  const counts = await db.$transaction((tx) => stageRows(tx, job.id, entity, rows.map((values, i) => ({ rowNumber: i + 1, values }))));
  return { counts, rows: await db.importRow.findMany({ where: { jobId: job.id }, orderBy: { rowNumber: "asc" } }) };
}

describe("importação de serviços e itens de OS do SYSCAR", () => {
  it("valida serviços do catálogo", () => {
    expect(checkRow("SERVICOS", { code: "263", name: "MAO DE OBRA MECANICA GERAL", price: "R$ 510,00" }).data).toMatchObject({ code: "263", price: 51000, minutes: 60, category: "GERAL" });
    expect(checkRow("SERVICOS", { code: "", name: "" }).errors).toEqual(["Código ausente", "Descrição ausente"]);
  });

  it("localiza o proprietário do veículo pelo nome (relatório de veículos do SYSCAR)", async () => {
    await db.customer.create({ data: { type: "PF", name: `MARIA ${uid}`, document: `M${uid}${Date.now()}`, whatsapp: "(19) 9 8292-2738" } });
    await db.customer.create({ data: { type: "PF", name: `JOSE ${uid}`, document: `J1${uid}${Date.now()}`, whatsapp: "(19) 9 1111-1111" } });
    await db.customer.create({ data: { type: "PF", name: `JOSE ${uid}`, document: `J2${uid}${Date.now()}`, whatsapp: "(19) 9 2222-2222" } });
    const { counts, rows } = await stage("VEICULOS", [
      { plate: "GFD1I09", make: "HYUNDAI", model: "HB20S", yearMfg: "2017", ownerName: `maria ${uid}`, ownerPhone: "(19) 9 8292-2738" },
      { plate: "QQN2822", make: "HYUNDAI", model: "HB20", yearMfg: "2018 - 2019", ownerName: `JOSE ${uid}`, ownerPhone: "(19) 9 2222-2222" },
      { plate: "FPP8211", make: "NISSAN", model: "SENTRA", ownerName: `JOSE ${uid}` },
    ]);
    expect(rows.map((r) => r.status)).toEqual(["VALIDO", "VALIDO", "INVALIDO"]);
    expect(rows[2].messages[0]).toMatch(/Há 2 clientes/);
    expect(counts.VALIDO).toBe(2);
  });

  it("importa itens na OS do histórico, bloqueia repetição e reverte", async () => {
    const os = `9${uid}`;
    const { counts, rows } = await stage("OS_ITENS", [
      { legacyNumber: os, kind: "P", code: "GS60577M2BRA", description: "OLEO MOTOR 0W20", quantity: "5", unitPrice: "R$ 157,50", total: "R$ 748,12", cost: "R$ 315,00" },
      { legacyNumber: os, kind: "S", code: "218", description: "ALINHAMENTO 3D", quantity: "1", unitPrice: "R$ 510,00", total: "R$ 510,00" },
      { legacyNumber: "000", kind: "P", description: "X", total: "1" },
    ]);
    expect(counts).toEqual({ VALIDO: 2, DUPLICADO: 0, INVALIDO: 1 });
    expect(rows[2].messages[0]).toMatch(/não encontrada/);
    const ids: string[] = [];
    for (const r of rows.slice(0, 2)) ids.push(await db.$transaction((tx) => importRow(tx, admin, "OS_ITENS", { ...(r.data as Record<string, unknown>), __key: r.key })) as string);
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { parts: true, services: true } });
    expect(wo.parts[0]).toMatchObject({ description: "OLEO MOTOR 0W20 [GS60577M2BRA]", quantity: 5, price: 74812, unitCost: 6300, status: "APLICADA" });
    expect(wo.services[0]).toMatchObject({ description: "ALINHAMENTO 3D [218]", price: 51000, status: "CONCLUIDO" });

    const again = await stage("OS_ITENS", [{ legacyNumber: os, kind: "S", code: "218", description: "ALINHAMENTO 3D", quantity: "1", total: "R$ 510,00" }]);
    expect(again.counts.DUPLICADO).toBe(1);

    expect(await db.$transaction((tx) => revertRow(tx, admin, "OS", woId, "x"))).toMatch(/itens/);
    for (const id of ids) expect(await db.$transaction((tx) => revertRow(tx, admin, "OS_ITENS", id, "x"))).toBeNull();
    expect(await db.workOrderService.count({ where: { workOrderId: woId } })).toBe(0);
  });
});
