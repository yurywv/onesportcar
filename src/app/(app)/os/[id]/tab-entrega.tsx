import Link from "next/link";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, date, money, km, centsToInput } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/finance";
import { TitleBadge } from "@/components/finance-ui";
import { Section, Field, Empty, DL } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";
import { registerPayment, billWorkOrderAction, checkOut } from "../actions";
import type { TabProps } from "./types";


export async function TabEntrega({ wo, user, totals }: TabProps) {
  const open = !["CANCELADA", "ENTREGUE"].includes(wo.status);
  const pay = can(user.role, "pagamentos:registrar") && wo.status !== "CANCELADA" && totals.due > 0;
  const bill = can(user.role, "financeiro:lancar") && open && totals.unbilled > 0;
  const deliver = can(user.role, "os:checkout") && ["PRONTO_ENTREGA", "ENCERRADA_SEM_SERVICO"].includes(wo.status);
  const accounts = pay ? await db.financialAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
  const ci = wo.checkIn;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Section title="Valores">
          <DL items={[
            ["Serviços", money(totals.servicesTotal)], ["Peças, consumíveis e terceiros", money(totals.partsTotal)], ["Total da OS", <b key="t">{money(totals.total)}</b>],
            ["Recebido", money(totals.paid)], ["Faturado a receber (títulos em aberto)", money(totals.openTitles)],
            ["Não faturado", <b key="u" className={totals.unbilled > 0 ? "text-warn" : "text-ok"}>{money(totals.unbilled)}</b>],
          ]} />
          <p className="mt-3 text-xs text-muted">Documento fiscal (NFS-e/NF-e): módulo Fiscal previsto para a Fase 4 — ainda não emitido pelo sistema.</p>
        </Section>
        <Section title="Títulos e recebimentos" actions={can(user.role, "financeiro:ver") && <Link href="/financeiro/receber" className="link text-xs">Contas a receber</Link>}>
          {wo.titles.length ? (
            <ul className="divide-y divide-line text-sm">
              {wo.titles.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {can(user.role, "financeiro:ver") ? <Link href={`/financeiro/titulos/${t.id}`} className="link">{t.number}</Link> : <b>{t.number}</b>}
                      {t.installments > 1 && ` (${t.installment}/${t.installments})`} · venc. {date(t.dueDate)}
                    </span>
                    <span className="flex items-center gap-2"><span className="tabular-nums font-medium">{money(t.amount)}</span><TitleBadge status={t.status} dueDate={t.dueDate} /></span>
                  </div>
                  {t.settlements.map((s) => (
                    <div key={s.id} className={`text-xs ${s.reversalOfId ? "text-danger" : "text-muted"}`}>
                      {s.number} · {METHOD_LABEL[s.method] ?? s.method}{s.installments > 1 && ` ${s.installments}x`} · {s.account.name} · {dateTime(s.createdAt)} · {s.userName} · {money(s.amount)}{s.fee ? ` (taxa ${money(s.fee)})` : ""}{s.reversalOfId && ` — estorno: ${s.reason}`}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum título ou recebimento.</Empty>}
          {pay && (
            <ActionForm action={registerPayment} className="mt-4 grid gap-3 sm:grid-cols-2" reset>
              <h3 className="text-sm font-semibold sm:col-span-2">Receber agora</h3>
              <input type="hidden" name="workOrderId" value={wo.id} />
              <Field label="Forma"><select name="method" className="select">{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Conta de destino"><select name="accountId" className="select" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="Valor (R$)"><input name="amount" className="input" inputMode="decimal" defaultValue={centsToInput(totals.due)} required /></Field>
              <Field label="Taxa do cartão/boleto (R$)"><input name="fee" className="input" inputMode="decimal" placeholder="0,00" /></Field>
              <Field label="Parcelas no cartão"><input name="installments" type="number" min={1} max={24} className="input" defaultValue={1} /></Field>
              <Field label="Referência (NSU, E2E PIX…)"><input name="reference" className="input" /></Field>
              <div className="sm:col-span-2"><Submit>Registrar recebimento</Submit></div>
            </ActionForm>
          )}
          {bill && (
            <ActionForm action={billWorkOrderAction} className="mt-4 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-3" confirm="Gerar títulos a receber para o valor não faturado?">
              <h3 className="text-sm font-semibold sm:col-span-3">Faturar a prazo ({money(totals.unbilled)})</h3>
              <input type="hidden" name="workOrderId" value={wo.id} />
              <Field label="Vencimentos (dias)" hint="Ex.: 30 ou 30/60/90"><input name="terms" className="input" defaultValue="30" /></Field>
              <Field label="Forma de cobrança"><select name="method" className="select"><option value="BOLETO">Boleto</option><option value="PIX">PIX</option><option value="TRANSFERENCIA">Transferência</option></select></Field>
              <Field label="Documento"><input name="document" className="input" placeholder="Nº boleto/contrato" /></Field>
              <div className="sm:col-span-3"><Submit className="btn">Gerar títulos a receber</Submit></div>
            </ActionForm>
          )}
        </Section>
      </div>

      <div className="space-y-5">
        {wo.checkOut ? (
          <Section title="Check-out">
            <DL items={[
              ["Data", dateTime(wo.checkOut.createdAt)], ["Km / combustível", `${km(wo.checkOut.km)} · ${wo.checkOut.fuelLevel}%`],
              ["Retirado por", `${wo.checkOut.receivedBy} (${wo.checkOut.receivedByRelation.toLowerCase().replace(/_/g, " ")})`], ["Entregue por", wo.checkOut.deliveredByName],
              ["Estado final", wo.checkOut.finalCondition], ["Recomendações", wo.checkOut.recommendations],
              ["Peças removidas devolvidas", wo.checkOut.removedPartsReturned ? "Sim" : "Não"],
              ["Liberado sem pagamento", wo.checkOut.releasedWithoutPayment ? `Sim — ${wo.checkOut.releaseReason}` : "Não"],
            ]} />
            <p className="mt-3 text-xs text-muted">Assinatura eletrônica · IP {wo.checkOut.signedIp ?? "—"} · SHA-256 <span className="font-mono break-all">{wo.checkOut.contentHash}</span></p>
          </Section>
        ) : deliver ? (
          <Section title="Check-out / entrega">
            <ActionForm action={checkOut} className="space-y-3">
              <input type="hidden" name="workOrderId" value={wo.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Km de saída *"><input name="km" className="input" inputMode="numeric" required defaultValue={ci?.km ?? ""} /></Field>
                <Field label="Combustível / carga (%) *"><input name="fuelLevel" type="number" min={0} max={100} className="input" required defaultValue={ci?.fuelLevel ?? 50} /></Field>
                <Field label="Relação de quem retira"><select name="relation" className="select"><option value="TITULAR">Titular</option><option value="TERCEIRO_AUTORIZADO">Terceiro autorizado</option><option value="MOTORISTA">Motorista</option></select></Field>
                <Field label="Nome de quem retira *"><input name="signedName" className="input" required /></Field>
              </div>
              <Field label="Estado final"><textarea name="finalCondition" className="textarea" defaultValue="Veículo entregue limpo, nas mesmas condições do check-in." /></Field>
              <Field label="Recomendações futuras"><textarea name="recommendations" className="textarea" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removedPartsReturned" /> Peças removidas devolvidas ao cliente</label>
              {totals.unbilled > 0 && (
                <div className="alert alert-warn space-y-2">
                  <p>{money(totals.unbilled)} ainda não recebidos nem faturados.</p>
                  {can(user.role, "os:liberar_sem_pagamento") ? (
                    <>
                      <label className="flex items-center gap-2"><input type="checkbox" name="releaseWithoutPayment" /> Liberar entrega sem pagamento integral</label>
                      <input name="releaseReason" className="input" placeholder="Motivo da liberação" />
                    </>
                  ) : <p>Registre o pagamento ou peça liberação a um gestor.</p>}
                </div>
              )}
              <div><span className="label">Assinatura de quem retira *</span><SignaturePad /></div>
              <Submit>Confirmar entrega</Submit>
            </ActionForm>
          </Section>
        ) : <Empty>O check-out fica disponível quando a OS estiver “Pronta para entrega”.</Empty>}
      </div>
    </div>
  );
}
