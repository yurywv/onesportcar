import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { checkRow, stageRows, importRow, revertRow } from "@/lib/importer";
import { suggestMapping, FIELDS } from "@/lib/import-fields";
import { createPasswordToken, consumeToken, findValidToken } from "@/lib/password";
import type { SessionUser } from "@/lib/auth";

const db = new PrismaClient();
const uid = Math.random().toString(36).slice(2, 7).toUpperCase();
let admin: SessionUser;

// CPF válido gerado a partir de uma base (para não colidir entre execuções)
function cpf(base: string) {
  const b = base.padStart(9, "0").slice(-9);
  const dv = (s: string) => { let sum = 0; for (let i = 0; i < s.length; i++) sum += Number(s[i]) * (s.length + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); return b + d1 + dv(b + d1);
}
const seed = String(Date.now()).slice(-8);

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "T", document: "1" } });
  const b = await db.branch.create({ data: { companyId: c.id, code: `I${uid}`, name: "T" } });
  const u = await db.user.create({ data: { branchId: b.id, name: "Admin", email: `adm-${uid}@t.test`, passwordHash: "x", role: "ADMIN" } });
  admin = { id: u.id, name: u.name, email: u.email, role: "ADMIN", branchId: b.id };
});

async function run(entity: "CLIENTES" | "VEICULOS" | "ITENS" | "OS" | "FORNECEDORES", rows: Record<string, string>[]) {
  const job = await db.importJob.create({ data: { entity, fileName: "t.xls", mapping: {}, userId: admin.id, userName: "A", totalRows: rows.length } });
  const counts = await db.$transaction((tx) => stageRows(tx, job.id, entity, rows.map((values, i) => ({ rowNumber: i + 2, values }))));
  const staged = await db.importRow.findMany({ where: { jobId: job.id }, orderBy: { rowNumber: "asc" } });
  return { job, counts, staged };
}

