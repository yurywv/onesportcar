import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date, dateTime, money, centsToInput } from "@/lib/format";
import { formatDocument } from "@/lib/validators";
import { METHOD_LABEL } from "@/lib/finance";
import { PageHeader, Section, Field, DL, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { TitleBadge } from "@/components/finance-ui";
import { settle, reverse, cancel, updateDue } from "../../actions";

const ymd = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("financeiro:ver");
  const { id } = await params;
  const t = await db.title.findUnique({
    where: { id },
    include: {
      customer: true, supplier: true, category: true, costCenter: true, workOrder: true, purchaseOrder: true,
      settlements: { include: { account: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!t) notFound();
  const receber = t.kind === "RECEBER";
  const open = t.amount - t.settled;
  const canSettle = can(user.role, receber ? "financeiro:receber" : "financeiro:pagar") && (t.status === "ABERTO" || t.status === "PARCIAL");
  const canReverse = can(user.role, "financeiro:estornar");
  const accounts = canSettle ? await db.financialAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
  const reversed = new Set(t.settlements.map((s) => s.reversalOfId).filter(Boolean));
  const siblings = t.installments > 1 ? await db.title.findMany({
    where: { kind: t.kind, installments: t.installments, description: t.description, issueDate: t.issueDate, id: { not: t.id } }, orderBy: { installment: "asc" },
  }) : [];
  const party = t.customer ? <Link href={`/clientes/${t.customer.id}`} className="link">{t.customer.name}</Link>
    : t.supplier ? <Link href={`/fornecedores/${t.supplier.id}`} className="link">{t.supplier.tradeName ?? t.supplier.name}</Link> : t.counterparty;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{t.number} <TitleBadge status={t.status} dueDate={t.dueDate} /></span>}
        subtitle={<>{receber ? "Conta a receber" : "Conta a pagar"} · {t.description}</>}
        back={<Link href={receber ? "/financeiro/receber" : "/financeiro/pagar"} className="link text-xs">← {receber ? "Contas a receber" : "Contas a pagar"}</Link>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Baixas">
            {t.settlements.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Lançamento</th><th>Data</th><th>Conta</th><th>Forma</th><th className="text-right">Principal</th><th className="text-right">Juros</th><th className="text-right">Desconto</th><th className="text-right">Taxa</th><th className="text-right">Efeito no caixa</th><th /></tr></thead>
                  <tbody>
                    {t.settlements.map((s) => (
                      <tr key={s.id} className={s.reversalOfId || reversed.has(s.id) ? "text-muted" : ""}>
                        <td>{s.number}<div className="text-xs text-muted">{s.userName}</div>{s.reversalOfId && <div className="text-xs text-danger">Estorno: {s.reason}</div>}{reversed.has(s.id) && <div className="text-xs">estornado</div>}</td>
                        <td className="text-xs">{date(s.date)}</td>
                        <td className="text-xs">{s.account.name}</td>
                        <td className="text-xs">{METHOD_LABEL[s.method] ?? s.method}{s.installments > 1 && ` ${s.installments}x`}{s.reference && <div className="text-muted">{s.reference}</div>}</td>
                        <td className="text-right tabular-nums">{money(s.amount)}</td>
                        <td className="text-right tabular-nums">{s.interest ? money(s.interest) : "—"}</td>
                        <td className="text-right tabular-nums">{s.discount ? money(s.discount) : "—"}</td>
                        <td className="text-right tabular-nums">{s.fee ? money(s.fee) : "—"}</td>
                        <td className={`text-right tabular-nums ${s.cash >= 0 ? "text-ok" : "text-danger"}`}>{money(s.cash)}</td>
                        <td>
                          {canReverse && !s.reversalOfId && !reversed.has(s.id) && (
                            <details><summary className="btn btn-ghost btn-sm list-none text-danger">Estornar</summary>
                              <ActionForm action={reverse} className="mt-1 flex gap-1" confirm="Estornar esta baixa? Será lançado um movimento inverso.">
                                <input type="hidden" name="settlementId" value={s.id} /><input name="reason" className="input !min-h-8 text-xs" placeholder="Motivo" required /><Submit className="btn btn-sm">OK</Submit>
                              </ActionForm>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Nenhuma baixa.</Empty>}

            {canSettle && (
              <ActionForm action={settle} className="mt-4 grid gap-3 rounded-lg bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <h3 className="text-sm font-semibold sm:col-span-2 lg:col-span-4">{receber ? "Registrar recebimento" : "Registrar pagamento"}</h3>
                <input type="hidden" name="titleId" value={t.id} />
                <Field label="Conta *"><select name="accountId" className="select" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field label="Forma *"><select name="method" className="select" defaultValue={t.method ?? "PIX"}>{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Data"><input name="date" type="date" className="input" defaultValue={ymd(new Date())} /></Field>
                <Field label="Valor principal (R$) *"><input name="amount" className="input" inputMode="decimal" defaultValue={centsToInput(open)} required /></Field>
                <Field label="Juros / multa (R$)"><input name="interest" className="input" inputMode="decimal" placeholder="0,00" /></Field>
                <Field label={receber ? "Desconto concedido (R$)" : "Desconto obtido (R$)"}><input name="discount" className="input" inputMode="decimal" placeholder="0,00" /></Field>
                <Field label={receber ? "Taxa cartão/boleto (R$)" : "Tarifa bancária (R$)"}><input name="fee" className="input" inputMode="decimal" placeholder="0,00" /></Field>
                <Field label="Referência"><input name="reference" className="input" placeholder="NSU, E2E, nº do comprovante" /></Field>
                <div className="sm:col-span-2 lg:col-span-4"><Submit>Confirmar baixa</Submit></div>
              </ActionForm>
            )}
          </Section>
          {siblings.length > 0 && (
            <Section title="Outras parcelas">
              <ul className="space-y-1.5 text-sm">{siblings.map((s) => <li key={s.id} className="flex items-center justify-between gap-2"><Link href={`/financeiro/titulos/${s.id}`} className="link">{s.number}</Link><span className="text-xs text-muted">{s.installment}/{s.installments} · {date(s.dueDate)}</span><span className="tabular-nums">{money(s.amount)}</span><TitleBadge status={s.status} dueDate={s.dueDate} /></li>)}</ul>
            </Section>
          )}
        </div>
        <div className="space-y-5">
          <Section title="Dados do título">
            <DL items={[
              [receber ? "Cliente" : "Fornecedor", party],
              ["Documento do favorecido", t.customer ? formatDocument(t.customer.document) : t.supplier ? formatDocument(t.supplier.document) : "—"],
              ["Valor", money(t.amount)], ["Abatido", money(t.settled)], ["Saldo", <b key="s">{money(t.status === "CANCELADO" ? 0 : open)}</b>],
              ["Vencimento", date(t.dueDate)], ["Emissão / competência", `${date(t.issueDate)} / ${date(t.competence)}`],
              ["Parcela", `${t.installment} de ${t.installments}`], ["Categoria", `${t.category.code} · ${t.category.name}`], ["Centro de custo", t.costCenter?.name],
              ["Forma prevista", t.method ? METHOD_LABEL[t.method] ?? t.method : "—"], ["Documento", t.document],
              ["Origem", t.workOrder ? <Link key="o" href={`/os/${t.workOrder.id}?tab=entrega`} className="link">{t.workOrder.number}</Link> : t.purchaseOrder ? <Link key="p" href={`/compras/${t.purchaseOrder.id}`} className="link">{t.purchaseOrder.number}</Link> : "Lançamento manual"],
              ["Lançado por", `${t.createdByName} em ${dateTime(t.createdAt)}`], ["Observações", t.notes],
            ]} />
            {t.cancelReason && <p className="alert alert-error mt-3">Cancelado: {t.cancelReason}</p>}
          </Section>
          {can(user.role, "financeiro:lancar") && (t.status === "ABERTO" || t.status === "PARCIAL") && (
            <Section title="Prorrogar vencimento">
              <ActionForm action={updateDue} className="space-y-2">
                <input type="hidden" name="titleId" value={t.id} />
                <input name="dueDate" type="date" className="input" defaultValue={ymd(t.dueDate)} required />
                <input name="reason" className="input" placeholder="Motivo (negociação, erro de lançamento…)" required />
                <Submit className="btn w-full">Alterar vencimento</Submit>
              </ActionForm>
            </Section>
          )}
          {canReverse && t.status === "ABERTO" && t.settled === 0 && (
            <Section title="Cancelar título">
              <ActionForm action={cancel} className="space-y-2" confirm="Cancelar este título?">
                <input type="hidden" name="titleId" value={t.id} />
                <input name="reason" className="input" placeholder="Motivo" required />
                <Submit className="btn btn-danger w-full">Cancelar título</Submit>
              </ActionForm>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
