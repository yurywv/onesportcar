import { can } from "@/lib/rbac";
import { dateTime, minutesLabel, money } from "@/lib/format";
import { entryMinutes } from "@/lib/wo";
import { Section, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { timerAction, partAction } from "../actions";
import type { TabProps } from "./types";

const SVC_TONE: Record<string, string> = { PENDENTE: "badge", EM_EXECUCAO: "badge badge-info", PAUSADO: "badge badge-warn", CONCLUIDO: "badge badge-ok", CANCELADO: "badge badge-danger" };
const SVC_TXT: Record<string, string> = { PENDENTE: "Pendente", EM_EXECUCAO: "Em execução", PAUSADO: "Pausado", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };
const PART_TONE: Record<string, string> = { RESERVADA: "badge badge-info", AGUARDANDO_COMPRA: "badge badge-warn", APLICADA: "badge badge-ok", DEVOLVIDA: "badge", CANCELADA: "badge badge-danger" };
const PART_TXT: Record<string, string> = { RESERVADA: "Reservada", AGUARDANDO_COMPRA: "Aguardando compra", APLICADA: "Aplicada", DEVOLVIDA: "Devolvida", CANCELADA: "Cancelada" };

export function TabExecucao({ wo, user, names, showMoney }: TabProps) {
  const exec = can(user.role, "os:executar");
  const stock = can(user.role, "estoque:requisitar");
  const running = wo.status === "EM_EXECUCAO";
  return (
    <div className="space-y-5">
      {!["EM_EXECUCAO", "AGUARDANDO_PECAS", "CONTROLE_QUALIDADE", "PREPARACAO", "PRONTO_ENTREGA", "ENTREGUE"].includes(wo.status) && (
        <p className="alert alert-info">A execução começa após a aprovação do orçamento.</p>
      )}
      {wo.status === "AGUARDANDO_PECAS" && <p className="alert alert-warn">OS aguardando peças. Quando o estoque receber, a peça é reservada automaticamente; depois mova a OS para “Em execução”.</p>}

      <Section title="Serviços">
        {wo.services.length ? (
          <div className="space-y-3">
            {wo.services.map((s) => {
              const worked = s.timeEntries.reduce((a, t) => a + entryMinutes(t), 0);
              const mine = s.timeEntries.find((t) => !t.endedAt && t.technicianId === user.id);
              const others = s.timeEntries.filter((t) => !t.endedAt && t.technicianId !== user.id);
              return (
                <div key={s.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{s.description}</div>
                      <div className="text-xs text-muted">
                        vendido {minutesLabel(s.soldMin)} · trabalhado {minutesLabel(worked)}
                        {s.technicianId && ` · ${names.get(s.technicianId) ?? ""}`}
                        {showMoney && ` · ${money(s.price)}`}
                        {others.length > 0 && ` · em andamento por ${others.map((o) => o.technicianName).join(", ")}`}
                      </div>
                    </div>
                    <span className={SVC_TONE[s.status]}>{SVC_TXT[s.status]}</span>
                  </div>
                  {exec && running && s.status !== "CONCLUIDO" && s.status !== "CANCELADO" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {mine ? (
                        <>
                          {(["pause", "parts", "finish"] as const).map((op) => (
                            <ActionForm key={op} action={timerAction}>
                              <input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="op" value={op} />
                              <Submit className={op === "finish" ? "btn btn-primary" : "btn"}>{op === "pause" ? "Pausar" : op === "parts" ? "Aguardando peça" : "Finalizar"}</Submit>
                            </ActionForm>
                          ))}
                          <span className="self-center text-xs text-ok">● em andamento desde {dateTime(mine.startedAt)}</span>
                        </>
                      ) : (
                        <>
                          <ActionForm action={timerAction}><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="op" value="start" /><Submit className="btn btn-primary">{s.status === "PAUSADO" ? "Retomar" : "Iniciar"}</Submit></ActionForm>
                          {s.timeEntries.length > 0 && !others.length && (
                            <ActionForm action={timerAction}><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="op" value="finish" /><Submit className="btn">Finalizar</Submit></ActionForm>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {s.timeEntries.length > 0 && (
                    <details className="mt-2 text-xs text-muted">
                      <summary className="cursor-pointer">{s.timeEntries.length} apontamento(s)</summary>
                      <ul className="mt-1 space-y-0.5">{s.timeEntries.map((t) => <li key={t.id}>{t.technicianName}: {dateTime(t.startedAt)} → {t.endedAt ? dateTime(t.endedAt) : "em andamento"} ({minutesLabel(entryMinutes(t))}){t.endReason && ` · ${t.endReason.toLowerCase()}`}</li>)}</ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        ) : <Empty>Nenhum serviço aprovado ainda.</Empty>}
      </Section>

      <Section title="Peças, consumíveis e terceiros">
        {wo.parts.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Item</th><th className="text-right">Qtd</th><th>Origem</th><th>Status</th>{showMoney && <th className="text-right">Valor</th>}<th /></tr></thead>
              <tbody>
                {wo.parts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.description}</td>
                    <td className="text-right tabular-nums">{p.quantity} {p.inventoryItem?.unit}</td>
                    <td className="text-xs">{p.inventoryItem ? `${p.inventoryItem.sku} · ${p.inventoryItem.location ?? ""}` : p.type === "TERCEIRO" ? "Terceiro" : p.type === "TAXA" ? "Taxa" : "Sem cadastro"}</td>
                    <td><span className={PART_TONE[p.status] ?? "badge"}>{PART_TXT[p.status] ?? p.status}</span>{p.appliedAt && <div className="text-[11px] text-muted">{dateTime(p.appliedAt)}</div>}</td>
                    {showMoney && <td className="text-right tabular-nums">{money(p.price)}</td>}
                    <td>
                      {stock && p.status === "RESERVADA" && p.inventoryItemId && ["EM_EXECUCAO", "AGUARDANDO_PECAS"].includes(wo.status) && (
                        <ActionForm action={partAction}><input type="hidden" name="partId" value={p.id} /><input type="hidden" name="op" value="apply" /><Submit className="btn btn-sm">Retirar do estoque</Submit></ActionForm>
                      )}
                      {stock && p.status === "APLICADA" && p.inventoryItemId && !["ENTREGUE", "CANCELADA"].includes(wo.status) && (
                        <details>
                          <summary className="btn btn-ghost btn-sm list-none">Devolver</summary>
                          <ActionForm action={partAction} className="mt-1 flex gap-1">
                            <input type="hidden" name="partId" value={p.id} /><input type="hidden" name="op" value="return" />
                            <input name="reason" className="input !min-h-8 text-xs" placeholder="Motivo" required />
                            <Submit className="btn btn-sm">OK</Submit>
                          </ActionForm>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nenhuma peça aprovada.</Empty>}
      </Section>
    </div>
  );
}
