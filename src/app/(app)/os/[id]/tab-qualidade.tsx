import { can } from "@/lib/rbac";
import { dateTime } from "@/lib/format";
import { QC_ITEMS } from "@/lib/checklists";
import { Section, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { submitQC } from "../actions";
import type { TabProps } from "./types";

export function TabQualidade({ wo, user }: TabProps) {
  const executed = new Set(wo.timeEntries.map((t) => t.technicianId));
  const allowed = can(user.role, "os:cq") && wo.status === "CONTROLE_QUALIDADE";
  const blocked = allowed && user.role !== "ADMIN" && executed.has(user.id);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Histórico de CQ">
        {wo.qualityChecks.length ? (
          <ol className="space-y-3">
            {wo.qualityChecks.map((q, i) => (
              <li key={q.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex justify-between"><b>Tentativa {i + 1}</b><span className={q.result === "APROVADO" ? "badge badge-ok" : "badge badge-danger"}>{q.result}</span></div>
                <div className="text-xs text-muted">{q.inspectorName} · {dateTime(q.createdAt)}</div>
                {q.notes && <p className="mt-1">{q.notes}</p>}
                <ul className="mt-2 grid gap-0.5 text-xs">
                  {Object.entries(q.checklist as Record<string, boolean>).map(([k, v]) => <li key={k} className={v ? "" : "text-danger"}>{v ? "✓" : "✗"} {k}</li>)}
                </ul>
                {q.testDrive && <p className="mt-1 text-xs">Teste de rodagem: {JSON.stringify(q.testDrive)}</p>}
              </li>
            ))}
          </ol>
        ) : <Empty>Nenhum controle de qualidade realizado.</Empty>}
      </Section>
      {allowed && (
        <Section title="Realizar controle de qualidade">
          {blocked ? <p className="alert alert-warn">Você executou serviços nesta OS. Por segregação de funções, o CQ deve ser feito por outra pessoa.</p> : (
            <ActionForm action={submitQC} className="space-y-3">
              <input type="hidden" name="workOrderId" value={wo.id} />
              <fieldset className="space-y-1.5 text-sm">
                {QC_ITEMS.map((q, i) => <label key={q} className="flex items-start gap-2"><input type="checkbox" name={`qc_${i}`} className="mt-1" /> {q}</label>)}
              </fieldset>
              <details className="rounded-lg border border-line p-3 text-sm">
                <summary className="cursor-pointer font-medium">Teste de rodagem</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="testDrive" /> Houve teste de rodagem</label>
                  <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="tdAuthorized" /> Autorizado pelo cliente (registrado na aprovação)</label>
                  <input name="tdKmOut" className="input" placeholder="Km saída" inputMode="numeric" />
                  <input name="tdKmIn" className="input" placeholder="Km retorno" inputMode="numeric" />
                  <input name="tdDriver" className="input sm:col-span-2" placeholder="Condutor" />
                </div>
              </details>
              {wo.services.length > 0 && (
                <fieldset className="text-sm">
                  <legend className="label">Serviços a refazer (se reprovar)</legend>
                  {wo.services.filter((s) => s.status === "CONCLUIDO").map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="reopen" value={s.id} /> {s.description}</label>)}
                </fieldset>
              )}
              <Field label="Observações / pendências"><textarea name="notes" className="textarea" /></Field>
              <div className="flex gap-2">
                <Submit name="result" value="APROVADO">Aprovar CQ</Submit>
                <Submit name="result" value="REPROVADO" className="btn btn-danger">Reprovar</Submit>
              </div>
            </ActionForm>
          )}
        </Section>
      )}
    </div>
  );
}
