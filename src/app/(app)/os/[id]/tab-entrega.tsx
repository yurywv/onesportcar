import { can } from "@/lib/rbac";
import { dateTime, money, km } from "@/lib/format";
import { Section, Field, Empty, DL } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";
import { registerPayment, reversePayment, checkOut } from "../actions";
import type { TabProps } from "./types";

const METHODS = [["PIX", "PIX"], ["CREDITO", "Cartão de crédito"], ["DEBITO", "Cartão de débito"], ["DINHEIRO", "Dinheiro"], ["TRANSFERENCIA", "Transferência"], ["BOLETO", "Boleto"]];

export function TabEntrega({ wo, user, totals }: TabProps) {
  const pay = can(user.role, "pagamentos:registrar") && !["CANCELADA", "ENTREGUE"].includes(wo.status) && totals.due > 0;
  const deliver = can(user.role, "os:checkout") && ["PRONTO_ENTREGA", "ENCERRADA_SEM_SERVICO"].includes(wo.status);
  const ci = wo.checkIn;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Section title="Valores">
          <DL items={[["Serviços", money(totals.servicesTotal)], ["Peças, consumíveis e terceiros", money(totals.partsTotal)], ["Total da OS", <b key="t">{money(totals.total)}</b>], ["Pago", money(totals.paid)], ["Saldo em aberto", <b key="d" className={totals.due > 0 ? "text-warn" : "text-ok"}>{money(totals.due)}</b>]]} />
          <p className="mt-3 text-xs text-muted">Documento fiscal (NFS-e/NF-e): módulo Fiscal previsto para a Fase 4 — ainda não emitido pelo sistema.</p>
        </Section>
        <Section title="Pagamentos">
          {wo.payments.length ? (
            <ul className="divide-y divide-line text-sm">
              {wo.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><b>{p.number}</b> · {METHODS.find(([k]) => k === p.method)?.[1] ?? p.method}{p.installments > 1 && ` ${p.installments}x`} · {dateTime(p.createdAt)} · {p.userName}</span>
                  <span className="flex items-center gap-2">
                    <span className={`tabular-nums ${p.status === "ESTORNADO" ? "line-through text-muted" : "font-medium"}`}>{money(p.amount)}</span>
                    {p.status === "CONFIRMADO" && can(user.role, "pagamentos:estornar") && wo.status !== "ENTREGUE" && (
                      <details><summary className="btn btn-ghost btn-sm list-none text-danger">Estornar</summary>
                        <ActionForm action={reversePayment} className="mt-1 flex gap-1"><input type="hidden" name="paymentId" value={p.id} /><input name="reason" className="input !min-h-8 text-xs" placeholder="Motivo" required /><Submit className="btn btn-sm">OK</Submit></ActionForm>
                      </details>
                    )}
                  </span>
                  {p.status === "ESTORNADO" && <span className="w-full text-xs text-danger">Estornado: {p.reversedReason}</span>}
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum pagamento.</Empty>}
          {pay && (
            <ActionForm action={registerPayment} className="mt-4 grid gap-3 sm:grid-cols-2" reset>
              <input type="hidden" name="workOrderId" value={wo.id} />
              <Field label="Forma"><select name="method" className="select">{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Valor (R$)"><input name="amount" className="input" inputMode="decimal" defaultValue={(totals.due / 100).toFixed(2).replace(".", ",")} required /></Field>
              <Field label="Parcelas"><input name="installments" type="number" min={1} max={24} className="input" defaultValue={1} /></Field>
              <Field label="Referência (NSU, E2E PIX…)"><input name="reference" className="input" /></Field>
              <div className="sm:col-span-2"><Submit>Registrar pagamento</Submit></div>
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
              {totals.due > 0 && (
                <div className="alert alert-warn space-y-2">
                  <p>Saldo em aberto de {money(totals.due)}.</p>
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
