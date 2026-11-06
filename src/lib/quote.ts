import type { ItemClass, ItemType } from "@prisma/client";
import { RuleError } from "./workflow";

const TYPES: ItemType[] = ["SERVICO", "PECA", "CONSUMIVEL", "TERCEIRO", "TAXA"];
const CLASSES: ItemClass[] = ["OBRIGATORIO", "RECOMENDADO", "PREVENTIVO", "OPCIONAL"];

/** Há peças do diagnóstico ainda sem cotação do comprador? */
export const quotePending = (wo: { quoteStatus: string | null }) => wo.quoteStatus === "PENDENTE";

/**
 * Preço de venda de um item do diagnóstico.
 * Serviço: tempo (min) × valor da hora. Peça/consumível/terceiro: custo cotado × (1 + margem%) (markup sobre o custo).
 * `override` (preço unitário informado pelo comercial) prevalece.
 */
export function priceFor(item: { type: ItemType; quantity: number; minutes: number | null; unitCost: number | null }, p: { hourly: number; margin: number; override?: number | null }) {
  if (item.type === "SERVICO") {
    const price = p.override ?? Math.round(((item.minutes ?? 60) / 60) * p.hourly);
    return { unitPrice: price, unitCost: 0 };
  }
  const cost = item.unitCost ?? 0;
  return { unitPrice: p.override ?? Math.round(cost * (1 + p.margin / 100)), unitCost: cost };
}

type RawItem = { type?: string; description?: string; quantity?: string | number; minutes?: string | number; reference?: string; classification?: string; notes?: string };

/** Itens levantados pelo mecânico (JSON do formulário). */
export function parseDiagItems(raw: string | null) {
  if (!raw) return [];
  let arr: RawItem[];
  try { arr = JSON.parse(raw); } catch { throw new RuleError("Lista de itens inválida."); }
  if (!Array.isArray(arr)) return [];
  return arr.filter((r) => r.description?.trim()).slice(0, 80).map((r) => {
    const type = TYPES.includes(r.type as ItemType) ? (r.type as ItemType) : "PECA";
    const quantity = Number(String(r.quantity ?? "1").replace(",", "."));
    const minutes = r.minutes === undefined || r.minutes === "" ? null : Math.round(Number(String(r.minutes).replace(",", ".")));
    if (!Number.isFinite(quantity) || quantity <= 0) throw new RuleError(`Quantidade inválida em "${r.description}".`);
    if (type === "SERVICO" && (!minutes || minutes <= 0)) throw new RuleError(`Informe o tempo (minutos) do serviço "${r.description}".`);
    return {
      type, description: r.description!.trim().slice(0, 200), quantity, minutes: type === "SERVICO" ? minutes : null,
      reference: r.reference?.trim().slice(0, 80) || null, notes: r.notes?.trim().slice(0, 300) || null,
      classification: CLASSES.includes(r.classification as ItemClass) ? (r.classification as ItemClass) : "OBRIGATORIO",
    };
  });
}

