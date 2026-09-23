import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can, purchaseLimit } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date, dateTime, money, centsToInput } from "@/lib/format";
import { formatDocument } from "@/lib/validators";
import { poGoods } from "@/lib/purchasing";
import { PageHeader, Section, Field, Empty, DL } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { POBadge, TitleBadge } from "@/components/finance-ui";
import { updatePurchaseOrder, addPOItem, removePOItem, poWorkflow, receivePO } from "../actions";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("compras:ver");
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true, workOrder: { include: { vehicle: true } },
      items: { include: { inventoryItem: true }, orderBy: { sortOrder: "asc" } },
      receipts: { include: { items: { include: { poItem: true } } }, orderBy: { createdAt: "asc" } },
      titles: { orderBy: { dueDate: "asc" } },
    },
  });
  if (!po) notFound();
  const isDraft = po.status === "RASCUNHO";
  const edit = can(user.role, "compras:editar") && isDraft;
  const goods = poGoods(po.items);
  const total = goods + po.freight;
  const receivable = ["APROVADO", "ENVIADO", "RECEBIDO_PARCIAL"].includes(po.status) && can(user.role, "compras:receber");
  const [stock, orders] = edit ? await Promise.all([
    db.inventoryItem.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.workOrder.findMany({ where: { status: { in: ["AGUARDANDO_PECAS", "EM_EXECUCAO", "AGUARDANDO_APROVACAO"] } }, include: { vehicle: true }, orderBy: { number: "desc" } }),
  ]) : [[], []];
  const op = (name: string, label: string, cls = "btn", confirm?: string) => (
    <ActionForm action={poWorkflow} confirm={confirm}>
      <input type="hidden" name="id" value={po.id} /><input type="hidden" name="op" value={name} />
      <Submit className={cls}>{label}</Submit>
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{po.number} <POBadge status={po.status} /></span>}
        subtitle={<><Link href={`/fornecedores/${po.supplierId}`} className="link">{po.supplier.tradeName ?? po.supplier.name}</Link> · criado por {po.createdByName} em {dateTime(po.createdAt)}</>}
        back={<Link href="/compras" className="link text-xs">← Pedidos</Link>}
        actions={<>
          {edit && op("submit", po.items.length && total <= purchaseLimit(user.role) ? "Aprovar e concluir rascunho" : "Enviar para aprovação", "btn btn-primary")}
          {po.status === "AGUARDANDO_APROVACAO" && can(user.role, "compras:aprovar") && (po.createdById !== user.id || user.role === "ADMIN") && (
            <>
              {op("approve", "Aprovar pedido", "btn btn-primary")}
              <details className="relative">
                <summary className="btn list-none">Reprovar</summary>
                <div className="card absolute right-0 z-20 mt-1 w-72 p-3">
                  <ActionForm action={poWorkflow}><input type="hidden" name="id" value={po.id} /><input type="hidden" name="op" value="reject" />
                    <textarea name="reason" className="textarea" placeholder="Motivo" required /><Submit className="btn mt-2 w-full">Devolver para rascunho</Submit>
                  </ActionForm>
                </div>
              </details>
            </>
          )}
          {po.status === "APROVADO" && can(user.role, "compras:editar") && op("send", "Marcar como enviado ao fornecedor", "btn btn-primary")}
          <a href={`/compras/${po.id}/imprimir`} target="_blank" className="btn">Imprimir / PDF</a>
          {!["CANCELADO", "RECEBIDO"].includes(po.status) && !po.receipts.length && can(user.role, "compras:editar") && (
            <details className="relative">
              <summary className="btn btn-danger list-none">Cancelar</summary>
              <div className="card absolute right-0 z-20 mt-1 w-72 p-3">
                <ActionForm action={poWorkflow} confirm="Cancelar o pedido?"><input type="hidden" name="id" value={po.id} /><input type="hidden" name="op" value="cancel" />
                  <textarea name="reason" className="textarea" placeholder="Motivo" required /><Submit className="btn btn-danger mt-2 w-full">Confirmar cancelamento</Submit>
                </ActionForm>
              </div>
            </details>
          )}
        </>}
      />
      {po.status === "AGUARDANDO_APROVACAO" && <p className="alert alert-warn mb-4">Total de {money(total)} acima da alçada de quem criou. Um gestor (que não seja o criador) precisa aprovar.</p>}
      {po.cancelReason && <p className="alert alert-error mb-4">Cancelado: {po.cancelReason}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Itens">
            {po.items.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Item</th><th className="text-right">Qtd</th><th className="text-right">Recebido</th><th className="text-right">Custo unit.</th><th className="text-right">Total</th>{edit && <th />}</tr></thead>
                  <tbody>
                    {po.items.map((i) => (
                      <tr key={i.id}>
                        <td><span className="font-mono text-xs text-muted">{i.inventoryItem.sku}</span><div>{i.description}</div>{i.inventoryItem.avgCost > 0 && i.unitCost > i.inventoryItem.avgCost * 1.1 && <div className="text-xs text-warn">+{(((i.unitCost / i.inventoryItem.avgCost) - 1) * 100).toFixed(0)}% sobre o custo médio</div>}</td>
                        <td className="text-right tabular-nums">{i.quantity} {i.inventoryItem.unit}</td>
                        <td className={`text-right tabular-nums ${i.receivedQty >= i.quantity ? "text-ok" : i.receivedQty ? "text-warn" : "text-muted"}`}>{i.receivedQty}</td>
                        <td className="text-right tabular-nums">{money(i.unitCost)}</td>
                        <td className="text-right tabular-nums">{money(Math.round(i.quantity * i.unitCost))}</td>
                        {edit && <td><ActionForm action={removePOItem}><input type="hidden" name="itemId" value={i.id} /><Submit className="btn btn-ghost btn-sm text-danger">remover</Submit></ActionForm></td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4} className="text-right text-muted">Mercadorias</td><td className="text-right tabular-nums">{money(goods)}</td>{edit && <td />}</tr>
                    <tr><td colSpan={4} className="text-right text-muted">Frete</td><td className="text-right tabular-nums">{money(po.freight)}</td>{edit && <td />}</tr>
                    <tr><td colSpan={4} className="text-right font-semibold">Total do pedido</td><td className="text-right font-semibold tabular-nums">{money(total)}</td>{edit && <td />}</tr>
                  </tfoot>
                </table>
              </div>
            ) : <Empty>Nenhum item.</Empty>}
            {edit && (
              <ActionForm action={addPOItem} className="mt-4 grid gap-2 sm:grid-cols-[1fr_100px_140px_auto]" reset>
                <input type="hidden" name="id" value={po.id} />
                <select name="inventoryItemId" className="select" required defaultValue=""><option value="">Item do estoque…</option>{stock.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name} (custo médio {money(s.avgCost)}, saldo {s.onHand})</option>)}</select>
                <input name="quantity" className="input" placeholder="Qtd" inputMode="decimal" required />
                <input name="unitCost" className="input" placeholder="Custo unit. (R$)" inputMode="decimal" />
                <Submit className="btn">Adicionar</Submit>
              </ActionForm>
            )}
          </Section>

          {receivable && (
            <Section title="Receber mercadorias">
              <ActionForm action={receivePO} className="space-y-3" confirm="Confirmar recebimento? Dá entrada no estoque e gera os títulos a pagar.">
                <input type="hidden" name="id" value={po.id} />
                <table className="table">
                  <thead><tr><th>Item</th><th className="text-right">Pendente</th><th className="w-32 text-right">Recebendo agora</th></tr></thead>
                  <tbody>
                    {po.items.filter((i) => i.receivedQty < i.quantity).map((i) => (
                      <tr key={i.id}>
                        <td>{i.description}</td>
                        <td className="text-right tabular-nums">{Math.round((i.quantity - i.receivedQty) * 1000) / 1000}</td>
                        <td><input name={`rq_${i.id}`} className="input !min-h-8 text-right" inputMode="decimal" defaultValue={Math.round((i.quantity - i.receivedQty) * 1000) / 1000} aria-label={`Quantidade recebida de ${i.description}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Nº da NF do fornecedor"><input name="invoiceNumber" className="input" /></Field>
                  <Field label="Data da NF" hint="Base dos vencimentos"><input name="invoiceDate" type="date" className="input" /></Field>
                  <Field label="Frete nesta entrega (R$)" hint="Rateado no custo das peças"><input name="freight" className="input" inputMode="decimal" defaultValue={po.receipts.length ? "0,00" : centsToInput(po.freight)} /></Field>
                </div>
                <Field label="Observações (divergências, avarias)"><input name="notes" className="input" /></Field>
                <Submit>Confirmar recebimento</Submit>
              </ActionForm>
            </Section>
          )}

          {po.receipts.length > 0 && (
            <Section title="Recebimentos">
              <ul className="space-y-3 text-sm">
                {po.receipts.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap justify-between gap-2"><b>{r.invoiceNumber ? `NF ${r.invoiceNumber}` : "Sem NF"}{r.invoiceDate && ` de ${date(r.invoiceDate)}`}</b><span className="text-xs text-muted">{r.userName} · {dateTime(r.createdAt)}</span></div>
                    <ul className="mt-1 text-xs text-muted">{r.items.map((it) => <li key={it.id}>{it.quantity}× {it.poItem.description} a {money(it.unitCost)} (com frete)</li>)}</ul>
                    <div className="mt-1 text-xs">Total {money(r.total)}{r.freight ? ` · frete ${money(r.freight)}` : ""}{r.notes && ` · ${r.notes}`}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          <Section title="Condições">
            {edit ? (
              <ActionForm action={updatePurchaseOrder} className="space-y-3">
                <input type="hidden" name="id" value={po.id} />
                <Field label="Condição de pagamento (dias)" hint="30 ou 30/60/90; 0 = à vista"><input name="paymentTerms" className="input" defaultValue={po.paymentTerms} required /></Field>
                <Field label="Frete (R$)"><input name="freight" className="input" inputMode="decimal" defaultValue={centsToInput(po.freight)} /></Field>
                <Field label="Previsão de entrega"><input name="expectedAt" type="date" className="input" defaultValue={po.expectedAt ? new Date(po.expectedAt.getTime() - 3 * 3600_000).toISOString().slice(0, 10) : ""} /></Field>
                <Field label="OS vinculada"><select name="workOrderId" className="select" defaultValue={po.workOrderId ?? ""}><option value="">Estoque geral</option>{orders.map((w) => <option key={w.id} value={w.id}>{w.number} — {w.vehicle.model}</option>)}</select></Field>
                <Field label="Observações para o fornecedor"><textarea name="notes" className="textarea" defaultValue={po.notes ?? ""} /></Field>
                <Submit className="btn w-full">Salvar</Submit>
              </ActionForm>
            ) : (
              <DL items={[
                ["Condição", po.paymentTerms === "0" ? "À vista" : `${po.paymentTerms} dias`], ["Previsão", date(po.expectedAt)],
                ["Aprovado por", po.approvedByName ? `${po.approvedByName} em ${dateTime(po.approvedAt)}` : "—"], ["Enviado em", dateTime(po.sentAt)],
                ["OS", po.workOrder ? <Link key="w" href={`/os/${po.workOrder.id}`} className="link">{po.workOrder.number} — {po.workOrder.vehicle.model}</Link> : "Estoque geral"],
                ["Observações", po.notes],
              ]} />
            )}
          </Section>
          <Section title="Fornecedor">
            <DL items={[["Razão social", po.supplier.name], ["CNPJ", formatDocument(po.supplier.document)], ["Contato", po.supplier.contactName], ["E-mail", po.supplier.email], ["WhatsApp", po.supplier.whatsapp]]} />
          </Section>
          {po.titles.length > 0 && (
            <Section title="Contas a pagar geradas">
              <ul className="space-y-1.5 text-sm">
                {po.titles.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    {can(user.role, "financeiro:ver") ? <Link href={`/financeiro/titulos/${t.id}`} className="link">{t.number}</Link> : <span>{t.number}</span>}
                    <span className="text-xs text-muted">{t.installment}/{t.installments} · {date(t.dueDate)}</span>
                    <span className="tabular-nums">{money(t.amount)}</span>
                    <TitleBadge status={t.status} dueDate={t.dueDate} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
