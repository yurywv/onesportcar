const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const TZ = "America/Sao_Paulo";

export const money = (cents: number | null | undefined) => brl.format((cents ?? 0) / 100);

/** "1.234,56" | "1234.56" → centavos */
export function parseMoney(input: FormDataEntryValue | string | null | undefined): number {
  const s = String(input ?? "").trim();
  if (!s) return 0;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export const dateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) : "—";
export const date = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: TZ }) : "—";
export const time = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "—";

export const km = (n: number | null | undefined) => `${(n ?? 0).toLocaleString("pt-BR")} km`;

export function minutesLabel(min: number) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}min`;
}

/** Converte "2026-09-23T14:30" (horário de Brasília, de input datetime-local) em Date UTC. */
export function fromLocalInput(s: string): Date {
  return new Date(`${s}:00-03:00`);
}
export function toLocalInput(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return local.toISOString().slice(0, 16);
}
