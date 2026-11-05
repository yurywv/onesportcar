import Link from "next/link";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { centsToInput, minutesLabel, money } from "@/lib/format";
import { ITEM_TYPE_LABEL, ITEM_CLASS_LABEL } from "@/lib/estimate";
import { priceFor } from "@/lib/quote";
import { Section, Empty, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { QuoteForm } from "@/components/quote-form";
import { priceDiagnostic, reopenQuote } from "../flow-actions";
import type { TabProps } from "./types";

export const DEFAULT_MARGIN = 40; // % de markup padrão sobre o custo das peças

/** Cotação (comprador) e precificação (comercial) dos itens levantados no diagnóstico. */
export async function TabPrecificacao({ wo, user }: TabProps) {
  const items = wo.diagnosticItems;
  const quoter = can(user.role, "cotacao:editar");
  const pricer = can(user.role, "precificacao:editar") && can(user.role, "orcamento:editar");
  if (!items.length) return <Empty>O mecânico ainda não levantou serviços e peças no diagnóstico.</Empty>;

  const tech = wo.technicianId ? await db.user.findUnique({ where: { id: wo.technicianId }, select: { hourlyRate: true } }) : null;
  const catalogRate = await db.serviceCatalog.findFirst({ where: { active: true }, orderBy: { hourlyRate: "desc" }, select: { hourlyRate: true } });
  const hourly = tech?.hourlyRate || catalogRate?.hourlyRate || 30000;
  const todo = items.filter((i) => !i.estimateItemId);
  const sentEstimate = wo.estimates.some((e) => e.status !== "RASCUNHO");
  const canPrice = pricer && wo.status === "ORCAMENTO" && wo.quoteStatus !== "PENDENTE" && todo.length > 0 && !sentEstimate;
  const cost = items.reduce((s, i) => s + (i.unitCost ?? 0) * i.quantity, 0);

  return (
    <div className="space-y-5">
      <Section title="Cotação das peças (compras)" actions={
        wo.quoteStatus === "PENDENTE" ? <span className="badge badge-warn">Pendente</span> : wo.quoteStatus === "CONCLUIDA" ? <span className="badge badge-ok">Concluída{wo.quoteDoneBy && ` por ${wo.quoteDoneBy}`}</span> : null
      }>
        {quoter && wo.status === "ORCAMENTO" && wo.quoteStatus !== "CONCLUIDA" ? <QuoteForm workOrderId={wo.id} items={items} /> : (
          <ul className="divide-y divide-line text-sm">
            {items.filter((i) => i.type !== "SERVICO").map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{i.quantity}× {i.description}{i.reference && <span className="text-xs text-muted"> · PN {i.reference}</span>}</span>
                <span className="text-xs">{i.unitCost != null ? <>{i.supplierName && `${i.supplierName} · `}{money(i.unitCost)}{i.leadTimeDays != null && ` · ${i.leadTimeDays} dia(s)`}</> : <span className="badge badge-warn">aguardando cotação</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {wo.quoteStatus === "CONCLUIDA" && (quoter || pricer) && wo.status === "ORCAMENTO" && !sentEstimate && (
          <ActionForm action={reopenQuote} className="mt-3"><input type="hidden" name="workOrderId" value={wo.id} /><Submit className="btn btn-sm">Reabrir cotação</Submit></ActionForm>
        )}
      </Section>

      <Section title="Precificação (comercial)">
        {!pricer ? <p className="text-sm text-muted">A precificação é feita pelo consultor comercial.</p>
          : wo.quoteStatus === "PENDENTE" ? <p className="alert alert-info">Aguardando o comprador concluir a cotação.</p>
          : !canPrice ? (
            <p className="text-sm text-muted">{todo.length ? "O orçamento inicial já foi enviado — novos itens entram por orçamento complementar na aba Orçamentos." : "Todos os itens já estão no orçamento."} <Link className="link" href="?tab=orcamento">Ver orçamentos →</Link></p>
          ) : (
            <ActionForm action={priceDiagnostic} className="space-y-3">
              <input type="hidden" name="workOrderId" value={wo.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Valor da hora (R$)"><input name="hourlyRate" className="input" inputMode="decimal" defaultValue={centsToInput(hourly)} required /></Field>
                <Field label="Margem padrão sobre o custo (%)" hint="Markup: preço = custo × (1 + margem)"><input name="margin" className="input" inputMode="decimal" defaultValue={DEFAULT_MARGIN} /></Field>
                <div className="text-sm"><span className="label">Custo total cotado</span><div className="pt-2 font-semibold tabular-nums">{money(Math.round(cost))}</div></div>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Descrição para o cliente</th><th className="text-right">Qtd / tempo</th><th className="text-right">Custo</th><th>Margem %</th><th>Preço unit. (opcional)</th><th className="text-right">Sugerido</th><th>Fora</th></tr></thead>
                  <tbody>
                    {todo.map((i) => {
                      const sug = priceFor({ type: i.type, quantity: i.quantity, minutes: i.minutes, unitCost: i.unitCost }, { hourly, margin: DEFAULT_MARGIN });
                      return (
                        <tr key={i.id}>
                          <td className="min-w-64">
                            <span className="text-xs text-muted">{ITEM_TYPE_LABEL[i.type]} · {ITEM_CLASS_LABEL[i.classification]}</span>
                            <input name={`desc_${i.id}`} className="input !min-h-9" defaultValue={i.description} />
                          </td>
                          <td className="text-right">{i.type === "SERVICO" ? <input name={`min_${i.id}`} className="input !min-h-9 w-20 text-right" defaultValue={i.minutes ?? 60} inputMode="numeric" title="minutos" /> : i.quantity}</td>
                          <td className="text-right text-xs tabular-nums">{i.type === "SERVICO" ? minutesLabel(i.minutes ?? 0) : money(i.unitCost ?? 0)}</td>
                          <td>{i.type !== "SERVICO" && <input name={`mg_${i.id}`} className="input !min-h-9 w-20" inputMode="decimal" placeholder="padrão" />}</td>
                          <td><input name={`price_${i.id}`} className="input !min-h-9 w-28" inputMode="decimal" placeholder="R$" /></td>
                          <td className="text-right text-xs tabular-nums text-muted">{money(sug.unitPrice)}</td>
                          <td><input type="checkbox" name={`skip_${i.id}`} title="Não incluir no orçamento" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Field label="Observações para o cliente (opcional)"><textarea name="notes" className="textarea" placeholder="Ex.: prazo de entrega das peças, garantia" /></Field>
              <p className="text-xs text-muted">O cliente recebe apenas a descrição e o valor de cada item — sem o diagnóstico técnico, causa ou testes realizados.</p>
              <Submit>Gerar orçamento</Submit>
            </ActionForm>
          )}
      </Section>
    </div>
  );
}
