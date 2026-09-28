import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { ENTITY_LABEL, FIELDS, type ImportEntity } from "@/lib/import-fields";
import { PageHeader, Section, Stat, Empty, Pager } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { ImportRunner } from "@/components/import-runner";
import { discardJob } from "../actions";
import { JOB_STATUS } from "../status";

const ROW_TONE: Record<string, string> = { VALIDO: "badge badge-info", DUPLICADO: "badge badge-warn", INVALIDO: "badge badge-danger", IMPORTADO: "badge badge-ok", ERRO: "badge badge-danger", REVERTIDO: "badge", MANTIDO: "badge badge-warn" };
const PAGE = 100;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const job = await db.importJob.findUnique({ where: { id: (await params).id }, select: { entity: true } });
  return { title: job ? `Importação de ${ENTITY_LABEL[job.entity as ImportEntity].toLowerCase()}` : "Importação" };
}

function preview(entity: ImportEntity, d: Record<string, unknown>) {
  const pick: Record<ImportEntity, string[]> = {
    CLIENTES: ["name", "document", "city"], FORNECEDORES: ["name", "document", "city"], VEICULOS: ["plate", "make", "model", "ownerName"],
    ITENS: ["sku", "name", "onHand"], OS: ["legacyNumber", "plate", "openedAt"],
  };
  return pick[entity].map((k) => d[k]).filter((v) => v !== null && v !== undefined && v !== "").map((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : String(v))).join(" · ");
}

export default async function ImportJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; p?: string }> }) {
  await requireUser("admin:importar");
  const { id } = await params;
  const sp = await searchParams;
  const job = await db.importJob.findUnique({ where: { id } });
  if (!job) notFound();
  const entity = job.entity as ImportEntity;
  const grouped = await db.importRow.groupBy({ by: ["status"], where: { jobId: id }, _count: true });
  const n = (s: string) => grouped.find((g) => g.status === s)?._count ?? 0;
  const status = sp.status ?? (job.status === "VALIDADO" ? "problemas" : "todos");
  const page = Math.max(1, Number(sp.p) || 1);
  const where = { jobId: id, ...(status === "problemas" ? { status: { in: ["INVALIDO", "DUPLICADO", "ERRO", "MANTIDO"] } } : status !== "todos" ? { status } : {}) };
  const [rows, total] = await Promise.all([db.importRow.findMany({ where, orderBy: { rowNumber: "asc" }, skip: (page - 1) * PAGE, take: PAGE }), db.importRow.count({ where })]);
  const mapping = job.mapping as Record<string, string>;
  const tabs: [string, string, number][] = [["problemas", "Com problema", n("INVALIDO") + n("DUPLICADO") + n("ERRO") + n("MANTIDO")], ["VALIDO", "Válidos", n("VALIDO")], ["IMPORTADO", "Importados", n("IMPORTADO")], ["todos", "Todos", job.totalRows]];

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Importação de {ENTITY_LABEL[entity].toLowerCase()} <span className={JOB_STATUS[job.status]?.[1] ?? "badge"}>{JOB_STATUS[job.status]?.[0] ?? job.status}</span></span>}
        subtitle={<>{job.fileName}{job.sheetName && ` · aba ${job.sheetName}`} · {job.userName} · {dateTime(job.createdAt)}{job.importedAt && ` · importado em ${dateTime(job.importedAt)}`}</>}
        back={<Link href="/admin/importacao" className="link text-xs">← Importações</Link>}
        actions={<a href={`/admin/importacao/${job.id}/problemas.csv`} className="btn">Baixar problemas (CSV)</a>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Linhas lidas" value={job.totalRows} />
        <Stat label="Válidos a importar" value={n("VALIDO")} tone={n("VALIDO") ? "ok" : undefined} />
        <Stat label="Importados" value={n("IMPORTADO")} tone={n("IMPORTADO") ? "ok" : undefined} />
        <Stat label="Duplicados (ignorados)" value={n("DUPLICADO")} tone={n("DUPLICADO") ? "warn" : undefined} />
        <Stat label="Inválidos / erro" value={n("INVALIDO") + n("ERRO")} tone={n("INVALIDO") + n("ERRO") ? "danger" : "ok"} />
      </div>

      {job.status === "VALIDANDO" && <p className="alert alert-warn mb-4">A validação deste lote foi interrompida antes do fim. Descarte-o e envie o arquivo novamente.</p>}
      {(job.status === "VALIDADO" || job.status === "IMPORTANDO") && (
        <Section title="Confirmar importação" className="mb-5">
          <p className="mb-3 text-sm">Serão criados <b>{n("VALIDO")}</b> registro(s). Duplicados e inválidos <b>não</b> entram — corrija no SYSCAR e importe um novo arquivo (o que já entrou é reconhecido como duplicado).{entity === "ITENS" && " Saldos entram como movimento de inventário ao custo informado."}{entity === "OS" && " As OS entram como histórico somente leitura, sem efeito em estoque ou financeiro."}</p>
          <div className="flex flex-wrap items-start gap-3">
            <ImportRunner jobId={job.id} mode="import" pending={n("VALIDO")} label={`Importar ${n("VALIDO")} registro(s)`} />
            {job.status === "VALIDADO" && <ActionForm action={discardJob} confirm="Descartar este lote?"><input type="hidden" name="jobId" value={job.id} /><Submit className="btn">Descartar lote</Submit></ActionForm>}
          </div>
        </Section>
      )}
      {job.status === "VALIDANDO" && <ActionForm action={discardJob} className="mb-5"><input type="hidden" name="jobId" value={job.id} /><Submit className="btn">Descartar lote</Submit></ActionForm>}
      {job.status === "IMPORTADO" && (
        <Section title="Reverter" className="mb-5">
          <p className="mb-3 text-sm text-muted">Remove os registros deste lote que ainda não foram usados (sem OS, títulos, pedidos ou movimentações). Os demais são mantidos, com o motivo.</p>
          <ImportRunner jobId={job.id} mode="revert" pending={n("IMPORTADO")} label="Reverter importação" />
        </Section>
      )}

      <details className="card mb-5">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Mapeamento de colunas usado</summary>
        <ul className="grid gap-1 border-t border-line p-4 text-sm sm:grid-cols-2">
          {FIELDS[entity].filter((f) => mapping[f.key]).map((f) => <li key={f.key}><span className="text-muted">{f.label}</span> ← “{mapping[f.key]}”</li>)}
        </ul>
      </details>

      <nav className="mb-3 flex flex-wrap gap-1">
        {tabs.map(([k, l, c]) => <Link key={k} href={`?status=${k}`} className={`btn btn-sm ${status === k ? "btn-primary" : ""}`}>{l} ({c})</Link>)}
      </nav>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Linha</th><th>Situação</th><th>Registro</th><th>Mensagens</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="tabular-nums">{r.rowNumber}</td>
                  <td><span className={ROW_TONE[r.status] ?? "badge"}>{r.status}</span></td>
                  <td className="max-w-80 text-sm">{preview(entity, r.data as Record<string, unknown>)}</td>
                  <td className="text-xs">{r.messages.length ? <ul className="space-y-0.5">{r.messages.map((m, i) => <li key={i} className={m.startsWith("Aviso:") ? "text-warn" : "text-danger"}>{m}</li>)}</ul> : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhuma linha nesta situação.</Empty>}
      <Pager page={page} total={total} size={PAGE} params={{ status }} />
    </>
  );
}
