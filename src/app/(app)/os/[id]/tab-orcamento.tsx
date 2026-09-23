import { can, discountLimit } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, money, minutesLabel } from "@/lib/format";
import { ITEM_CLASS_LABEL, ITEM_TYPE_LABEL, lineTotal, type Snapshot } from "@/lib/estimate";
import { Section, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { createEstimate, addEstimateItem, removeEstimateItem, sendEstimateAction, newApprovalLink, registerApproval } from "../actions";
import type { TabProps } from "./types";

const CLASSES = Object.entries(ITEM_CLASS_LABEL);

export async function TabOrcamento({ wo, user }: TabProps) {
  const edit = can(user.role, "orcamento:editar");
  const costs = can(user.role, "orcamento:ver_custos");
  const [services, stock] = edit ? await Promise.all([
    db.serviceCatalog.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.inventoryItem.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]) : [[], []];
  const hasDraft = wo.estimates.some((e) => e.status === "RASCUNHO");
  const canCreate = edit && !hasDraft && (wo.estimates.length ? ["EM_EXECUCAO", "AGUARDANDO_PECAS"].includes(wo.status) : wo.status === "ORCAMENTO");
  const limit = discountLimit(user.role);
  const recommended = wo.inspections.flatMap((i) => i.items).filter((i) => i.status === "RECOMENDADO" || i.status === "URGENTE");

  return (
    <div className="space-y-5">
      {!wo.estimates.length && <Empty>{wo.status === "ORCAMENTO" ? "Nenhum orçamento ainda." : "O orçamento é criado após o diagnóstico (status “Orçamento”)."}</Empty>}
      {canCreate && (
        <ActionForm action={createEstimate}>
          <input type="hidden" name="workOrderId" value={wo.id} />
          <Submit>{wo.estimates.length ? "Novo orçamento complementar" : "Criar orçamento"}</Submit>
        </ActionForm>
      )}

      {wo.estimates.map((est) => {
        const draftTotal = est.items.reduce((s, i) => s + lineTotal(i), 0);
        const latest = est.versions[0];
        const editable = edit && est.status !== "RESPONDIDO";
        return (
          <Section
            key={est.id}
            title={`${est.number} · ${est.kind === "COMPLEMENTAR" ? "Complementar" : "Inicial"}`}
            actions={<span className={est.status === "RESPONDIDO" ? "badge badge-ok" : est.status === "ENVIADO" ? "badge badge-warn" : "badge"}>{est.status === "RASCUNHO" ? "Rascunho" : est.status === "ENVIADO" ? `Enviado v${latest?.version} — aguardando cliente` : "Respondido"}</span>}
          >
            {editable && (
              <>
                <h3 className="mb-2 text-sm font-semibold">Itens {latest ? `(rascunho da versão ${latest.version + 1})` : ""}</h3>
                {est.items.length ? (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>Item</th><th>Classe</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Desconto</th><th className="text-right">Total</th>{costs && <th className="text-right">Custo</th>}<th /></tr></thead>
                      <tbody>
                        {est.items.map((i) => (
                          <tr key={i.id}>
                            <td><span className="text-xs text-muted">{ITEM_TYPE_LABEL[i.type]}</span><div>{i.description}{i.minutes ? <span className="text-xs text-muted"> · {minutesLabel(i.minutes)}</span> : null}</div></td>
                            <td className="text-xs">{ITEM_CLASS_LABEL[i.classification]}</td>
                            <td className="text-right tabular-nums">{i.quantity}</td>
                            <td className="text-right tabular-nums">{money(i.unitPrice)}</td>
                            <td className="text-right tabular-nums">{i.discount ? `−${money(i.discount)}` : "—"}</td>
                            <td className="text-right font-medium tabular-nums">{money(lineTotal(i))}</td>
                            {costs && <td className="text-right text-xs text-muted tabular-nums">{money(Math.round(i.unitCost * i.quantity))}</td>}
                            <td><ActionForm action={removeEstimateItem}><input type="hidden" name="itemId" value={i.id} /><Submit className="btn btn-ghost btn-sm text-danger">remover</Submit></ActionForm></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><td colSpan={5} className="text-right font-semibold">Total do rascunho</td><td className="text-right font-semibold tabular-nums">{money(draftTotal)}</td><td colSpan={costs ? 2 : 1} /></tr></tfoot>
                    </table>
                  </div>
                ) : <Empty>Adicione itens abaixo.</Empty>}

                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <ActionForm action={addEstimateItem} className="space-y-2 rounded-lg border border-line p-3" reset>
                    <h4 className="text-sm font-semibold">Serviço do catálogo</h4>
                    <input type="hidden" name="estimateId" value={est.id} /><input type="hidden" name="source" value="service" />
                    <select name="serviceId" className="select" required defaultValue=""><option value="">Selecione…</option>{services.map((s) => <option key={s.id} value={s.id}>{s.category} · {s.name} ({minutesLabel(s.standardMin)} · {money(s.fixedPrice ?? Math.round(s.standardMin / 60 * s.hourlyRate))})</option>)}</select>
                    <div className="grid grid-cols-3 gap-2">
                      <input name="minutes" className="input" placeholder="Min" inputMode="numeric" title="Tempo vendido (min); vazio = padrão" />
                      <input name="discountPct" className="input" placeholder={`Desc. % (≤${limit})`} inputMode="decimal" />
                      <select name="classification" className="select">{CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    </div>
                    <Submit className="btn w-full">Adicionar serviço</Submit>
                  </ActionForm>
                  <ActionForm action={addEstimateItem} className="space-y-2 rounded-lg border border-line p-3" reset>
                    <h4 className="text-sm font-semibold">Peça / consumível do estoque</h4>
                    <input type="hidden" name="estimateId" value={est.id} /><input type="hidden" name="source" value="stock" />
                    <select name="inventoryItemId" className="select" required defaultValue=""><option value="">Selecione…</option>{stock.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name} — {money(s.price)} (saldo {s.onHand})</option>)}</select>
                    <div className="grid grid-cols-3 gap-2">
                      <input name="quantity" className="input" placeholder="Qtd" defaultValue="1" inputMode="decimal" />
                      <input name="discountPct" className="input" placeholder={`Desc. % (≤${limit})`} inputMode="decimal" />
                      <select name="classification" className="select">{CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    </div>
                    <Submit className="btn w-full">Adicionar peça</Submit>
                  </ActionForm>
                  <ActionForm action={addEstimateItem} className="space-y-2 rounded-lg border border-line p-3" reset>
                    <h4 className="text-sm font-semibold">Item avulso (terceiro, taxa, peça sob encomenda)</h4>
                    <input type="hidden" name="estimateId" value={est.id} /><input type="hidden" name="source" value="manual" />
                    <input name="description" className="input" placeholder="Descrição" required list={`rec-${est.id}`} />
                    <datalist id={`rec-${est.id}`}>{recommended.map((r) => <option key={r.id} value={`${r.group}: ${r.label}${r.note ? ` — ${r.note}` : ""}`} />)}</datalist>
                    <div className="grid grid-cols-2 gap-2">
                      <select name="type" className="select">{Object.entries(ITEM_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <select name="classification" className="select">{CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <input name="quantity" className="input" placeholder="Qtd" defaultValue="1" inputMode="decimal" />
                      <input name="unitPrice" className="input" placeholder="Preço unit. (R$)" inputMode="decimal" required />
                      <input name="unitCost" className="input" placeholder="Custo unit. (R$)" inputMode="decimal" />
                      <input name="discountPct" className="input" placeholder={`Desc. % (≤${limit})`} inputMode="decimal" />
                    </div>
                    <Submit className="btn w-full">Adicionar item</Submit>
                  </ActionForm>
                </div>
                {est.items.length > 0 && (
                  <ActionForm action={sendEstimateAction} className="mt-4" confirm="Enviar ao cliente? A versão será congelada e não poderá ser alterada.">
                    <input type="hidden" name="estimateId" value={est.id} />
                    <Submit>{latest ? `Enviar nova versão (v${latest.version + 1})` : "Enviar ao cliente"}</Submit>
                  </ActionForm>
                )}
              </>
            )}

            {est.versions.map((v) => <VersionView key={v.id} v={v} pending={est.status === "ENVIADO" && v.id === latest?.id} user={user} costs={costs} />)}
          </Section>
        );
      })}
    </div>
  );
}

type Version = TabProps["wo"]["estimates"][number]["versions"][number];

function VersionView({ v, pending, user, costs }: { v: Version; pending: boolean; user: TabProps["user"]; costs: boolean }) {
  const snap = v.snapshot as unknown as Snapshot;
  const decision = new Map(v.approvals.map((a) => [a.itemId, a]));
  const link = v.links[0];
  const canRegister = pending && can(user.role, "orcamento:registrar_aprovacao");
  const cost = snap.items.reduce((s, i) => s + Math.round(i.unitCost * i.quantity), 0);
  return (
    <div className="mt-5 rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2 text-sm">
        <span><b>Versão {v.version}</b> · enviada por {v.sentByName} em {dateTime(v.sentAt)}</span>
        <span className="flex items-center gap-3">
          <span className="font-semibold tabular-nums">{money(v.total)}</span>
          <span className="font-mono text-[10px] text-muted" title="SHA-256 do conteúdo congelado">#{v.contentHash.slice(0, 10)}</span>
        </span>
      </div>
      <ActionForm action={registerApproval} className="p-3">
        <input type="hidden" name="versionId" value={v.id} />
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Item</th><th>Classe</th><th className="text-right">Total</th><th>Decisão</th></tr></thead>
            <tbody>
              {snap.items.map((i) => {
                const d = decision.get(i.id);
                return (
                  <tr key={i.id}>
                    <td>{i.quantity !== 1 && `${i.quantity}× `}{i.description}{i.discount > 0 && <span className="text-xs text-muted"> (desc. {money(i.discount)})</span>}</td>
                    <td className="text-xs">{ITEM_CLASS_LABEL[i.classification]}</td>
                    <td className="text-right tabular-nums">{money(i.total)}</td>
                    <td>
                      {d ? <span className={d.decision === "APROVADO" ? "badge badge-ok" : "badge badge-danger"}>{d.decision === "APROVADO" ? "Aprovado" : "Recusado"}</span>
                        : canRegister ? (
                          <select name={`d_${i.id}`} className="select !min-h-8" defaultValue={i.classification === "OPCIONAL" ? "RECUSADO" : "APROVADO"}>
                            <option value="APROVADO">Aprovar</option><option value="RECUSADO">Recusar</option>
                          </select>
                        ) : <span className="badge">Pendente</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {costs && <p className="mt-2 text-xs text-muted">Custo estimado {money(cost)} · margem estimada {money(v.total - cost)}{v.total ? ` (${(((v.total - cost) / v.total) * 100).toFixed(1)}%)` : ""}</p>}
        {v.approvals.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Resposta de <b className="text-fg">{v.approvals[0].approverName}</b> via {v.approvals[0].channel.toLowerCase()} em {dateTime(v.approvals[0].createdAt)}
            {v.approvals[0].ip && ` · IP ${v.approvals[0].ip}`}{v.approvals[0].evidence && ` · evidência: ${v.approvals[0].evidence}`}
            {v.approvals[0].removedPartsDestination && ` · peças removidas: ${v.approvals[0].removedPartsDestination.toLowerCase()}`}
          </p>
        )}
        {canRegister && (
          <div className="mt-3 grid gap-3 rounded-lg bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Aprovado por *"><input name="approverName" className="input" required /></Field>
            <Field label="Canal"><select name="channel" className="select"><option value="PRESENCIAL">Presencial</option><option value="TELEFONE">Telefone</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option></select></Field>
            <Field label="Peças removidas"><select name="removedParts" className="select"><option value="DEVOLVER">Devolver ao cliente</option><option value="DESCARTAR">Descartar</option></select></Field>
            <Field label="Evidência (obrigatória se remoto)"><input name="evidence" className="input" placeholder="Ex.: ligação 14:32, print WhatsApp" /></Field>
            <div className="sm:col-span-2 lg:col-span-4"><Submit>Registrar resposta do cliente</Submit></div>
          </div>
        )}
      </ActionForm>
      {pending && can(user.role, "orcamento:editar") && (
        <div className="border-t border-line p-3 text-sm">
          <span className="text-muted">Link de aprovação: {link ? (link.revokedAt ? "revogado" : `válido até ${dateTime(link.expiresAt)}${link.openedAt ? ` · aberto pelo cliente em ${dateTime(link.openedAt)}` : " · ainda não aberto"}`) : "—"}</span>
          <ActionForm action={newApprovalLink} className="mt-2"><input type="hidden" name="versionId" value={v.id} /><Submit className="btn btn-sm">Gerar novo link</Submit></ActionForm>
        </div>
      )}
    </div>
  );
}
