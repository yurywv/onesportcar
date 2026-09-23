import { can } from "@/lib/rbac";
import { dateTime } from "@/lib/format";
import { INSPECTION_TEMPLATES } from "@/lib/checklists";
import { Section, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { startInspection, saveInspection, saveDiagnostic } from "../actions";
import type { TabProps } from "./types";

const ST = [["OK", "OK"], ["ATENCAO", "Atenção"], ["RECOMENDADO", "Recomendado"], ["URGENTE", "Urgente"], ["NA", "N/A"]];
const TONE: Record<string, string> = { OK: "badge badge-ok", ATENCAO: "badge badge-warn", RECOMENDADO: "badge badge-accent", URGENTE: "badge badge-danger", NA: "badge" };

export function TabDiagnostico({ wo, user }: TabProps) {
  const canDo = can(user.role, "os:diagnosticar");
  const openStage = ["AGUARDANDO_DIAGNOSTICO", "EM_DIAGNOSTICO", "EM_EXECUCAO", "AGUARDANDO_PECAS"].includes(wo.status);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        {wo.inspections.map((insp) => (
          <Section key={insp.id} title={`Checklist — ${insp.template}`} actions={insp.finishedAt ? <span className="badge badge-ok">Finalizado</span> : <span className="badge">Em andamento</span>}>
            {insp.finishedAt || !canDo ? (
              <ul className="divide-y divide-line text-sm">
                {insp.items.map((it) => (
                  <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span><span className="text-muted">{it.group} ·</span> {it.label}{it.measurement && <b> — {it.measurement}</b>}{it.note && <span className="text-muted"> ({it.note})</span>}</span>
                    <span className={TONE[it.status]}>{ST.find(([k]) => k === it.status)?.[1]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ActionForm action={saveInspection} className="space-y-1">
                <input type="hidden" name="inspectionId" value={insp.id} />
                {insp.items.map((it, i) => (
                  <div key={it.id}>
                    {it.group !== insp.items[i - 1]?.group && <h3 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{it.group}</h3>}
                    <div className="grid grid-cols-1 items-center gap-2 border-b border-line py-1.5 sm:grid-cols-[1fr_130px_110px_1fr]">
                      <span className="text-sm">{it.label}</span>
                      <select name={`s_${it.id}`} defaultValue={it.status} className="select !min-h-9">{ST.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <input name={`m_${it.id}`} defaultValue={it.measurement ?? ""} className="input !min-h-9" placeholder="Medição" />
                      <input name={`n_${it.id}`} defaultValue={it.note ?? ""} className="input !min-h-9" placeholder="Observação" />
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 pt-3">
                  <Submit className="btn">Salvar</Submit>
                  <Submit className="btn btn-primary" name="finish" value="1">Finalizar checklist</Submit>
                </div>
              </ActionForm>
            )}
          </Section>
        ))}
        {canDo && openStage && (
          <Section title="Novo checklist">
            <ActionForm action={startInspection} className="flex gap-2">
              <input type="hidden" name="workOrderId" value={wo.id} />
              <select name="template" className="select">{Object.keys(INSPECTION_TEMPLATES).map((t) => <option key={t}>{t}</option>)}</select>
              <Submit className="btn">Iniciar</Submit>
            </ActionForm>
          </Section>
        )}
        {!wo.inspections.length && !(canDo && openStage) && <Empty>Nenhum checklist registrado.</Empty>}
      </div>

      <div className="space-y-5">
        {wo.diagnostics.map((d) => (
          <Section key={d.id} title={`Diagnóstico — ${d.technicianName}`} actions={<span className="text-xs text-muted">{dateTime(d.finishedAt ?? d.startedAt)}</span>}>
            <dl className="space-y-2 text-sm">
              {([["Diagnóstico", d.diagnosis], ["Testes realizados", d.tests], ["Códigos de falha", d.faultCodes], ["Ferramenta / sessão", d.scanTool], ["Causa provável", d.probableCause], ["Solução recomendada", d.solution]] as const).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>
              ))}
            </dl>
          </Section>
        ))}
        {canDo && openStage ? (
          <Section title="Registrar diagnóstico">
            {wo.status === "AGUARDANDO_DIAGNOSTICO" && <p className="alert alert-info mb-3">Ao salvar, a OS passa para “Em diagnóstico”{wo.technicianId ? "" : " e você é atribuído como técnico"}.</p>}
            <ActionForm action={saveDiagnostic} className="space-y-3" reset>
              <input type="hidden" name="workOrderId" value={wo.id} />
              <Field label="Reclamação do cliente"><p className="rounded-lg bg-surface-2 p-2 text-sm">{wo.complaint}</p></Field>
              <Field label="Testes realizados"><textarea name="tests" className="textarea" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Códigos de falha"><textarea name="faultCodes" className="textarea" placeholder="Código · sistema · status" /></Field>
                <Field label="Ferramenta de diagnóstico / sessão"><textarea name="scanTool" className="textarea" placeholder="Ferramenta, versão, atualizações/codificações" /></Field>
              </div>
              <Field label="Diagnóstico *"><textarea name="diagnosis" className="textarea" required /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Causa provável"><textarea name="probableCause" className="textarea" /></Field>
                <Field label="Solução recomendada"><textarea name="solution" className="textarea" /></Field>
              </div>
              {["AGUARDANDO_DIAGNOSTICO", "EM_DIAGNOSTICO"].includes(wo.status) && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="toEstimate" defaultChecked /> Diagnóstico concluído — enviar OS para orçamento</label>
              )}
              <Submit>Salvar diagnóstico</Submit>
            </ActionForm>
          </Section>
        ) : !wo.diagnostics.length && <Empty>Nenhum diagnóstico registrado.</Empty>}
      </div>
    </div>
  );
}
