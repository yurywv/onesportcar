import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { PageHeader, Section, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { ItemForm } from "../item-form";
import { moveStock } from "../actions";

export default async function StockItem({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("estoque:ver");
  const { id } = await params;
  const item = await db.inventoryItem.findUnique({ where: { id }, include: { movements: { orderBy: { createdAt: "desc" }, take: 100 } } });
  if (!item) notFound();
  const [reservedParts, waiting] = await Promise.all([
    db.workOrderPart.findMany({ where: { inventoryItemId: id, status: "RESERVADA" }, include: { workOrder: true } }),
    db.workOrderPart.findMany({ where: { inventoryItemId: id, status: "AGUARDANDO_COMPRA" }, include: { workOrder: true } }),
  ]);
  const edit = can(user.role, "estoque:movimentar");
  const costs = can(user.role, "orcamento:ver_custos") || edit;
  const reserved = reservedParts.reduce((s, p) => s + p.quantity, 0);
  return (
    <>
      <PageHeader title={item.name} subtitle={<><span className="font-mono">{item.sku}</span> · saldo {item.onHand} {item.unit} · reservado {reserved} · disponível {item.onHand - reserved}{costs && ` · custo médio ${money(item.avgCost)}`}</>} back={<Link href="/estoque" className="link text-xs">← Estoque</Link>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Movimentações">
            {item.movements.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Data</th><th>Tipo</th><th className="text-right">Qtd</th>{costs && <th className="text-right">Custo unit.</th>}<th className="text-right">Saldo</th><th>Referência</th><th>Usuário</th></tr></thead>
                  <tbody>
                    {item.movements.map((m) => (
                      <tr key={m.id}>
                        <td className="text-xs">{dateTime(m.createdAt)}</td>
                        <td className="text-xs">{m.type}</td>
                        <td className={`text-right tabular-nums ${m.quantity < 0 ? "text-danger" : "text-ok"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
                        {costs && <td className="text-right tabular-nums">{money(m.unitCost)}</td>}
                        <td className="text-right tabular-nums">{m.balanceAfter}</td>
                        <td className="text-xs">{m.workOrderId ? <Link href={`/os/${m.workOrderId}`} className="link">{m.reference}</Link> : m.reference ?? m.reason ?? "—"}</td>
                        <td className="text-xs">{m.userName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Sem movimentações.</Empty>}
          </Section>
          {edit && <Section title="Cadastro"><ItemForm item={item} /></Section>}
        </div>
        <div className="space-y-5">
          {edit && (
            <>
              <Section title="Entrada (compra / recebimento)">
                <ActionForm action={moveStock} className="space-y-2" reset>
                  <input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="kind" value="ENTRADA" />
                  <Field label="Quantidade"><input name="quantity" className="input" inputMode="decimal" required /></Field>
                  <Field label="Custo unitário (R$)"><input name="unitCost" className="input" inputMode="decimal" required /></Field>
                  <Field label="Referência (NF, pedido)"><input name="reference" className="input" /></Field>
                  <Submit className="btn btn-primary w-full">Registrar entrada</Submit>
                </ActionForm>
              </Section>
              <Section title="Ajuste de inventário">
                <ActionForm action={moveStock} className="space-y-2" reset confirm="Confirmar ajuste de estoque? Fica registrado na auditoria.">
                  <input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="kind" value="AJUSTE" />
                  <Field label="Diferença (+/−)"><input name="quantity" className="input" inputMode="decimal" required placeholder="-1 ou 2" /></Field>
                  <Field label="Motivo *"><input name="reason" className="input" required /></Field>
                  <Submit className="btn w-full">Registrar ajuste</Submit>
                </ActionForm>
              </Section>
            </>
          )}
          <Section title="Reservas e pendências">
            <ul className="space-y-1 text-sm">
              {reservedParts.map((p) => <li key={p.id}>Reservado {p.quantity} → <Link className="link" href={`/os/${p.workOrderId}?tab=execucao`}>{p.workOrder.number}</Link></li>)}
              {waiting.map((p) => <li key={p.id} className="text-warn">Aguardando compra {p.quantity} → <Link className="link" href={`/os/${p.workOrderId}?tab=execucao`}>{p.workOrder.number}</Link></li>)}
              {!reservedParts.length && !waiting.length && <li className="text-muted">Nenhuma.</li>}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
