"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ENTITY_HELP, ENTITY_LABEL, ENTITY_ORDER, FIELDS, normHeader, suggestMapping, type ImportEntity } from "@/lib/import-fields";
import { createImportJob, stageImportRows, finishValidation } from "@/app/(app)/admin/importacao/actions";

type Sheet = { name: string; rows: string[][] };
const BATCH = 250;

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return String(v).replace(/\s+/g, " ").trim();
}

/** Linha de cabeçalho provável: a que mais casa com os sinônimos dos campos, entre as 20 primeiras. */
function detectHeader(rows: string[][], entity: ImportEntity) {
  const syn = FIELDS[entity].flatMap((f) => f.synonyms);
  let best = 0, bestScore = -1;
  rows.slice(0, 20).forEach((r, i) => {
    const cells = r.map((c) => normHeader(c)).filter(Boolean);
    const score = cells.filter((c) => syn.some((s) => c === s || (s.length >= 3 && c.includes(s)))).length * 10 + (cells.length >= 3 ? cells.length : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

async function readFile(file: File): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.(csv|txt)$/i.test(file.name)) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("windows-1252").decode(buf); }
    wb = XLSX.read(text, { type: "string", raw: true });
  } else {
    wb = XLSX.read(buf, { type: "array", cellDates: true });
  }
  return wb.SheetNames.map((name) => {
    // blankrows: true mantém a numeração igual à da planilha (as mensagens de erro citam a linha)
    const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "", blankrows: true });
    return { name, rows: data.map((r) => r.map(cellToString)) };
  });
}

