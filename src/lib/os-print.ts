import type { ItemType } from "@prisma/client";
import type { Snapshot, SnapshotItem } from "./estimate";
import { PART_ACTIVE } from "./wo";

// Linhas da OS para impressão/consulta, no formato do SYSCAR: PRODUTOS e SERVIÇOS separados,
// com código, referência, quantidade (ou horas), unitário e total.

export type PrintLine = {
  code: string | null;
  reference: string | null;
  quantity: number;
  unit: string | null;
  hours: boolean;
  description: string;
  unitPrice: number;
  gross: number;
  discount: number;
  total: number;
};

export type PrintData = {
  stage: "ORCAMENTO" | "OS"; // antes da aprovação mostra o orçamento; depois, o que foi aprovado
  products: PrintLine[];
  services: PrintLine[];
  productsGross: number;
  servicesGross: number;
  productsTotal: number;
  servicesTotal: number;
  discount: number;
  total: number;
};

type EstimateLike = {
  status: string;
  items: { id: string; type: ItemType; description: string; quantity: number; unitPrice: number; discount: number; minutes: number | null; code: string | null; reference: string | null; unit: string | null; sortOrder: number; createdAt: Date }[];
  versions: { snapshot: unknown; version: number }[];
};
type WoLike = {
  estimates: EstimateLike[];
  services: { status: string; description: string; price: number; soldMin: number; sourceItemId: string | null }[];
  parts: { status: string; description: string; price: number; quantity: number; sourceItemId: string | null; inventoryItem?: { sku: string; oemCode: string | null; unit: string } | null }[];
};

const isService = (t: ItemType) => t === "SERVICO" || t === "TERCEIRO";

function fromItem(i: Pick<SnapshotItem, "type" | "description" | "quantity" | "unitPrice" | "discount" | "minutes"> & { code?: string | null; reference?: string | null; unit?: string | null }): PrintLine {
  const gross = Math.round(i.quantity * i.unitPrice);
  const hours = i.unit === "H";
  return {
    code: i.code ?? null, reference: i.reference ?? null, quantity: i.quantity, unit: i.unit ?? null, hours,
    description: i.description, unitPrice: i.unitPrice, gross, discount: i.discount, total: gross - i.discount,
  };
}

function summarize(stage: PrintData["stage"], products: PrintLine[], services: PrintLine[]): PrintData {
  const sum = (a: PrintLine[], k: "gross" | "total" | "discount") => a.reduce((s, x) => s + x[k], 0);
  const productsTotal = sum(products, "total"), servicesTotal = sum(services, "total");
  return {
    stage, products, services,
    productsGross: sum(products, "gross"), servicesGross: sum(services, "gross"),
    productsTotal, servicesTotal, discount: sum(products, "discount") + sum(services, "discount"), total: productsTotal + servicesTotal,
  };
}

export function printData(wo: WoLike): PrintData {
  const snapItems = new Map<string, SnapshotItem>();
  for (const e of wo.estimates) for (const v of e.versions) for (const it of (v.snapshot as Snapshot).items) snapItems.set(it.id, it);

  const services = wo.services.filter((s) => s.status !== "CANCELADO");
  const parts = wo.parts.filter((p) => PART_ACTIVE.includes(p.status));

  if (services.length || parts.length) {
    // Após a aprovação: o que efetivamente está na OS
    const pLines = parts.map((p) => {
      const src = p.sourceItemId ? snapItems.get(p.sourceItemId) : undefined;
      if (src) return { ...fromItem(src), code: src.code ?? p.inventoryItem?.sku ?? null, reference: src.reference ?? p.inventoryItem?.oemCode ?? null, unit: src.unit ?? p.inventoryItem?.unit ?? null };
      return { code: p.inventoryItem?.sku ?? null, reference: p.inventoryItem?.oemCode ?? null, quantity: p.quantity, unit: p.inventoryItem?.unit ?? null, hours: false, description: p.description, unitPrice: Math.round(p.price / (p.quantity || 1)), gross: p.price, discount: 0, total: p.price };
    });
    const sLines = services.map((s) => {
      const src = s.sourceItemId ? snapItems.get(s.sourceItemId) : undefined;
      if (src) return fromItem(src);
      return { code: null, reference: null, quantity: 1, unit: null, hours: false, description: s.description, unitPrice: s.price, gross: s.price, discount: 0, total: s.price };
    });
    return summarize("OS", pLines, sLines);
  }

  // Antes da aprovação: orçamento em aberto (rascunho ou última versão enviada)
  const lines: PrintLine[] = [];
  const types: ItemType[] = [];
  for (const e of wo.estimates) {
    if (e.status === "RASCUNHO" || !e.versions.length) {
      for (const i of [...e.items].sort((a, b) => a.sortOrder - b.sortOrder || +a.createdAt - +b.createdAt)) { lines.push(fromItem(i)); types.push(i.type); }
    } else if (e.status === "ENVIADO") {
      const v = [...e.versions].sort((a, b) => b.version - a.version)[0];
      for (const i of (v.snapshot as Snapshot).items) { lines.push(fromItem(i)); types.push(i.type); }
    }
  }
  return summarize("ORCAMENTO", lines.filter((_, k) => !isService(types[k])), lines.filter((_, k) => isService(types[k])));
}

/** "1,5" → "H01:30" (serviço por hora) ou a quantidade com vírgula. */
export function qtyLabel(l: Pick<PrintLine, "quantity" | "hours">) {
  if (l.hours) {
    const min = Math.round(l.quantity * 60);
    return `H${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  }
  return l.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
