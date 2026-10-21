import type { ItemType } from "@prisma/client";
import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { nextNumber } from "./sequence";
import { RuleError } from "./workflow";
import { parseMoney } from "./format";

// OS de balcão (como no SYSCAR): o consultor/vendedor abre a OS já como orçamento, sem check-in assinado
// nem diagnóstico prévio, e lança os itens de uma vez (inclusive colando linhas do orçamento do SYSCAR).

export type ParsedLine = {
  line: number;
  quantity: number;
  description: string;
  unitPrice: number; // centavos
  code: string | null;
  reference: string | null;
  unit: string | null;
  hours: boolean; // serviço cobrado por hora ("H01:30")
};

const SEP = /\t|;|\|/;

/** "2" → 2 · "1,5" → 1.5 · "H01:30" / "1:30" → 1.5 (horas). */
export function parseQuantity(raw: string): { qty: number; hours: boolean } | null {
  const s = raw.trim().toUpperCase();
  const h = /^H?\s*(\d{1,3}):(\d{2})$/.exec(s);
  if (h) return { qty: Number(h[1]) + Number(h[2]) / 60, hours: true };
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? { qty: n, hours: false } : null;
}

/**
 * Uma linha por item; campos separados por TAB, ";" ou "|":
 *   quantidade ; descrição ; valor unitário [; código ; referência ; unidade]
 * Serviço por hora: informe a quantidade como "1:30" ou "H01:30".
 * Valor vazio é aceito (R$ 0,00 — item a cotar).
 */
export function parseItemLines(text: string): { items: ParsedLine[]; errors: string[] } {
  const items: ParsedLine[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = idx + 1;
    if (!raw.trim()) return;
    const f = raw.split(SEP).map((x) => x.trim());
    if (f.length < 2) return errors.push(`Linha ${line}: use "quantidade ; descrição ; valor".`);
    const q = parseQuantity(f[0]);
    if (!q) return errors.push(`Linha ${line}: quantidade inválida ("${f[0]}").`);
    const description = f[1];
    if (!description) return errors.push(`Linha ${line}: descrição vazia.`);
    const price = f[2] ? parseMoney(f[2]) : 0;
    if (price < 0) return errors.push(`Linha ${line}: valor negativo.`);
    items.push({
      line, quantity: Math.round(q.qty * 1000) / 1000, description,
      unitPrice: price, code: f[3] || null, reference: f[4] || null, unit: q.hours ? "H" : (f[5] || null)?.toUpperCase() ?? null, hours: q.hours,
    });
  });
  return { items, errors };
}

/** Adiciona as linhas ao rascunho, vinculando ao estoque/catálogo quando o código coincide. */
export async function addParsedItems(tx: Tx, estimateId: string, products: ParsedLine[], services: ParsedLine[]) {
  const est = await tx.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { items: { select: { sortOrder: true } } } });
  if (est.status === "RESPONDIDO") throw new RuleError("Orçamento já respondido; crie um complementar.");
  let order = est.items.reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;

  const codes = products.map((p) => p.code).filter(Boolean) as string[];
  const stock = codes.length
    ? await tx.inventoryItem.findMany({ where: { OR: [{ sku: { in: codes } }, { legacyCode: { in: codes } }] } })
    : [];
  const svcCodes = services.map((s) => s.code?.toUpperCase()).filter(Boolean) as string[];
  const catalog = svcCodes.length ? await tx.serviceCatalog.findMany({ where: { code: { in: svcCodes } } }) : [];

  for (const p of products) {
    const inv = p.code ? stock.find((s) => s.sku === p.code || s.legacyCode === p.code) : undefined;
    const type: ItemType = inv && ["OLEOS", "FLUIDOS", "QUIMICOS", "CONSUMIVEIS"].includes(inv.category) ? "CONSUMIVEL" : "PECA";
    await tx.estimateItem.create({
      data: {
        estimateId, type, description: p.description, quantity: p.quantity, unitPrice: p.unitPrice || inv?.price || 0,
        unitCost: inv?.avgCost ?? 0, inventoryItemId: inv?.id ?? null, code: p.code ?? inv?.sku ?? null,
        reference: p.reference ?? inv?.oemCode ?? null, unit: p.unit ?? inv?.unit ?? null, sortOrder: order++,
      },
    });
  }
  for (const s of services) {
    const svc = s.code ? catalog.find((c) => c.code === s.code!.toUpperCase()) : undefined;
    const catalogPrice = svc ? svc.fixedPrice ?? Math.round((svc.standardMin / 60) * svc.hourlyRate) : 0;
    await tx.estimateItem.create({
      data: {
        estimateId, type: "SERVICO", description: s.description, quantity: s.quantity,
        minutes: s.hours ? 60 : svc?.standardMin ?? null, unitPrice: s.unitPrice || (s.hours ? svc?.hourlyRate : catalogPrice) || 0,
        serviceId: svc?.id ?? null, code: s.code ?? null, unit: s.unit, sortOrder: order++,
      },
    });
  }
}

