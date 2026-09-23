import type { ReactNode } from "react";
import Link from "next/link";
import type { WorkOrderStatus } from "@prisma/client";
import { STATUS_LABEL } from "@/lib/workflow";
import { formatPlate } from "@/lib/validators";

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={className}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Section({ title, children, actions, className = "" }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card card-pad ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

const STATUS_TONE: Partial<Record<WorkOrderStatus, string>> = {
  PRE_OS: "badge", AGUARDANDO_APROVACAO: "badge badge-warn", AGUARDANDO_PECAS: "badge badge-warn",
  EM_EXECUCAO: "badge badge-info", EM_DIAGNOSTICO: "badge badge-info", CONTROLE_QUALIDADE: "badge badge-accent",
  PRONTO_ENTREGA: "badge badge-ok", ENTREGUE: "badge badge-ok", CANCELADA: "badge badge-danger", ENCERRADA_SEM_SERVICO: "badge",
};
export function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return <span className={STATUS_TONE[status] ?? "badge badge-accent"}>{STATUS_LABEL[status]}</span>;
}

export function Plate({ plate }: { plate: string }) {
  return <span className="plate">{formatPlate(plate)}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "danger" | "ok" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "";
  return (
    <div className="card card-pad">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pager({ page, total, size, params }: { page: number; total: number; size: number; params: Record<string, string | undefined> }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  const href = (p: number) => "?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>, p: String(p) });
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      {page > 1 && <Link className="btn btn-sm" href={href(page - 1)}>Anterior</Link>}
      <span className="text-muted">Página {page} de {pages}</span>
      {page < pages && <Link className="btn btn-sm" href={href(page + 1)}>Próxima</Link>}
    </div>
  );
}