describe("importador", () => {
  it("sugere o mapeamento pelos cabeçalhos do SYSCAR", () => {
    const m = suggestMapping("CLIENTES", ["Cód.", "Nome/Razão Social", "CPF/CNPJ", "Fone", "Celular", "E-mail", "Endereço", "Nº", "Bairro", "Cidade", "UF", "CEP"]);
    expect(m.name).toBe(1); expect(m.document).toBe(2); expect(m.phone).toBe(3); expect(m.whatsapp).toBe(4); expect(m.number).toBe(7); expect(m.cep).toBe(11);
    expect(FIELDS.CLIENTES.filter((f) => f.required).every((f) => m[f.key] != null)).toBe(true);
  });

  it("normaliza valores típicos de planilha legada", () => {
    const c = checkRow("CLIENTES", { document: String(Number(cpf("012345678"))), name: "Fulano", cep: "1310100", email: "x@", uf: "sp" });
    expect(c.errors).toEqual([]);
    expect(c.data.document).toBe(cpf("012345678"));
    expect(c.data.cep).toBe("01310-100");
    expect(c.data.email).toBeNull();
    expect(c.warnings.some((w) => w.includes("E-mail"))).toBe(true);
    expect(checkRow("CLIENTES", { document: "123", name: "X" }).errors[0]).toMatch(/inválido/);
    const v = checkRow("VEICULOS", { plate: "bra-2e19", model: "PORSCHE 911 CARRERA S", yearMfg: "2021/2022", ownerDocument: "1", fuel: "Gasolina", vin: "123" });
    expect(v.data).toMatchObject({ plate: "BRA2E19", make: "Porsche", model: "911 CARRERA S", yearMfg: 2021, yearModel: 2022, vin: null });
    expect(checkRow("VEICULOS", { plate: "BRA2E19", make: "MERCEDES-AMG", model: "GT", ownerCode: "1" }).data.make).toBe("Mercedes-AMG");
    expect(checkRow("VEICULOS", { plate: "BRA2E19", model: "BMW M3", ownerCode: "1" }).data.make).toBe("BMW");
    const o = checkRow("OS", { legacyNumber: "1234", openedAt: "05/03/2024", plate: "ABC1234", total: "1.234,56" });
    expect(o.data.total).toBe(123456);
    expect((o.data.openedAt as Date).toISOString().slice(0, 10)).toBe("2024-03-05");
  });

  it("valida, detecta duplicidade, importa em ordem e reverte o que não foi usado", async () => {
    const d1 = cpf(`1${seed}`), d2 = cpf(`2${seed}`);
    const cli = await run("CLIENTES", [
      { document: d1, name: "Cliente A", legacyCode: `A${uid}` },
      { document: d2, name: "Cliente B", legacyCode: `B${uid}` },
      { document: d1, name: "Cliente A repetido" },
      { document: "000", name: "Sem doc" },
    ]);
    expect(cli.counts).toEqual({ VALIDO: 2, DUPLICADO: 1, INVALIDO: 1 });
    expect(cli.staged[2].messages[0]).toMatch(/linha 2/);
    for (const r of cli.staged.filter((r) => r.status === "VALIDO")) {
      const id = await db.$transaction((tx) => importRow(tx, admin, "CLIENTES", r.data as Record<string, unknown>));
      await db.importRow.update({ where: { id: r.id }, data: { status: "IMPORTADO", targetId: id } });
    }
    // Segundo arquivo: já existe no banco
    expect((await run("CLIENTES", [{ document: d1, name: "A" }])).counts.DUPLICADO).toBe(1);

    const p1 = `I${uid}`.slice(0, 3).replace(/[^A-Z]/g, "X").padEnd(3, "X");
    const plateA = `${p1}1${seed.slice(-3)}`, plateB = `${p1}2${seed.slice(-3)}`;
    const veh = await run("VEICULOS", [
      { plate: plateA, make: "BMW", model: "M3", ownerCode: `A${uid}`, mileage: "35.100" },
      { plate: plateB, make: "Audi", model: "RS6", ownerDocument: "99999999999" },
    ]);
    expect(veh.counts).toEqual({ VALIDO: 1, DUPLICADO: 0, INVALIDO: 1 });
    expect(veh.staged[1].messages[0]).toMatch(/Proprietário não encontrado|inválido/);
    const vRow = veh.staged[0];
    const vehicleId = await db.$transaction((tx) => importRow(tx, admin, "VEICULOS", vRow.data as Record<string, unknown>));
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).mileage).toBe(35100);

    const os = await run("OS", [{ legacyNumber: `L${uid}`, openedAt: "2024-01-10", plate: plateA, services: "Revisão 30 mil", total: "4500,00", km: "30000" }, { legacyNumber: "X1", openedAt: "2024-01-10", plate: "ZZZ9999" }]);
    expect(os.counts).toEqual({ VALIDO: 1, DUPLICADO: 0, INVALIDO: 1 });
    const woId = await db.$transaction((tx) => importRow(tx, admin, "OS", os.staged[0].data as Record<string, unknown>));
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId } });
    expect([wo.legacy, wo.status, wo.number, wo.legacyTotal]).toEqual([true, "ENTREGUE", `SYS-L${uid}`, 450000]);

    const it = await run("ITENS", [{ sku: `sk ${uid}`, name: "Filtro de óleo", onHand: "-2", cost: "10" }, { sku: `S2${uid}`, name: "Óleo 5W30", onHand: "12", cost: "35,90" }]);
    expect(it.counts.VALIDO).toBe(2);
    expect(it.staged[0].messages.join()).toMatch(/negativo/);
    expect((it.staged[0].data as { category: string }).category).toBe("FILTROS");
    const itemId = await db.$transaction((tx) => importRow(tx, admin, "ITENS", it.staged[1].data as Record<string, unknown>));
    const item = await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, include: { movements: true } });
    expect([item.onHand, item.avgCost, item.category, item.movements[0].type]).toEqual([12, 3590, "OLEOS", "INVENTARIO"]);

    // Reversão: cliente com veículo é mantido; veículo com OS é mantido; OS histórica é removida; depois o veículo e o cliente saem
    const customerA = (await db.importRow.findFirstOrThrow({ where: { jobId: cli.job.id, status: "IMPORTADO", key: d1 } })).targetId!;
    expect(await db.$transaction((tx) => revertRow(tx, admin, "CLIENTES", customerA, "x"))).toMatch(/veículos/);
    expect(await db.$transaction((tx) => revertRow(tx, admin, "VEICULOS", vehicleId, "x"))).toMatch(/OS/);
    expect(await db.$transaction((tx) => revertRow(tx, admin, "OS", woId, "x"))).toBeNull();
    expect(await db.$transaction((tx) => revertRow(tx, admin, "VEICULOS", vehicleId, "x"))).toBeNull();
    expect(await db.$transaction((tx) => revertRow(tx, admin, "CLIENTES", customerA, "x"))).toBeNull();
    expect(await db.$transaction((tx) => revertRow(tx, admin, "ITENS", itemId, uid))).toBeNull();
    const reverted = await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    expect([reverted.active, reverted.onHand, reverted.sku.includes("~REV")]).toEqual([false, 0, true]);
  });

  it("lê .xls antigo gerado como os relatórios do SYSCAR", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Relatório de clientes"], [], ["Código", "Nome", "CPF/CNPJ"], [1, "Fulano", 1234567890]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "biff8" });
    const back = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets.Clientes, { header: 1, raw: true, defval: "", blankrows: false });
    expect(rows[1]).toEqual(["Código", "Nome", "CPF/CNPJ"]);
    expect(suggestMapping("CLIENTES", rows[1] as string[]).document).toBe(2);
  });
});

describe("link de definição de senha", () => {
  it("é de uso único e invalida sessões", async () => {
    const token = await db.$transaction((tx) => createPasswordToken(tx, admin.id, "PRIMEIRO_ACESSO"));
    await expect(db.$transaction((tx) => consumeToken(tx, token, "curta"))).rejects.toThrow(/10 caracteres/);
    await db.$transaction((tx) => consumeToken(tx, token, "SenhaForte123"));
    expect(await findValidToken(db, token)).toBeNull();
    await expect(db.$transaction((tx) => consumeToken(tx, token, "SenhaForte123"))).rejects.toThrow(/inválido/);
  });
});
