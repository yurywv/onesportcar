"use client";
import { useState } from "react";

export type Mark = { x: number; y: number; type: string; severity: string; note?: string };
const TYPES = ["RISCO", "AMASSADO", "TRINCA", "RODA", "INTERNO"];
const SEV = ["LEVE", "MEDIA", "GRAVE"];
const COLOR: Record<string, string> = { LEVE: "var(--warn)", MEDIA: "#ea7a2b", GRAVE: "var(--danger)" };

/** Vista superior esquemática de um automóvel (desenho próprio, sem marca). Coordenadas normalizadas 0–1. */
function CarTop() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity=".55">
      <path d="M150 20 C95 22 78 60 76 110 L72 390 C72 440 96 478 150 480 C204 478 228 440 228 390 L224 110 C222 60 205 22 150 20 Z" />
      <path d="M96 150 C110 128 190 128 204 150 L196 215 C170 205 130 205 104 215 Z" />
      <path d="M104 335 C130 345 170 345 196 335 L202 385 C185 400 115 400 98 385 Z" />
      <path d="M104 222 L100 328 M196 222 L200 328" />
      <rect x="52" y="88" width="22" height="58" rx="8" /><rect x="226" y="88" width="22" height="58" rx="8" />
      <rect x="52" y="352" width="22" height="58" rx="8" /><rect x="226" y="352" width="22" height="58" rx="8" />
      <path d="M72 180 L58 176 M228 180 L242 176" />
      <text x="150" y="12" fontSize="10" textAnchor="middle" stroke="none" fill="currentColor">FRENTE</text>
      <text x="150" y="496" fontSize="10" textAnchor="middle" stroke="none" fill="currentColor">TRASEIRA</text>
    </g>
  );
}

export function DamageMap({ name = "damages", initial = [], readOnly = false }: { name?: string; initial?: Mark[]; readOnly?: boolean }) {
  const [marks, setMarks] = useState<Mark[]>(initial);
  const [type, setType] = useState("RISCO");
  const [sev, setSev] = useState("LEVE");
  const [note, setNote] = useState("");

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,260px)_1fr]">
      <svg
        viewBox="0 0 300 500"
        className={`w-full max-w-[260px] rounded-lg border border-line bg-surface-2 text-fg ${readOnly ? "" : "cursor-crosshair touch-none"}`}
        role="img"
        aria-label="Mapa de avarias — vista superior"
        onClick={(e) => {
          if (readOnly) return;
          const r = e.currentTarget.getBoundingClientRect();
          setMarks((m) => [...m, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, type, severity: sev, note: note || undefined }]);
          setNote("");
        }}
      >
        <CarTop />
        {marks.map((m, i) => (
          <g key={i} transform={`translate(${m.x * 300} ${m.y * 500})`}>
            <circle r="9" fill={COLOR[m.severity] ?? "var(--warn)"} opacity=".9" />
            <text y="4" fontSize="10" textAnchor="middle" fill="#fff" fontWeight="700">{i + 1}</text>
          </g>
        ))}
      </svg>
      <div className="min-w-0 space-y-3">
        {!readOnly && (
          <div className="grid grid-cols-2 gap-2">
            <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de avaria">{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <select className="select" value={sev} onChange={(e) => setSev(e.target.value)} aria-label="Severidade">{SEV.map((t) => <option key={t}>{t}</option>)}</select>
            <input className="input col-span-2" placeholder="Nota da próxima marcação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="col-span-2 text-xs text-muted">Escolha tipo e severidade e toque no desenho para marcar.</p>
          </div>
        )}
        {marks.length ? (
          <ol className="space-y-1 text-sm">
            {marks.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span><b>{i + 1}.</b> {m.type} · {m.severity}{m.note && ` — ${m.note}`}</span>
                {!readOnly && <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setMarks(marks.filter((_, j) => j !== i))}>remover</button>}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted">Nenhuma avaria marcada.</p>}
      </div>
      {!readOnly && <input type="hidden" name={name} value={JSON.stringify(marks)} />}
    </div>
  );
}
