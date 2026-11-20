import type { Check } from "@/lib/send-readiness";

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {checks.map((c) => (
        <li key={c.label} className="flex items-start gap-2 py-2">
          <span aria-hidden className="mt-0.5">{c.ok === true ? "✅" : c.ok === false ? "❌" : "➖"}</span>
          <div className="min-w-0"><b>{c.label}</b><div className="break-words text-xs text-muted">{c.detail}</div></div>
        </li>
      ))}
    </ul>
  );
}