export function Importer({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const [entity, setEntity] = useState<ImportEntity>("CLIENTES");
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number; valid: number; dup: number; invalid: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sheet = sheets[sheetIdx];
  const headers = useMemo(() => (sheet ? sheet.rows[headerRow] ?? [] : []), [sheet, headerRow]);
  const dataRows = useMemo(() => {
    if (!sheet) return [];
    const mapped = Object.values(mapping).filter((v): v is number => v != null);
    return sheet.rows
      .map((r, i) => ({ rowNumber: i + 1, r }))
      .slice(headerRow + 1)
      .filter(({ r }) => mapped.some((c) => (r[c] ?? "").trim() !== ""));
  }, [sheet, headerRow, mapping]);

  const reset = (e: ImportEntity, s?: Sheet[], idx = 0) => {
    const sh = (s ?? sheets)[idx];
    if (!sh) return;
    const h = detectHeader(sh.rows, e);
    setHeaderRow(h);
    setMapping(suggestMapping(e, sh.rows[h] ?? []));
  };

  const onFile = async (f: File | null) => {
    setError(null); setProgress(null); setFile(f); setSheets([]);
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) { setError("Arquivo maior que 30 MB. Exporte em partes (por período ou por letra)."); return; }
    setBusy("Lendo planilha…");
    try {
      const s = await readFile(f);
      if (!s.length || !s.some((x) => x.rows.filter((r) => r.some(Boolean)).length > 1)) throw new Error("A planilha está vazia.");
      const idx = Math.max(0, s.findIndex((x) => x.rows.length > 1));
      setSheets(s); setSheetIdx(idx); reset(entity, s, idx);
    } catch (e) {
      setError(`Não consegui ler o arquivo: ${e instanceof Error ? e.message : e}. Tente exportar em .xlsx ou .csv.`);
    } finally { setBusy(null); }
  };

  const missing = FIELDS[entity].filter((f) => f.required && mapping[f.key] == null);

  const validate = async () => {
    if (!file || !sheet) return;
    setError(null);
    setBusy("Criando lote…");
    const job = await createImportJob({ entity, fileName: file.name, sheetName: sheet.name, mapping, headers, totalRows: dataRows.length });
    if (!job.ok) { setError(job.error); setBusy(null); return; }
    const p = { sent: 0, total: dataRows.length, valid: 0, dup: 0, invalid: 0 };
    setProgress({ ...p });
    for (let i = 0; i < dataRows.length; i += BATCH) {
      setBusy(`Validando linhas ${i + 1}–${Math.min(i + BATCH, dataRows.length)} de ${dataRows.length}…`);
      const batch = dataRows.slice(i, i + BATCH).map(({ rowNumber, r }) => ({
        rowNumber,
        values: Object.fromEntries(Object.entries(mapping).filter(([, c]) => c != null).map(([k, c]) => [k, r[c!] ?? ""])),
      }));
      const res = await stageImportRows(job.jobId, batch);
      if (!res.ok) { setError(`${res.error} (o lote parcial pode ser descartado na próxima tela)`); setBusy(null); router.push(`/admin/importacao/${job.jobId}`); return; }
      p.sent += batch.length; p.valid += res.VALIDO; p.dup += res.DUPLICADO; p.invalid += res.INVALIDO;
      setProgress({ ...p });
    }
    await finishValidation(job.jobId);
    router.push(`/admin/importacao/${job.jobId}`);
  };

  return (
    <div className="space-y-5">
      <section className="card card-pad space-y-4">
        <h2 className="font-semibold">1 · O que importar</h2>
        <div className="flex flex-wrap gap-2">
          {ENTITY_ORDER.map((e, i) => (
            <button key={e} type="button" disabled={!!busy} onClick={() => { setEntity(e); reset(e, undefined, sheetIdx); }}
              className={`btn ${entity === e ? "btn-primary" : ""}`}>
              {i + 1}. {ENTITY_LABEL[e]} {counts[e] ? <span className="text-xs opacity-80">({counts[e]} já importados)</span> : null}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">{ENTITY_HELP[entity]} Ordem recomendada: clientes → veículos → fornecedores → peças → histórico de OS.</p>
        <label className="block">
          <span className="label">Arquivo exportado do SYSCAR (.xls, .xlsx ou .csv)</span>
          <input type="file" accept=".xls,.xlsx,.csv,.txt" className="input" disabled={!!busy} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
        <p className="text-xs text-muted">O arquivo é lido no seu navegador; ao servidor seguem apenas as colunas mapeadas, em lotes.</p>
      </section>

      {sheet && (
        <section className="card card-pad space-y-4">
          <h2 className="font-semibold">2 · Colunas</h2>
          <div className="flex flex-wrap gap-4">
            {sheets.length > 1 && (
              <label><span className="label">Aba</span>
                <select className="select" value={sheetIdx} onChange={(e) => { const i = Number(e.target.value); setSheetIdx(i); reset(entity, undefined, i); }}>
                  {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} linhas)</option>)}
                </select>
              </label>
            )}
            <label><span className="label">Linha do cabeçalho</span>
              <input type="number" min={1} max={Math.min(50, sheet.rows.length)} className="input w-28" value={headerRow + 1}
                onChange={(e) => { const h = Math.max(0, Number(e.target.value) - 1); setHeaderRow(h); setMapping(suggestMapping(entity, sheet.rows[h] ?? [])); }} />
            </label>
            <div className="self-end text-sm text-muted">{dataRows.length} linha(s) com dados abaixo do cabeçalho</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS[entity].map((f) => (
              <label key={f.key} className="block">
                <span className="label">{f.label}{f.required && " *"}</span>
                <select className={`select ${f.required && mapping[f.key] == null ? "border-danger" : ""}`} value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">— não importar —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1} sem título)`}</option>)}
                </select>
                {f.hint && <span className="mt-1 block text-xs text-muted">{f.hint}</span>}
              </label>
            ))}
          </div>
          {missing.length > 0 && <p className="alert alert-warn">Falta mapear: {missing.map((m) => m.label).join(", ")}.</p>}

          <h3 className="text-sm font-semibold">Prévia (5 primeiras linhas, como serão lidas)</h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="table text-xs">
              <thead><tr><th>Linha</th>{FIELDS[entity].filter((f) => mapping[f.key] != null).map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {dataRows.slice(0, 5).map(({ rowNumber, r }) => (
                  <tr key={rowNumber}><td>{rowNumber}</td>{FIELDS[entity].filter((f) => mapping[f.key] != null).map((f) => <td key={f.key} className="max-w-48 truncate">{r[mapping[f.key]!]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {progress && (
        <div className="card card-pad">
          <div className="mb-2 flex justify-between text-sm"><span>{busy ?? "Concluído"}</span><span className="tabular-nums">{progress.sent}/{progress.total}</span></div>
          <div className="h-2 overflow-hidden rounded bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${progress.total ? (progress.sent / progress.total) * 100 : 0}%` }} /></div>
          <p className="mt-2 text-xs text-muted">Válidos {progress.valid} · duplicados {progress.dup} · inválidos {progress.invalid}</p>
        </div>
      )}
      {sheet && (
        <button type="button" className="btn btn-primary" disabled={!!busy || missing.length > 0 || !dataRows.length} onClick={validate}>
          {busy ?? `Validar ${dataRows.length} linha(s)`}
        </button>
      )}
      {!sheet && busy && <p className="text-sm text-muted">{busy}</p>}
      <p className="text-xs text-muted">Validar não grava nada nos cadastros: você revisa o resultado e só então confirma a importação.</p>
    </div>
  );
}
