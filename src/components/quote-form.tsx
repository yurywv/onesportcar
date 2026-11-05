import type { DiagnosticItem } from "@prisma/client";
import { db } from "@/lib/db";
import { centsToInput } from "@/lib/format";
import { ITEM_TYPE_LABEL } from "@/lib/estimate";
import { ActionForm, Submit } from "@/components/forms";
import { saveQuote } from "@/app/(app)/os/flow-actions";

/** Formulário do comprador: custo, fornecedor e prazo de cada peça levantada pelo mecânico. */
export async function QuoteForm({ workOrderId, items }: { workOrderId: string; items: DiagnosticItem[] }) {
  const parts = items.filter((i) => i.type !== "SERVICO");
  const [suppliers, stock] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, select: { id: true, name: true, tradeName: true }, orderBy: { name: "asc" } }),
    db.inventoryItem.findMany({ where: { active: true }, select: { id: true, sku: true, name: true, avgCost: true, onHand: true }, orderBy: { name: "asc" }, take: 2000 }),
  ]);
  if (!parts.length) return <p className="text-sm text-muted">Nenhuma peça a cotar.</p>;
  return (
    <ActionForm action={saveQuote} className="space-y-2">
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <datalist id={`sup-${workOrderId}`}>{suppliers.map((s) => <option key={s.id} value={s.tradeName ?? s.name} />)}</datalist>
      {parts.map((i) => (
        <div key={i.id} className="grid gap-2 rounded-lg border border-line p-2 lg:grid-cols-[1.4fr_1fr_110px_80px_1fr]">
          <div className="text-sm">
            <span className="text-xs text-muted">{ITEM_TYPE_LABEL[i.type]}{i.reference && ` · PN ${i.reference}`}</span>
            <div className="font-medium">{i.quantity}× {i.description}</div>
            {i.notes && <div className="text-xs text-muted">{i.notes}</div>}
            {i.quotedAt && <div className="text-[11px] text-muted">cotado por {i.quotedByName}</div>}
          </div>
          <select name={`sup_${i.id}`} className="select !min-h-9" defaultValue={i.supplierId ?? ""} aria-label="Fornecedor">
            <option value="">{i.supplierName && !i.supplierId ? i.supplierName : "Fornecedor…"}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName ?? s.name}</option>)}
          </select>
          <input name={`cost_${i.id}`} className="input !min-h-9" inputMode="decimal" placeholder="Custo unit. R$" defaultValue={i.unitCost != null ? centsToInput(i.unitCost) : ""} aria-label="Custo unitário" />
          <input name={`lead_${i.id}`} className="input !min-h-9" inputMode="numeric" placeholder="Prazo d" defaultValue={i.leadTimeDays ?? ""} aria-label="Prazo em dias" />
          <select name={`inv_${i.id}`} className="select !min-h-9" defaultValue={i.inventoryItemId ?? ""} aria-label="Item do estoque">
            <option value="">Sem vínculo com estoque</option>
            {stock.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name} (saldo {s.onHand}, custo {centsToInput(s.avgCost)})</option>)}
          </select>
          <input name={`qn_${i.id}`} className="input !min-h-8 text-xs lg:col-span-5" placeholder="Obs. da cotação (marca, original/paralela, validade da cotação)" defaultValue={i.quoteNotes ?? ""} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Submit className="btn">Salvar cotação</Submit>
        <Submit className="btn btn-primary" name="finish" value="on">Concluir e enviar ao comercial</Submit>
      </div>
    </ActionForm>
  );
}
