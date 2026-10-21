import type { InventoryItem } from "@prisma/client";
import { ActionForm, Submit } from "@/components/forms";
import { Field } from "@/components/ui";
import { centsToInput } from "@/lib/format";
import { saveItem } from "./actions";
import { CFOP_LABEL, CST_LABEL, ORIGIN_LABEL } from "@/lib/fiscal-codes";

export const CATEGORY_LABEL: Record<string, string> = { PECAS: "Peças", OLEOS: "Óleos", FLUIDOS: "Fluidos", FILTROS: "Filtros", PNEUS: "Pneus", QUIMICOS: "Produtos químicos", CONSUMIVEIS: "Consumíveis", ACESSORIOS: "Acessórios" };

export function ItemForm({ item, suppliers = [] }: { item?: InventoryItem; suppliers?: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveItem} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" reset={!item}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="SKU *"><input name="sku" className="input font-mono uppercase" required defaultValue={item?.sku} /></Field>
      <Field label="Descrição *" className="sm:col-span-2 lg:col-span-3"><input name="name" className="input" required defaultValue={item?.name} /></Field>
      <Field label="Código OEM"><input name="oemCode" className="input" defaultValue={item?.oemCode ?? ""} /></Field>
      <Field label="Código fabricante"><input name="mfrCode" className="input" defaultValue={item?.mfrCode ?? ""} /></Field>
      <Field label="Marca"><input name="brand" className="input" defaultValue={item?.brand ?? ""} /></Field>
      <Field label="Categoria"><select name="category" className="select" defaultValue={item?.category ?? "PECAS"}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Unidade"><input name="unit" className="input" defaultValue={item?.unit ?? "UN"} /></Field>
      <Field label="Localização"><input name="location" className="input" defaultValue={item?.location ?? ""} /></Field>
      <Field label="Preço de venda (R$)"><input name="price" className="input" inputMode="decimal" defaultValue={item ? centsToInput(item.price) : ""} /></Field>
      <Field label="Mínimo"><input name="minQty" className="input" inputMode="decimal" defaultValue={item?.minQty ?? 0} /></Field>
      <Field label="Máximo"><input name="maxQty" className="input" inputMode="decimal" defaultValue={item?.maxQty ?? ""} /></Field>
      <Field label="Fornecedor preferencial"><select name="supplierId" className="select" defaultValue={item?.supplierId ?? ""}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-6">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Fiscal (NF-e)</legend>
        <Field label="NCM"><input name="ncm" className="input font-mono" inputMode="numeric" maxLength={8} defaultValue={item?.ncm ?? ""} placeholder="84212300" /></Field>
        <Field label="CEST"><input name="cest" className="input font-mono" inputMode="numeric" maxLength={7} defaultValue={item?.cest ?? ""} /></Field>
        <Field label="CFOP venda (SP)"><select name="cfop" className="select" defaultValue={item?.cfop ?? ""}><option value="">Padrão do emitente</option>{Object.entries(CFOP_LABEL).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select></Field>
        <Field label="Origem"><select name="origin" className="select" defaultValue={item?.origin ?? 0}>{ORIGIN_LABEL.map((l, i) => <option key={i} value={i}>{i} — {l}</option>)}</select></Field>
        <Field label="CST ICMS"><select name="cstIcms" className="select" defaultValue={item?.cstIcms ?? ""}><option value="">Conforme CFOP</option>{Object.entries(CST_LABEL).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select></Field>
        <Field label="GTIN/EAN"><input name="gtin" className="input font-mono" inputMode="numeric" defaultValue={item?.gtin ?? ""} placeholder="SEM GTIN" /></Field>
      </fieldset>
      <div className="flex items-end"><Submit>{item ? "Salvar" : "Cadastrar item"}</Submit></div>
    </ActionForm>
  );
}
