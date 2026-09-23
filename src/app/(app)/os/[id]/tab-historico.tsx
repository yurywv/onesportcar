import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { dateTime } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/workflow";
import { Section } from "@/components/ui";
import type { TabProps } from "./types";

export async function TabHistorico({ wo, user }: TabProps) {
  const ids = [
    wo.id, wo.checkIn?.id, ...wo.estimates.map((e) => e.id), ...wo.estimates.flatMap((e) => e.versions.map((v) => v.id)),
    ...wo.titles.map((t) => t.id), ...wo.services.map((s) => s.id), ...wo.diagnostics.map((d) => d.id), ...wo.inspections.map((i) => i.id),
  ].filter(Boolean) as string[];
  const logs = can(user.role, "auditoria:ver") || can(user.role, "os:ver_todas")
    ? await db.auditLog.findMany({ where: { entityId: { in: ids } }, orderBy: { createdAt: "asc" } })
    : [];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Linha do tempo de status">
        <ol className="relative ml-2 border-l border-line">
          {wo.statusHistory.map((h) => (
            <li key={h.id} className="mb-4 ml-5 text-sm">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
              <div className="font-medium">{h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ""}{STATUS_LABEL[h.toStatus]}</div>
              <div className="text-xs text-muted">{dateTime(h.createdAt)} · {h.userName ?? "sistema"} · {h.source.toLowerCase()}</div>
              {h.reason && <div className="text-xs">{h.reason}</div>}
            </li>
          ))}
        </ol>
      </Section>
      {logs.length > 0 && (
        <Section title="Trilha de auditoria">
          <ul className="space-y-2 text-xs">
            {logs.map((l) => (
              <li key={l.id} className="border-b border-line pb-2">
                <div><b>{l.action}</b> · {l.entity} · {dateTime(l.createdAt)} · {l.userName ?? "—"}{l.ip && ` · ${l.ip}`}</div>
                {l.after && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-muted">{JSON.stringify(l.after)}</pre>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
