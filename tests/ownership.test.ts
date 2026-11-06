import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { stageRows, importRow } from "@/lib/importer";
import { ownershipSegments, rebuildOwnership, normName } from "@/lib/ownership";
import type { ImportEntity } from "@/lib/import-fields";
import type { SessionUser } from "@/lib/auth";

const db = new PrismaClient();
const uid = Math.random().toString(36).slice(2, 7).toUpperCase();
const d = (s: string) => new Date(`${s}T12:00:00-03:00`);
let admin: SessionUser;

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "T", document: `O${uid}` } });
  const b = await db.branch.create({ data: { companyId: c.id, code: `O${uid}`, name: "T" } });
  const u = await db.user.create({ data: { branchId: b.id, name: "Admin", email: `own-${uid}@t.test`, passwordHash: "x", role: "ADMIN" } });
  admin = { id: u.id, name: u.name, email: u.email, role: "ADMIN", branchId: b.id };
});

async function run(entity: ImportEntity, rows: Record<string, string>[]) {
  const job = await db.importJob.create({ data: { entity, fileName: "syscar", mapping: {}, userId: admin.id, userName: "A", totalRows: rows.length } });
  await db.$transaction((tx) => stageRows(tx, job.id, entity, rows.map((values, i) => ({ rowNumber: i + 1, values }))));
  const staged = await db.importRow.findMany({ where: { jobId: job.id }, orderBy: { rowNumber: "asc" } });
  for (const r of staged.filter((x) => x.status === "VALIDO")) await db.$transaction((tx) => importRow(tx, admin, entity, { ...(r.data as object), __key: r.key }));
  return staged;
}

describe("períodos de proprietário a partir das OS", () => {
  it("agrupa donos, ignora quem só trouxe o carro e fecha no dono atual", () => {
    const ev = (s: string, c: string) => ({ at: d(s), customerId: c });
    expect(ownershipSegments([ev("2021-01-01", "A"), ev("2021-06-01", "A"), ev("2023-01-01", "B")], "B").map((s) => s.customerId)).toEqual(["A", "B"]);
    // A, B, A: B só trouxe/pagou o carro
    expect(ownershipSegments([ev("2021-01-01", "A"), ev("2021-03-01", "B"), ev("2021-06-01", "A")], "A").map((s) => s.customerId)).toEqual(["A"]);
    // dono atual ainda sem OS: entra depois do último atendimento
    const s = ownershipSegments([ev("2021-01-01", "A"), ev("2022-01-01", "B")], "C");
    expect(s.map((x) => x.customerId)).toEqual(["A", "B", "C"]);
    expect(normName("  João  da Silva-Jr. ")).toBe("JOAO DA SILVA JR");
  });
});

describe("importação de veículos com donos e histórico de OS", () => {
  it("liga ao dono pelo nome, cria provisório, mantém OS do dono anterior e recalcula os períodos", async () => {
    const ana = await db.customer.create({ data: { type: "PF", name: `Ána Paula ${uid}`, document: `A${uid}${Date.now()}`, whatsapp: "(19) 99876-5432" } });
    const bruno = await db.customer.create({ data: { type: "PF", name: `BRUNO ${uid}`, document: `B${uid}${Date.now()}` } });
    const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const plate = `${L()}${L()}${L()}1${L()}23`, plate2 = `${L()}${L()}${L()}2${L()}34`;

    // Dono atual do carro 1 é o Bruno (comprou da Ana); carro 2 é de alguém sem cadastro
    const v = await run("VEICULOS", [
      { plate, make: "PORSCHE", model: "MACAN", ownerName: `bruno ${uid}` },
      { plate: plate2, make: "BMW", model: "M3", ownerName: `Carlos Sem Cadastro ${uid}`, ownerPhone: "(19) 3232-1111" },
    ]);
    expect(v.map((r) => r.status)).toEqual(["VALIDO", "VALIDO"]);
    expect(v[1].messages.join(" ")).toMatch(/cadastro provisório/);
    const car = await db.vehicle.findUniqueOrThrow({ where: { plate } });
    expect(car.customerId).toBe(bruno.id);
    const car2 = await db.vehicle.findUniqueOrThrow({ where: { plate: plate2 }, include: { customer: true } });
    expect(car2.customer.document).toMatch(/^SYSCAR-/);

    // Histórico: 2 OS da Ana (dona anterior) e 1 do Bruno
    const os = await run("OS", [
      { legacyNumber: `1${uid}`, openedAt: "10/02/2021", plate, customerName: `ANA PAULA ${uid}` },
      { legacyNumber: `2${uid}`, openedAt: "15/09/2022", plate, customerName: `Ana Paula ${uid}` },
      { legacyNumber: `3${uid}`, openedAt: "20/05/2024", plate, customerName: `Bruno ${uid}` },
    ]);
    expect(os.map((r) => r.status)).toEqual(["VALIDO", "VALIDO", "VALIDO"]);
    const wos = await db.workOrder.findMany({ where: { vehicleId: car.id }, orderBy: { openedAt: "asc" } });
    expect(wos.map((w) => w.customerId)).toEqual([ana.id, ana.id, bruno.id]);

    await db.$transaction((tx) => rebuildOwnership(tx, car.id));
    const own = await db.vehicleOwnership.findMany({ where: { vehicleId: car.id }, orderBy: { startedAt: "asc" } });
    expect(own.map((o) => o.customerId)).toEqual([ana.id, bruno.id]);
    expect(own[0].endedAt?.toISOString()).toBe(own[1].startedAt.toISOString());
    expect(own[1].endedAt).toBeNull();

    // Reimportação com outro dono = troca de proprietário (histórico preservado)
    const t = await run("VEICULOS", [{ plate, make: "PORSCHE", model: "MACAN", ownerName: `Ana Paula ${uid}`, ownerPhone: "19998765432" }]);
    expect(t[0].status).toBe("VALIDO");
    expect(t[0].messages[0]).toMatch(/Troca de proprietário/);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: car.id } })).customerId).toBe(ana.id);
    expect(await db.workOrder.count({ where: { vehicleId: car.id, customerId: bruno.id } })).toBe(1);

    // Mesmo dono de novo = duplicado
    const dup = await run("VEICULOS", [{ plate: plate2, make: "BMW", model: "M3", ownerName: `Carlos Sem Cadastro ${uid}`, ownerPhone: "(19) 3232-1111" }]);
    expect(dup[0].status).toBe("DUPLICADO");
  });
});