export type CounterInput = {
  vehicleId: string;
  legacyNumber?: string | null; // nº da mesma OS no SYSCAR (operação em paralelo)
  complaint: string;
  publicNotes?: string | null;
  kmIn?: number | null;
  sellerId?: string | null;
  consultantId?: string | null;
  technicianId?: string | null;
  promisedAt?: Date | null;
  products: ParsedLine[];
  services: ParsedLine[];
};

export async function openCounterWorkOrder(tx: Tx, user: SessionUser, i: CounterInput) {
  const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: i.vehicleId } });
  const open = await tx.workOrder.findFirst({ where: { vehicleId: i.vehicleId, legacy: false, status: { notIn: ["ENTREGUE", "CANCELADA", "ENCERRADA_SEM_SERVICO"] } } });
  if (open) throw new RuleError(`Este veículo já tem a ${open.number} em aberto.`);
  if (!i.complaint.trim()) throw new RuleError("Informe os problemas/avarias relatados.");
  if (i.kmIn != null && i.kmIn < 0) throw new RuleError("Km inválido.");

  const number = await nextNumber(tx, user.branchId, "OS");
  const wo = await tx.workOrder.create({
    data: {
      number, branchId: user.branchId, customerId: vehicle.customerId, vehicleId: vehicle.id, status: "ORCAMENTO", origin: "BALCAO",
      complaint: i.complaint.trim(), publicNotes: i.publicNotes?.trim() || null, kmIn: i.kmIn ?? null,
      sellerId: i.sellerId ?? user.id, consultantId: i.consultantId ?? user.id, technicianId: i.technicianId ?? null,
      promisedAt: i.promisedAt ?? null, createdById: user.id, legacyNumber: i.legacyNumber?.trim() || null,
    },
  });
  await tx.workOrderStatusHistory.create({
    data: { workOrderId: wo.id, toStatus: "ORCAMENTO", userId: user.id, userName: user.name, reason: "OS aberta no balcão (orçamento direto, sem check-in)" },
  });
  if (i.kmIn != null && i.kmIn > vehicle.mileage) {
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { mileage: i.kmIn } });
    await tx.odometerReading.create({ data: { vehicleId: vehicle.id, km: i.kmIn, source: "MANUAL", workOrderId: wo.id, userId: user.id } });
  }
  const est = await tx.estimate.create({
    data: { number: await nextNumber(tx, user.branchId, "ORC"), workOrderId: wo.id, kind: "INICIAL", createdById: user.id, validUntil: new Date(Date.now() + 7 * 86400_000), notes: i.publicNotes?.trim() || null },
  });
  if (i.products.length || i.services.length) await addParsedItems(tx, est.id, i.products, i.services);
  await audit({
    action: "CREATE", entity: "WorkOrder", entityId: wo.id, userId: user.id, userName: user.name,
    after: { number, origin: "BALCAO", vehicleId: vehicle.id, estimate: est.number, items: i.products.length + i.services.length },
  }, tx);
  return { workOrder: wo, estimate: est };
}
