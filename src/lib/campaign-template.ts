import type { Campaign } from "@prisma/client";

// ─── Modelo de mensagem ───
export const PLACEHOLDERS = ["nome", "primeiro_nome", "carro", "placa"] as const;
export type Vars = Partial<Record<(typeof PLACEHOLDERS)[number], string>>;

export function renderTemplate(tpl: string, vars: Vars): string {
  return tpl.replace(/\{(nome|primeiro_nome|carro|placa)\}/g, (_, k: keyof Vars) => vars[k] ?? "");
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m) => m.toUpperCase());

export function varsFor(c: { name: string; type?: string; tradeName?: string | null }, v?: { make: string; model: string; plate: string } | null): Vars {
  const display = c.type === "PJ" && c.tradeName ? c.tradeName : c.name;
  const nome = titleCase(display.trim());
  return {
    nome,
    primeiro_nome: c.type === "PJ" ? nome : nome.split(/\s+/)[0],
    carro: v ? titleCase(`${v.make} ${v.model}`.trim()) : "seu veículo",
    placa: v?.plate ?? "",
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto simples → HTML: parágrafos por linha em branco, quebras de linha, links clicáveis e **negrito**. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      let h = esc(p).replace(/\n/g, "<br>");
      h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#b91c1c">$1</a>');
      return `<p style="margin:0 0 16px;line-height:1.55">${h}</p>`;
    })
    .join("");
}

export function emailHtml(opts: { body: string; imageUrl?: string | null; unsubscribeUrl: string }) {
  const img = opts.imageUrl ? `<img src="${esc(opts.imageUrl)}" alt="" width="560" style="display:block;width:100%;max-width:560px;border-radius:8px;margin:0 0 20px">` : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px">
<tr><td style="background:#09090b;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0;font-size:20px;font-weight:bold;letter-spacing:.5px">ONE SPORTCAR</td></tr>
<tr><td style="padding:24px;font-size:15px">${img}${textToHtml(opts.body)}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a">
One Sportcar — você recebe esta mensagem por ser cliente da oficina.<br>
<a href="${esc(opts.unsubscribeUrl)}" style="color:#71717a">Não quero mais receber estas mensagens</a>
</td></tr></table></td></tr></table></body></html>`;
}

// ─── Contatos ───
/** Celular brasileiro → 55DDDNNNNNNNNN (formato da API do WhatsApp). Retorna null se não parecer celular. */
export function normalizeWhatsapp(raw?: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (!d.startsWith("55")) return d.length >= 11 && d.length <= 15 ? d : null; // número estrangeiro
  const local = d.slice(4);
  if (d.length === 12 && /^[6-9]/.test(local)) d = d.slice(0, 4) + "9" + local; // celular antigo sem o 9
  return d.length === 13 && d[4] === "9" ? d : null;
}

export const validEmail = (e?: string | null) => !!e && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e.trim());

// ─── Janela de envio (horário de Brasília, UTC−3 sem horário de verão) ───
const BRT_OFFSET = -3 * 60;
const brt = (d: Date) => new Date(d.getTime() + BRT_OFFSET * 60_000);

export function inWindow(c: Pick<Campaign, "windowStart" | "windowEnd" | "weekdaysOnly">, now: Date): boolean {
  const t = brt(now);
  const dow = t.getUTCDay();
  if (c.weekdaysOnly && (dow === 0 || dow === 6)) return false;
  const m = t.getUTCHours() * 60 + t.getUTCMinutes();
  return m >= c.windowStart && m < c.windowEnd;
}

/** Próximo instante dentro da janela (para mostrar "próximo disparo" e reagendar fora do horário). */
export function nextWindowStart(c: Pick<Campaign, "windowStart" | "windowEnd" | "weekdaysOnly">, from: Date): Date {
  if (inWindow(c, from)) return from;
  const t = brt(from);
  for (let i = 0; i < 8; i++) {
    const day = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + i));
    const cand = new Date(day.getTime() + c.windowStart * 60_000 - BRT_OFFSET * 60_000);
    if (cand > from && inWindow(c, cand)) return cand;
  }
  return new Date(from.getTime() + 3600_000);
}

export const fmtMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const parseHHMM = (s: string | null, def: number) => {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2])) : def;
};

export function waLink(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export const MAX_BATCH = { EMAIL: 100, WHATSAPP_API: 80, WHATSAPP_MANUAL: 500 } as const;
