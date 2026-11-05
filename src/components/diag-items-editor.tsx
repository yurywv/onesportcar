"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type Row = { type: string; description: string; quantity: string; minutes: string; reference: string; classification: string; notes: string };
const blank = (type = "PECA"): Row => ({ type, description: "", quantity: "1", minutes: type === "SERVICO" ? "60" : "", reference: "", classification: "OBRIGATORIO", notes: "" });

/** Lista de serviços (com tempo) e peças levantados no diagnóstico. Gera o campo oculto "items" (JSON). */
export function DiagItemsEditor({ name = "items" }: { name?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = ref.current?.form;
    const clear = () => setRows([]);
    form?.addEventListener("reset", clear);
    return () => form?.removeEventListener("reset", clear);
  }, []);
  const set = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = rows.filter((r) => r.type === "SERVICO").reduce((s, r) => s + (Number(r.minutes) || 0), 0);
  return (
    <div className="space-y-2">
      <input ref={ref} type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[120px_1fr_70px_90px_auto]">
          <select className="select !min-h-9" value={r.type} onChange={(e) => set(i, "type", e.target.value)} aria-label="Tipo">
            <option value="SERVICO">Serviço</option><option value="PECA">Peça</option><option value="CONSUMIVEL">Consumível</option><option value="TERCEIRO">Terceiro</option>
          </select>
          <input className="input !min-h-9" value={r.description} onChange={(e) => set(i, "description", e.target.value)} placeholder={r.type === "SERVICO" ? "Ex.: Substituir pastilhas dianteiras" : "Ex.: Jogo de pastilhas dianteiras"} aria-label="Descrição" />
          {r.type === "SERVICO"
            ? <input className="input !min-h-9" value={r.minutes} onChange={(e) => set(i, "minutes", e.target.value)} inputMode="numeric" placeholder="min" title="Tempo estimado (minutos)" aria-label="Minutos" />
            : <input className="input !min-h-9" value={r.quantity} onChange={(e) => set(i, "quantity", e.target.value)} inputMode="decimal" placeholder="Qtd" aria-label="Quantidade" />}
          {r.type === "SERVICO"
            ? <select className="select !min-h-9" value={r.classification} onChange={(e) => set(i, "classification", e.target.value)} aria-label="Classe"><option value="OBRIGATORIO">Obrigatório</option><option value="RECOMENDADO">Recomendado</option><option value="PREVENTIVO">Preventivo</option><option value="OPCIONAL">Opcional</option></select>
            : <input className="input !min-h-9" value={r.reference} onChange={(e) => set(i, "reference", e.target.value)} placeholder="Part number" aria-label="Referência" />}
          <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remover"><Trash2 size={15} /></button>
          <input className="input !min-h-8 text-xs sm:col-span-5" value={r.notes} onChange={(e) => set(i, "notes", e.target.value)} placeholder="Observação técnica (interna — não vai para o cliente)" />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setRows((r) => [...r, blank("SERVICO")])}><Plus size={14} /> Serviço (mão de obra)</button>
        <button type="button" className="btn btn-sm" onClick={() => setRows((r) => [...r, blank("PECA")])}><Plus size={14} /> Peça</button>
        {total > 0 && <span className="text-xs text-muted">Esforço total: {Math.floor(total / 60)}h{String(total % 60).padStart(2, "0")}</span>}
      </div>
    </div>
  );
}
