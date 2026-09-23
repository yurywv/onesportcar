"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import type { ActionState } from "@/lib/action";

export type Card = {
  id: string; number: string; status: string; vehicle: string; plate: string; customer: string;
  technician: string | null; consultant: string | null; promisedAt: string | null; late: boolean; priority: string; flags: string[];
  targets: string[];
};
export type Column = { key: string; label: string };
export type Appt = { id: string; time: string; vehicle: string; plate: string; customer: string };

export function Kanban({ columns, cards, appts, move, canMove }: {
  columns: Column[]; cards: Card[]; appts: Appt[]; canMove: boolean;
  move: (s: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [optimistic, setOptimistic] = useOptimistic(cards, (state, m: { id: string; to: string }) => state.map((c) => (c.id === m.id ? { ...c, status: m.to } : c)));
  const [msg, setMsg] = useState<ActionState>(null);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;

  const doMove = (id: string, to: string) => {
    const card = optimistic.find((c) => c.id === id);
    if (!card || card.status === to) return;
    if (!card.targets.includes(to)) {
      setMsg({ error: `${card.number}: não é possível mover de "${label(card.status)}" para "${label(to)}" manualmente.`, at: Date.now() });
      return;
    }
    start(async () => {
      setOptimistic({ id, to });
      const fd = new FormData();
      fd.set("id", id); fd.set("to", to); fd.set("source", "KANBAN");
      setMsg(await move(null, fd));
    });
  };

  return (
    <>
      {msg && (
        <div className={`mb-3 alert ${msg.error ? "alert-error" : "alert-ok"} flex justify-between gap-2`} role="status">
          <span>{msg.error ?? msg.ok}</span><button className="text-xs underline" onClick={() => setMsg(null)}>fechar</button>
        </div>
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
        <div className="flex gap-3" style={{ minWidth: columns.length * 252 }}>
          {columns.map((col) => {
            const list = optimistic.filter((c) => c.status === col.key);
            return (
              <section
                key={col.key}
                className={`flex w-60 shrink-0 flex-col rounded-xl border bg-surface-2/60 ${over === col.key ? "border-accent" : "border-line"}`}
                onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(col.key); } }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { setOver(null); doMove(e.dataTransfer.getData("text/plain"), col.key); }}
                aria-label={col.label}
              >
                <header className="flex items-center justify-between px-3 py-2.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{col.label}</h2>
                  <span className="badge">{col.key === "PRE_OS" ? appts.length : list.length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {col.key === "PRE_OS" && appts.map((a) => (
                    <div key={a.id} className="card p-2.5 text-sm">
                      <div className="flex justify-between text-xs text-muted"><span>{a.time}</span><span className="plate">{a.plate}</span></div>
                      <div className="mt-1 font-medium">{a.vehicle}</div>
                      <div className="truncate text-xs text-muted">{a.customer}</div>
                      <Link href={`/os/nova?agendamento=${a.id}`} className="link mt-1 inline-block text-xs">Fazer check-in →</Link>
                    </div>
                  ))}
                  {list.map((c) => (
                    <article
                      key={c.id}
                      draggable={canMove}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                      className={`card p-2.5 text-sm ${canMove ? "cursor-grab active:cursor-grabbing" : ""} ${c.late ? "border-danger/60" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <Link href={`/os/${c.id}`} className="link text-xs">{c.number}</Link>
                        <span className="plate">{c.plate}</span>
                      </div>
                      <div className="mt-1 font-medium leading-tight">{c.vehicle}</div>
                      <div className="truncate text-xs text-muted">{c.customer}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.priority !== "NORMAL" && <span className="badge badge-warn">{c.priority}</span>}
                        {c.late && <span className="badge badge-danger">Atrasada</span>}
                        {c.flags.map((f) => <span key={f} className="badge">{f}</span>)}
                      </div>
                      <div className="mt-1.5 text-[11px] text-muted">
                        {c.technician ?? "sem técnico"}{c.consultant && ` · ${c.consultant}`}
                        {c.promisedAt && <div>Previsão {c.promisedAt}</div>}
                      </div>
                      {canMove && c.targets.length > 0 && (
                        <select
                          className="select mt-2 !min-h-8 text-xs"
                          value=""
                          aria-label={`Mover ${c.number}`}
                          onChange={(e) => e.target.value && doMove(c.id, e.target.value)}
                        >
                          <option value="">Mover para…</option>
                          {c.targets.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                        </select>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
