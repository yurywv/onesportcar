import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { FISCAL_STATUS_LABEL, fiscalReadiness } from "@/lib/fiscal";
import { Section, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { FiscalActions } from "../../fiscal/fiscal-actions";
import { prepareFiscalAction } from "../../fiscal/actions";
import type { TabProps } from "./types";

export async function TabFiscal({ wo, user }: TabProps) {
  const emit = can(user.role, "fiscal:emitir");
  const [docs, ready] = await Promise.all([
    db.fiscalDocument.findMany({ where: { workOrderId: wo.id }, orderBy: { createdAt: "desc" } }),
    fiscalReadiness(wo.id),
  ]);
  const blocks = (kind: "NFSE" | "NFE") => docs.some((d) => d.kind === kind && ["PROCESSANDO", "AUTORIZADA"].includes(d.status));
  const draft = (kind: "NFSE" | "NFE") => docs.some((d) => d.kind === kind && ["RASCUNHO", "REJEITADA", "ERRO"].includes(d.status));
  const card = (kind: "NFSE" | "NFE", title: string, r: (typeof ready)["NFSE"]) => (
    <Section title={title}>
      <p className="text-sm">{r.lines} item(ns) · <b>{money(r.total)}</b></p>
      {r.problems.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-danger">{r.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {r.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-warn">{r.warnings.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {emit && r.lines > 0 && !blocks(kind) && !draft(kind) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionForm action={prepareFiscalAction}><input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="kind" value={kind} /><Submit className="btn">Gerar prévia</Submit></ActionForm>
          {r.problems.length === 0 && (
            <ActionForm action={prepareFiscalAction} confirm={`Emitir a ${kind === "NFSE" ? "NFS-e" : "NF-e"} de ${money(r.total)}?`}>
              <input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="send" value="1" />
              <Submit>Emitir {kind === "NFSE" ? "NFS-e" : "NF-e"}</Submit>
            </ActionForm>
          )}
        </div>
      )}
      {blocks(kind) && <p className="mt-2 text-xs text-muted">Já existe nota {kind === "NFSE" ? "de serviço" : "de produto"} transmitida para esta OS. Para refazer, cancele a atual.</p>}
    </Section>
  );
  return (
    <div className="space-y-5">
      {!ready.settings && <p className="alert alert-warn">Configure o emitente fiscal antes de emitir notas.</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {card("NFSE", "NFS-e — serviços (Prefeitura de Campinas)", ready.NFSE)}
        {card("NFE", "NF-e — produtos", ready.NFE)}
      </div>
      <Section title="Notas desta OS">
        {docs.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Tipo</th><th>Número</th><th className="text-right">Valor</th><th>Status</th><th>Data</th><th /></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.kind === "NFSE" ? "NFS-e" : "NF-e"}{d.environment === "HOMOLOGACAO" && <span className="text-xs text-muted"> (homologação)</span>}</td>
                    <td>{d.number ? `${d.number}${d.series ? `/${d.series}` : ""}` : d.rpsNumber ? `DPS ${d.rpsNumber}` : "—"}{d.accessKey && <div className="font-mono text-[10px] text-muted break-all">{d.accessKey}</div>}</td>
                    <td className="text-right tabular-nums">{money(d.total)}</td>
                    <td>{FISCAL_STATUS_LABEL[d.status]}{d.message && <div className="max-w-72 text-xs text-muted">{d.message}</div>}</td>
                    <td className="text-xs">{dateTime(d.issuedAt ?? d.createdAt)}</td>
                    <td><FiscalActions doc={d} canEmit={emit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nenhuma nota emitida para esta OS.</Empty>}
        {docs.some((d) => d.status === "RASCUNHO") && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted">Ver dados que serão enviados (prévia)</summary>
            {docs.filter((d) => d.status === "RASCUNHO").map((d) => <pre key={d.id} className="mt-2 max-h-96 overflow-auto rounded bg-surface-2 p-3">{JSON.stringify(d.payload, null, 2)}</pre>)}
          </details>
        )}
      </Section>
    </div>
  );
}
