import type { Propulsion } from "@prisma/client";
import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import type { ImportEntity } from "./import-fields";
import { audit } from "./audit";
import { stockEntry } from "./inventory";
import { parseMoney } from "./format";
import { isValidCNPJ, isValidCPF, isValidEmail, isValidPlate, isValidRenavam, isValidVIN, normalizeCNPJ, normalizePlate, onlyDigits } from "./validators";

// Importação de cadastros (spec §16): cada linha é normalizada e validada antes; nada inconsistente entra em silêncio.

export type RawRow = { rowNumber: number; values: Record<string, string> };
type Checked = { key: string | null; data: Record<string, unknown>; errors: string[]; warnings: string[] };

const t = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const opt = (v: unknown) => t(v) || null;
const title = (s: string) => s.toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (m) => m.toUpperCase());
const UPPER_BRANDS = new Set(["BMW", "AMG", "GMC", "RAM", "BYD", "JAC", "GWM", "MG", "DS"]);
/** Marca: "PORSCHE" → "Porsche", mas siglas continuam em maiúsculas ("BMW", "MERCEDES-AMG" → "Mercedes-AMG"). */
const brand = (s: string) => title(s).replace(/[\p{L}]+/gu, (w) => (UPPER_BRANDS.has(w.toUpperCase()) ? w.toUpperCase() : w));

