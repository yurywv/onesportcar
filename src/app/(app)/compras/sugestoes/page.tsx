import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { purchaseSuggestions } from "@/lib/purchasing";
import { PageHeader, Empty, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { createPurchaseOrder } from "../actions";

export const metadata = { title: "Sugestões de compra" };
export const dynamic = "force-dynamic";

export default async function Suggestions() {
  const user = await requireUser("compras:ver");
  const [rows, suppliers] = await Promise.all([purchaseSuggestions(db), db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } })]);
  const edit = can(user.role, "compras:editar");
  // Agrupa pelo fornecedor preferencial do item
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = r.item.supplierId ?? ""; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return (
    <>
      <PageHeader title="Sugestões de compra" subtitle="Peças de OS aguardando compra e itens abaixo do mínimo, já descontando o que está pedido." back={<Link href="/compras" className="link text-xs">← Pedidos</Link>} />
      {!rows.length && <Empty>Nada a comprar agora. Estoque acima do mínimo e nenhuma OS aguardando peça.</Empty>}
      <div className="space-y-5">
        {[...groups.entries()].map(([supplierId, list]) => (
          <ActionForm key={supplierId || "none"} action={createPurchaseOrder} className="card card-pad">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-semibold">{supplierId ? `Fornecedor preferencial: ${suppliers.find((s) => s.id === supplierId)?.tradeName ?? suppliers.find((s) => s.id === supplierId)?.name}` : "Sem fornecedor preferencial"}</h2>
              {edit && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Gerar pedido para">
                    <select name="supplierId" className="select" required defaultValue={supplierId}>
                      <option value="">Selecione…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName ?? s.name}</option>)}
                    </select>
                  </Field>
                  <Submit>Criar pedido com as quantidades</Submit>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Item</th><th>Motivo</th><th className="text-right">Disponível</th><th className="text-right">Mín/Máx</th><th className="text-right">Já pedido</th><th className="text-right">OS aguardando</th><th className="text-right">Custo médio</th><th className="w-28 text-right">Comprar</th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.item.id}>
                      <td><Link href={`/estoque/${r.item.id}`} className="link font-mono text-xs">{r.item.sku}</Link><div>{r.item.name}</div></td>
                      <td><span className={r.reason === "OS aguardando peça" ? "badge badge-danger" : "badge badge-warn"}>{r.reason}</span>{r.workOrders.length > 0 && <div className="text-xs text-muted">{r.workOrders.join(", ")}</div>}</td>
                      <td className="text-right tabular-nums">{r.available} {r.item.unit}</td>
                      <td className="text-right tabular-nums">{r.item.minQty}/{r.item.maxQty ?? "—"}</td>
                      <td className="text-right tabular-nums">{r.onOrder || "—"}</td>
                      <td className="text-right tabular-nums">{r.waitingQty || "—"}</td>
                      <td className="text-right tabular-nums">{money(r.item.avgCost)}</td>
                      <td className="text-right"><input name={`item_${r.item.id}`} defaultValue={r.suggested} className="input !min-h-8 text-right" inputMode="decimal" aria-label={`Quantidade de ${r.item.name}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        ))}
      </div>
    </>
  );
}
