import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { date, dateTime, money } from "@/lib/format";
import { formatDocument } from "@/lib/validators";
import { poGoods, PO_STATUS_LABEL } from "@/lib/purchasing";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Pedido de compra" };

export default async function PrintPO({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("compras:ver");
  const po = await db.purchaseOrder.findUnique({ where: { id: (await params).id }, include: { supplier: true, items: { include: { inventoryItem: true }, orderBy: { sortOrder: "asc" } } } });
  if (!po) notFound();
  const branch = await db.branch.findUnique({ where: { id: po.branchId }, include: { company: true } });
  const goods = poGoods(po.items);
  return (
    <article className="mx-auto max-w-3xl bg-surface p-6 text-sm print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end"><PrintButton /></div>
      <header className="flex items-start justify-between border-b border-line pb-3">
        <div><div className="text-lg font-bold">OneSportcar</div><div className="text-xs text-muted">{branch?.company.name}{branch?.company.document && ` · CNPJ ${formatDocument(branch.company.document)}`}</div></div>
        <div className="text-right"><div className="text-lg font-bold">Pedido {po.number}</div><div className="text-xs">{PO_STATUS_LABEL[po.status]} · {date(po.createdAt)}</div></div>
      </header>
      <section className="grid grid-cols-2 gap-4 border-b border-line py-3">
        <div><h2 className="mb-1 font-semibold">Fornecedor</h2><div>{po.supplier.name}</div><div>CNPJ/CPF {formatDocument(po.supplier.document)}</div><div>{po.supplier.contactName} · {po.supplier.email ?? po.supplier.phone}</div></div>
        <div><h2 className="mb-1 font-semibold">Condições</h2><div>Pagamento: {po.paymentTerms === "0" ? "à vista" : `${po.paymentTerms} dias`}</div><div>Entrega prevista: {date(po.expectedAt)}</div><div>Aprovado por: {po.approvedByName ?? "—"} {po.approvedAt && `em ${dateTime(po.approvedAt)}`}</div></div>
      </section>
      <table className="table my-3">
        <thead><tr><th>Código</th><th>Descrição</th><th>OEM</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
        <tbody>{po.items.map((i) => <tr key={i.id}><td className="font-mono text-xs">{i.inventoryItem.mfrCode ?? i.inventoryItem.sku}</td><td>{i.description}</td><td className="text-xs">{i.inventoryItem.oemCode ?? "—"}</td><td className="text-right">{i.quantity} {i.inventoryItem.unit}</td><td className="text-right">{money(i.unitCost)}</td><td className="text-right">{money(Math.round(i.quantity * i.unitCost))}</td></tr>)}</tbody>
        <tfoot>
          <tr><td colSpan={5} className="text-right">Mercadorias</td><td className="text-right">{money(goods)}</td></tr>
          <tr><td colSpan={5} className="text-right">Frete</td><td className="text-right">{money(po.freight)}</td></tr>
          <tr><td colSpan={5} className="text-right font-semibold">Total</td><td className="text-right font-semibold">{money(goods + po.freight)}</td></tr>
        </tfoot>
      </table>
      {po.notes && <p className="border-t border-line pt-3"><b>Observações:</b> {po.notes}</p>}
      <p className="mt-6 text-xs text-muted">Favor informar o número do pedido na nota fiscal. Entregas divergentes em quantidade ou preço serão recusadas.</p>
    </article>
  );
}