function parseDate(v: string): Date | null {
  const s = t(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00-03:00`);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = new Date(`${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00-03:00`);
    return isNaN(+d) ? null : d;
  }
  return null;
}

function parseNumber(v: string): number | null {
  const s = t(v).replace(/[^\d,.-]/g, "");
  if (!s) return null;
  // "35.100" (milhar pt-BR) → 35100; "1.234,56" → 1234.56; "12.5" → 12.5
  const thousands = !s.includes(",") && /^-?\d{1,3}(\.\d{3})+$/.test(s);
  const n = s.includes(",") || thousands ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : null;
}

function doc(v: string, errors: string[], allowPF = true) {
  const raw = t(v);
  if (!raw) { errors.push("CPF/CNPJ ausente"); return null; }
  const digits = onlyDigits(raw);
  if (allowPF && digits.length === 11 && !/[A-Za-z]/.test(raw)) {
    if (!isValidCPF(digits)) { errors.push(`CPF inválido (${raw})`); return null; }
    return { type: "PF" as const, value: digits };
  }
  const cnpj = normalizeCNPJ(raw).padStart(14, "0");
  if (cnpj.length === 14 && isValidCNPJ(cnpj)) return { type: "PJ" as const, value: cnpj };
  // CPF sem zeros à esquerda (planilhas numéricas)
  if (allowPF && digits.length < 11 && isValidCPF(digits.padStart(11, "0"))) return { type: "PF" as const, value: digits.padStart(11, "0") };
  errors.push(`CPF/CNPJ inválido (${raw})`);
  return null;
}

function contacts(v: Record<string, string>, warnings: string[]) {
  let email = opt(v.email)?.toLowerCase() ?? null;
  if (email && !isValidEmail(email)) { warnings.push(`E-mail descartado por formato inválido (${email})`); email = null; }
  let uf = opt(v.uf)?.toUpperCase() ?? null;
  if (uf && !/^[A-Z]{2}$/.test(uf)) { warnings.push(`UF descartada (${uf})`); uf = null; }
  const cep = onlyDigits(t(v.cep)).padStart(t(v.cep) ? 8 : 0, "0"); // CEP numérico perde o zero à esquerda na planilha
  return {
    email, uf, phone: opt(v.phone), whatsapp: opt(v.whatsapp),
    cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null,
    street: opt(v.street), number: opt(v.number), district: opt(v.district), city: opt(v.city) && title(t(v.city)),
  };
}

const PROPULSION: [RegExp, Propulsion][] = [[/el[eé]tri/i, "ELETRICO"], [/plug/i, "HIBRIDO_PLUGIN"], [/h[ií]brid/i, "HIBRIDO"], [/flex/i, "FLEX"], [/diesel/i, "DIESEL"], [/(etanol|[aá]lcool)/i, "ETANOL"], [/gasol/i, "GASOLINA"]];
// Ordem importa: o termo mais específico primeiro ("Filtro de óleo" é filtro, não óleo)
const CATEGORY: [RegExp, string][] = [[/filtro/i, "FILTROS"], [/pneu/i, "PNEUS"], [/[oó]leo|lubrif/i, "OLEOS"], [/flu[ií]do|aditivo|arrefec/i, "FLUIDOS"], [/qu[ií]mic|limpa|spray|graxa/i, "QUIMICOS"], [/consum/i, "CONSUMIVEIS"], [/acess/i, "ACESSORIOS"]];

/** Normaliza e valida uma linha (sem consultar o banco). */
export function checkRow(entity: ImportEntity, v: Record<string, string>): Checked {
  const errors: string[] = [], warnings: string[] = [];
  switch (entity) {
    case "CLIENTES": {
      const d = doc(v.document, errors);
      const name = t(v.name);
      if (!name) errors.push("Nome ausente");
      const birth = parseDate(v.birthDate);
      if (t(v.birthDate) && !birth) warnings.push("Data de nascimento descartada");
      return {
        key: d?.value ?? null, errors, warnings,
        data: {
          type: d?.type ?? "PF", document: d?.value, name: name.slice(0, 200), tradeName: opt(v.tradeName), rgIe: opt(v.rgIe), birthDate: birth,
          ...contacts(v, warnings), complement: opt(v.complement), notes: opt(v.notes), legacyCode: opt(v.legacyCode), origin: "SYSCAR",
        },
      };
    }
    case "FORNECEDORES": {
      const d = doc(v.document, errors);
      const name = t(v.name);
      if (!name) errors.push("Razão social ausente");
      const terms = onlyDigits(t(v.paymentTerms)) ? t(v.paymentTerms).replace(/[^\d\/]/g, "") || null : null;
      return {
        key: d?.value ?? null, errors, warnings,
        data: {
          type: d?.type ?? "PJ", document: d?.value, name: name.slice(0, 200), tradeName: opt(v.tradeName), ie: opt(v.ie), contactName: opt(v.contactName),
          ...contacts(v, warnings), paymentTerms: terms, specialties: opt(v.specialties), notes: opt(v.notes), legacyCode: opt(v.legacyCode),
        },
      };
    }
    case "VEICULOS": {
      const plate = normalizePlate(t(v.plate));
      if (!plate) errors.push("Placa ausente");
      else if (!isValidPlate(plate)) errors.push(`Placa inválida (${t(v.plate)})`);
      let model = t(v.model), make = t(v.make);
      if (!make && model.includes(" ")) { make = model.split(" ")[0]; model = model.slice(make.length).trim(); warnings.push(`Marca deduzida do modelo: ${brand(make)}`); }
      if (!model) errors.push("Modelo ausente");
      if (!make) errors.push("Marca ausente");
      let vin: string | null = t(v.vin).toUpperCase().replace(/\s/g, "") || null;
      if (vin && !isValidVIN(vin)) { warnings.push(`Chassi descartado por formato inválido (${vin})`); vin = null; }
      let renavam: string | null = onlyDigits(t(v.renavam)) || null;
      if (renavam && !isValidRenavam(renavam)) { warnings.push(`RENAVAM descartado (${renavam})`); renavam = null; }
      const years = t(v.yearMfg).match(/\d{4}/g) ?? [];
      const yearMfg = years[0] ? Number(years[0]) : null;
      const yearModel = t(v.yearModel).match(/\d{4}/)?.[0] ? Number(t(v.yearModel).match(/\d{4}/)![0]) : years[1] ? Number(years[1]) : yearMfg;
      const km = parseNumber(v.mileage);
      if (!t(v.ownerDocument) && !t(v.ownerCode)) errors.push("Proprietário não informado (CPF/CNPJ ou código do cliente)");
      return {
        key: plate || null, errors, warnings,
        data: {
          plate, make: brand(make), model, version: opt(v.version), yearMfg, yearModel, color: opt(v.color) && title(t(v.color)),
          propulsion: PROPULSION.find(([re]) => re.test(t(v.fuel)))?.[1] ?? "GASOLINA", vin, renavam, engine: opt(v.engine),
          mileage: km && km > 0 ? Math.round(km) : 0, notes: opt(v.notes), legacyCode: opt(v.legacyCode),
          ownerDocument: onlyDigits(t(v.ownerDocument)).length === 11 && !/[A-Za-z]/.test(t(v.ownerDocument)) ? onlyDigits(t(v.ownerDocument)) : t(v.ownerDocument) ? normalizeCNPJ(t(v.ownerDocument)) : null,
          ownerCode: opt(v.ownerCode),
        },
      };
    }
    case "ITENS": {
      const sku = t(v.sku).toUpperCase().replace(/\s+/g, "");
      if (!sku) errors.push("Código ausente");
      const name = t(v.name);
      if (!name) errors.push("Descrição ausente");
      const cost = parseMoney(t(v.cost)), price = parseMoney(t(v.price));
      let onHand = parseNumber(v.onHand) ?? 0;
      if (onHand < 0) { warnings.push(`Saldo negativo no SYSCAR (${onHand}) — importado como zero; conferir no inventário`); onHand = 0; }
      if (onHand > 0 && !cost) warnings.push("Saldo sem custo: o estoque entra com custo zero e a margem ficará distorcida");
      return {
        key: sku || null, errors, warnings,
        data: {
          sku, name: name.slice(0, 200), mfrCode: opt(v.mfrCode), oemCode: opt(v.oemCode), brand: opt(v.brand),
          category: CATEGORY.find(([re]) => re.test(`${t(v.category)} ${name}`))?.[1] ?? "PECAS",
          unit: (t(v.unit) || "UN").toUpperCase().slice(0, 6), location: opt(v.location), cost, price, onHand: Math.round(onHand * 1000) / 1000,
          minQty: Math.max(0, parseNumber(v.minQty) ?? 0), maxQty: parseNumber(v.maxQty), legacyCode: sku,
          supplierDocument: t(v.supplierDocument) ? normalizeCNPJ(t(v.supplierDocument)) : null, supplierCode: opt(v.supplierCode),
        },
      };
    }
    case "OS": {
      const legacyNumber = t(v.legacyNumber).replace(/\s+/g, "");
      if (!legacyNumber) errors.push("Número da OS ausente");
      const openedAt = parseDate(v.openedAt);
      if (!openedAt) errors.push(`Data de abertura inválida (${t(v.openedAt) || "vazia"})`);
      const closedAt = parseDate(v.closedAt);
      const plate = normalizePlate(t(v.plate));
      if (!plate) errors.push("Placa ausente");
      const total = t(v.total) ? parseMoney(t(v.total)) : null;
      const km = parseNumber(v.km);
      return {
        key: legacyNumber || null, errors, warnings,
        data: {
          legacyNumber, openedAt, closedAt: closedAt ?? openedAt, plate, km: km && km > 0 ? Math.round(km) : null, total,
          customerDocument: t(v.customerDocument) ? (onlyDigits(t(v.customerDocument)).length === 11 ? onlyDigits(t(v.customerDocument)) : normalizeCNPJ(t(v.customerDocument))) : null,
          complaint: opt(v.complaint), services: opt(v.services), parts: opt(v.parts), technician: opt(v.technician), notes: opt(v.notes),
          cancelled: /cancel/i.test(t(v.situation)), situation: opt(v.situation),
        },
      };
    }
  }
}

/** Valida contra o banco (duplicidade e referências) e grava as linhas do lote em ImportRow. */
export async function stageRows(tx: Tx, jobId: string, entity: ImportEntity, rows: RawRow[]) {
  const checked = rows.map((r) => ({ r, c: checkRow(entity, r.values) }));
  const keys = checked.map((x) => x.c.key).filter(Boolean) as string[];
  const [inDb, inFile] = await Promise.all([existingKeys(tx, entity, keys), tx.importRow.findMany({ where: { jobId, key: { in: keys }, status: { in: ["VALIDO", "DUPLICADO", "INVALIDO"] } }, select: { key: true, rowNumber: true } })]);
  const seen = new Map(inFile.map((x) => [x.key!, x.rowNumber]));
  const counts = { VALIDO: 0, DUPLICADO: 0, INVALIDO: 0 };
  for (const { r, c } of checked) {
    const messages = [...c.errors, ...c.warnings.map((w) => `Aviso: ${w}`)];
    let status: keyof typeof counts = c.errors.length ? "INVALIDO" : "VALIDO";
    if (status === "VALIDO" && c.key) {
      if (inDb.has(c.key)) { status = "DUPLICADO"; messages.unshift(inDb.get(c.key)!); }
      else if (seen.has(c.key)) { status = "DUPLICADO"; messages.unshift(`Repetido no arquivo (mesma chave da linha ${seen.get(c.key)})`); }
    }
    if (status === "VALIDO") {
      const ref = await resolveRefs(tx, entity, c.data);
      if (ref.error) { status = "INVALIDO"; messages.unshift(ref.error); }
      else Object.assign(c.data, ref.data);
    }
    if (c.key && !seen.has(c.key)) seen.set(c.key, r.rowNumber);
    counts[status]++;
    await tx.importRow.create({ data: { jobId, rowNumber: r.rowNumber, key: c.key, data: JSON.parse(JSON.stringify(c.data)), status, messages } });
  }
  return counts;
}

async function existingKeys(tx: Tx, entity: ImportEntity, keys: string[]) {
  const m = new Map<string, string>();
  if (!keys.length) return m;
  if (entity === "CLIENTES") for (const c of await tx.customer.findMany({ where: { document: { in: keys } }, select: { document: true, name: true } })) m.set(c.document, `Já cadastrado: ${c.name}`);
  if (entity === "FORNECEDORES") for (const s of await tx.supplier.findMany({ where: { document: { in: keys } }, select: { document: true, name: true } })) m.set(s.document, `Já cadastrado: ${s.name}`);
  if (entity === "VEICULOS") for (const v of await tx.vehicle.findMany({ where: { plate: { in: keys } }, select: { plate: true, model: true } })) m.set(v.plate, `Placa já cadastrada (${v.model})`);
  if (entity === "ITENS") for (const i of await tx.inventoryItem.findMany({ where: { sku: { in: keys } }, select: { sku: true, name: true } })) m.set(i.sku, `Código já cadastrado: ${i.name}`);
  if (entity === "OS") for (const w of await tx.workOrder.findMany({ where: { legacyNumber: { in: keys } }, select: { legacyNumber: true, number: true } })) m.set(w.legacyNumber!, `OS já importada (${w.number})`);
  return m;
}

/** Resolve vínculos (proprietário do veículo, veículo da OS, fornecedor da peça). */
async function resolveRefs(tx: Tx, entity: ImportEntity, d: Record<string, unknown>): Promise<{ error?: string; data?: Record<string, unknown> }> {
  if (entity === "VEICULOS") {
    const c = d.ownerDocument ? await tx.customer.findUnique({ where: { document: d.ownerDocument as string } })
      : d.ownerCode ? await tx.customer.findFirst({ where: { legacyCode: d.ownerCode as string } }) : null;
    if (!c) return { error: `Proprietário não encontrado (${d.ownerDocument ?? `código ${d.ownerCode}`}). Importe os clientes antes.` };
    return { data: { customerId: c.id, ownerName: c.name } };
  }
  if (entity === "OS") {
    const v = await tx.vehicle.findUnique({ where: { plate: d.plate as string } });
    if (!v) return { error: `Veículo ${d.plate} não encontrado. Importe os veículos antes.` };
    let customerId = v.customerId;
    if (d.customerDocument) {
      const c = await tx.customer.findUnique({ where: { document: d.customerDocument as string } });
      if (c) customerId = c.id;
    }
    return { data: { vehicleId: v.id, customerId } };
  }
  if (entity === "ITENS" && (d.supplierDocument || d.supplierCode)) {
    const s = d.supplierDocument ? await tx.supplier.findUnique({ where: { document: d.supplierDocument as string } })
      : await tx.supplier.findFirst({ where: { legacyCode: d.supplierCode as string } });
    return { data: { supplierId: s?.id ?? null } };
  }
  return {};
}

/** Grava uma linha validada. Retorna o id criado. */
export async function importRow(tx: Tx, user: SessionUser, entity: ImportEntity, d: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (entity) {
    case "CLIENTES": {
      const c = await tx.customer.create({ data: {
        type: d.type, document: d.document, name: d.name, tradeName: d.tradeName, rgIe: d.rgIe, birthDate: d.birthDate ? new Date(d.birthDate) : null,
        phone: d.phone, whatsapp: d.whatsapp, email: d.email, cep: d.cep, street: d.street, number: d.number, complement: d.complement,
        district: d.district, city: d.city, uf: d.uf, notes: d.notes, legacyCode: d.legacyCode, origin: "SYSCAR",
      } });
      return c.id;
    }
    case "FORNECEDORES": {
      const s = await tx.supplier.create({ data: {
        type: d.type, document: d.document, name: d.name, tradeName: d.tradeName, ie: d.ie, contactName: d.contactName, phone: d.phone, whatsapp: d.whatsapp,
        email: d.email, cep: d.cep, street: d.street, number: d.number, district: d.district, city: d.city, uf: d.uf, paymentTerms: d.paymentTerms,
        specialties: d.specialties, notes: d.notes, legacyCode: d.legacyCode,
      } });
      return s.id;
    }
    case "VEICULOS": {
      const v = await tx.vehicle.create({ data: {
        customerId: d.customerId, plate: d.plate, make: d.make, model: d.model, version: d.version, yearMfg: d.yearMfg, yearModel: d.yearModel,
        color: d.color, propulsion: d.propulsion, vin: d.vin, renavam: d.renavam, engine: d.engine, mileage: d.mileage, notes: d.notes, legacyCode: d.legacyCode,
      } });
      await tx.vehicleOwnership.create({ data: { vehicleId: v.id, customerId: d.customerId } });
      if (d.mileage) await tx.odometerReading.create({ data: { vehicleId: v.id, km: d.mileage, source: "IMPORTACAO", userId: user.id } });
      return v.id;
    }
    case "ITENS": {
      const i = await tx.inventoryItem.create({ data: {
        sku: d.sku, name: d.name, mfrCode: d.mfrCode, oemCode: d.oemCode, brand: d.brand, category: d.category, unit: d.unit, location: d.location,
        price: d.price, minQty: d.minQty, maxQty: d.maxQty, supplierId: d.supplierId ?? null, legacyCode: d.legacyCode,
      } });
      if (d.onHand > 0) await stockEntry(tx, user, i.id, d.onHand, d.cost, "Saldo inicial importado do SYSCAR", "INVENTARIO");
      return i.id;
    }
    case "OS": {
      const notes = [d.services && `Serviços: ${d.services}`, d.parts && `Peças: ${d.parts}`, d.technician && `Técnico: ${d.technician}`, d.situation && `Situação no SYSCAR: ${d.situation}`, d.notes].filter(Boolean).join("\n");
      const w = await tx.workOrder.create({ data: {
        number: `SYS-${d.legacyNumber}`, legacy: true, legacyNumber: d.legacyNumber, legacyTotal: d.total, branchId: user.branchId,
        customerId: d.customerId, vehicleId: d.vehicleId, status: d.cancelled ? "CANCELADA" : "ENTREGUE", openedAt: new Date(d.openedAt),
        closedAt: new Date(d.closedAt), complaint: d.complaint ?? d.services, notes: notes || null, createdById: user.id,
        cancelReason: d.cancelled ? "Cancelada no SYSCAR" : null,
      } });
      if (d.km) await tx.odometerReading.create({ data: { vehicleId: d.vehicleId, km: d.km, source: "IMPORTACAO", workOrderId: w.id, userId: user.id, createdAt: new Date(d.openedAt) } });
      return w.id;
    }
  }
}

/** Desfaz uma linha importada se o registro ainda não foi usado. Retorna mensagem de bloqueio ou null. */
export async function revertRow(tx: Tx, user: SessionUser, entity: ImportEntity, id: string, jobShort: string): Promise<string | null> {
  switch (entity) {
    case "CLIENTES": {
      const [v, w, a, t2] = await Promise.all([tx.vehicle.count({ where: { customerId: id } }), tx.workOrder.count({ where: { customerId: id } }), tx.appointment.count({ where: { customerId: id } }), tx.title.count({ where: { customerId: id } })]);
      if (v + w + a + t2) return "cliente já tem veículos, OS, agendamentos ou títulos";
      await tx.vehicleOwnership.deleteMany({ where: { customerId: id } });
      await tx.customer.delete({ where: { id } });
      return null;
    }
    case "FORNECEDORES": {
      const [p, t2, i] = await Promise.all([tx.purchaseOrder.count({ where: { supplierId: id } }), tx.title.count({ where: { supplierId: id } }), tx.inventoryItem.count({ where: { supplierId: id } })]);
      if (p + t2 + i) return "fornecedor já tem pedidos, títulos ou itens vinculados";
      await tx.supplier.delete({ where: { id } });
      return null;
    }
    case "VEICULOS": {
      const [w, a] = await Promise.all([tx.workOrder.count({ where: { vehicleId: id } }), tx.appointment.count({ where: { vehicleId: id } })]);
      if (w + a) return "veículo já tem OS ou agendamentos";
      await tx.odometerReading.deleteMany({ where: { vehicleId: id } });
      await tx.vehicleOwnership.deleteMany({ where: { vehicleId: id } });
      await tx.vehicle.delete({ where: { id } });
      return null;
    }
    case "ITENS": {
      const [moves, parts, po] = await Promise.all([tx.inventoryMovement.count({ where: { itemId: id, type: { not: "INVENTARIO" } } }), tx.workOrderPart.count({ where: { inventoryItemId: id } }), tx.purchaseOrderItem.count({ where: { inventoryItemId: id } })]);
      if (moves + parts + po) return "item já teve movimentações, uso em OS ou pedidos";
      // Movimentos de estoque são imutáveis: zera por ajuste e desativa o item, liberando o código para nova importação
      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
      if (item.onHand > 0) {
        await tx.inventoryMovement.create({ data: { itemId: id, type: "AJUSTE", quantity: -item.onHand, unitCost: item.avgCost, balanceAfter: 0, avgCostAfter: item.avgCost, reason: "Reversão de importação", userId: user.id, userName: user.name } });
      }
      await tx.inventoryItem.update({ where: { id }, data: { onHand: 0, active: false, sku: `${item.sku}~REV${jobShort}` } });
      return null;
    }
    case "OS": {
      const w = await tx.workOrder.findUniqueOrThrow({ where: { id } });
      if (!w.legacy) return "OS não é histórico importado";
      await tx.odometerReading.deleteMany({ where: { workOrderId: id } });
      await tx.workOrder.delete({ where: { id } });
      return null;
    }
  }
}

export async function auditImport(tx: Tx, user: SessionUser, action: string, jobId: string, after: Record<string, unknown>) {
  await audit({ action, entity: "ImportJob", entityId: jobId, userId: user.id, userName: user.name, after }, tx);
}
