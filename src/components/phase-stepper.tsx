import type { ServicePhase } from "@prisma/client";
import { PHASES, PHASE_LABEL } from "@/lib/phases";

export function PhaseStepper({ current, done }: { current: ServicePhase | null; done?: boolean }) {
  const idx = done ? PHASES.length : current ? PHASES.indexOf(current) : -1;
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label="Etapas da manutenção">
      {PHASES.map((p, i) => (
        <li key={p} className="min-w-0" aria-current={i === idx ? "step" : undefined}>
          <div className={`h-1.5 rounded-full ${i < idx ? "bg-accent" : i === idx ? "animate-pulse bg-accent" : "bg-line"}`} />
          <div className={`mt-1 truncate text-[10px] leading-tight sm:text-xs ${i === idx ? "font-semibold text-accent" : i < idx ? "text-fg" : "text-muted"}`}>{PHASE_LABEL[p]}</div>
        </li>
      ))}
    </ol>
  );
}
