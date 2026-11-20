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

/** Só deixa passar links seguros; imagens enviadas pela plataforma ficam em /arte/<id> e ganham o endereço público. */
export function safeUrl(raw: string, base = ""): string {
  const u = raw.trim();
  if (u.startsWith("/arte/")) return `${base.replace(/\/$/, "")}${u}`;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^www\./i.test(u)) return `https://${u}`;
  return "#";
}

const ACCENT = "#b91c1c";

function inline(raw: string, base: string): string {
  // links e botões viram marcadores antes do escape, para não serem quebrados
  const tokens: string[] = [];
  const keep = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  let t = raw.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => keep(`<a href="${esc(safeUrl(url, base))}" style="color:${ACCENT};text-decoration:underline">${esc(label)}</a>`));
  t = t.replace(/(?<![\w/])((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)])/g, (m: string) => keep(`<a href="${esc(safeUrl(m))}" style="color:${ACCENT}">${esc(m)}</a>`));
  let h = esc(t);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])_(.+?)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");
  h = h.replace(/\n/g, "<br>");
  return h.replace(/\u0000(\d+)\u0000/g, (_, i: string) => tokens[Number(i)]);
}

/**
 * Editor de texto → HTML de e-mail (compatível com Gmail/Outlook: estilos inline).
 * # Título · ## Subtítulo · **negrito** · _itálico_ · [texto](link) · - lista · --- linha
 * ![descrição](imagem) · [[Texto do botão|link]]
 */
export function textToHtml(text: string, base = ""): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      if (/^-{3,}$/.test(b)) return `<hr style="border:0;border-top:1px solid #e4e4e7;margin:20px 0">`;
      const img = b.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (img) return `<img src="${esc(safeUrl(img[2], base))}" alt="${esc(img[1])}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:6px;margin:0 0 16px">`;
      const btn = b.match(/^\[\[([^|\]]+)\|([^\]]+)\]\]$/);
      if (btn)
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="background:${ACCENT};border-radius:6px"><a href="${esc(safeUrl(btn[2], base))}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:bold;text-decoration:none;font-size:15px">${esc(btn[1].trim())}</a></td></tr></table>`;
      const h = b.match(/^(#{1,2})\s+(.+)$/);
      if (h && !b.includes("\n")) return h[1] === "#"
        ? `<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#09090b">${inline(h[2], base)}</h1>`
        : `<h2 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:#09090b">${inline(h[2], base)}</h2>`;
      const lines = b.split("\n");
      if (lines.every((l) => /^[-•]\s+/.test(l)))
        return `<ul style="margin:0 0 16px;padding-left:22px;line-height:1.55">${lines.map((l) => `<li style="margin:0 0 6px">${inline(l.replace(/^[-•]\s+/, ""), base)}</li>`).join("")}</ul>`;
      return `<p style="margin:0 0 16px;line-height:1.55">${inline(b, base)}</p>`;
    })
    .join("");
}

/** Versão só-texto (parte text/plain do e-mail). */
export function textToPlain(text: string, base = "") {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_, l: string, u: string) => `${l.trim()}: ${safeUrl(u, base)}`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, l: string, u: string) => `${l} (${safeUrl(u, base)})`)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,2}\s+/gm, "")
    .trim();
}

/** Limpa HTML pronto (Canva, Mailchimp…): remove scripts, iframes, formulários e eventos. */
export function sanitizeEmailHtml(html: string) {
  return html
    .replace(/<\s*(script|iframe|object|embed|form|meta[^>]*http-equiv)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|form|input|button)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

export const htmlToPlain = (html: string) =>
  html
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export type EmailMode = "TEXTO" | "ARTE" | "HTML";
export type EmailContent = {
  mode: EmailMode;
  body: string;
  preheader?: string | null;
  imageUrl?: string | null;
  artUrl?: string | null; // /arte/<id> ou https
  artAlt?: string | null;
  artLink?: string | null;
  htmlBody?: string | null;
};

const footer = (unsub: string) => `<tr><td style="padding:16px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;font-family:Arial,Helvetica,sans-serif">
One Sportcar — você recebe esta mensagem por ser cliente da oficina.<br>
<a href="${esc(unsub)}" style="color:#71717a">Não quero mais receber estas mensagens</a>
</td></tr>`;

const preheaderHtml = (p?: string | null) =>
  p ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(p)}${"&#847; ".repeat(40)}</div>` : "";

/** Monta o e-mail final (HTML + texto) para um destinatário. */
export function buildEmail(c: EmailContent, vars: Vars, opts: { unsubscribeUrl: string; base?: string }) {
  const base = opts.base ?? "";
  const r = (s?: string | null) => renderTemplate(s ?? "", vars);
  if (c.mode === "HTML" && c.htmlBody) {
    let html = sanitizeEmailHtml(r(c.htmlBody)).replace(/(src|href)=(["'])(\/arte\/[^"']+)\2/g, (_, a: string, q: string, u: string) => `${a}=${q}${safeUrl(u, base)}${q}`);
    const unsubLink = `<a href="${esc(opts.unsubscribeUrl)}" style="color:#71717a">Não quero mais receber estas mensagens</a>`;
    if (html.includes("{descadastro}")) html = html.replaceAll("{descadastro}", esc(opts.unsubscribeUrl));
    else {
      const f = `<div style="padding:16px;text-align:center;font-size:12px;color:#71717a;font-family:Arial,Helvetica,sans-serif">One Sportcar — você recebe esta mensagem por ser cliente da oficina. ${unsubLink}</div>`;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${f}</body>`) : `${html}${f}`;
    }
    if (c.preheader) html = /<body[^>]*>/i.test(html) ? html.replace(/(<body[^>]*>)/i, `$1${preheaderHtml(r(c.preheader))}`) : preheaderHtml(r(c.preheader)) + html;
    if (!/<html/i.test(html)) html = `<!doctype html><html lang="pt-BR"><body style="margin:0">${html}</body></html>`;
    return { html, text: `${htmlToPlain(html)}\n\n—\nPara não receber mais: ${opts.unsubscribeUrl}` };
  }
  let content = "";
  let text = "";
  if (c.mode === "ARTE" && c.artUrl) {
    const img = `<img src="${esc(safeUrl(c.artUrl, base))}" alt="${esc(r(c.artAlt) || "One Sportcar")}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0">`;
    const linked = c.artLink ? `<a href="${esc(safeUrl(r(c.artLink), base))}">${img}</a>` : img;
    content = `<tr><td style="padding:0">${linked}</td></tr>`;
    if (c.body.trim()) content += `<tr><td style="padding:20px 24px;font-size:15px">${textToHtml(r(c.body), base)}</td></tr>`;
    text = [r(c.artAlt), textToPlain(r(c.body), base), c.artLink ? safeUrl(r(c.artLink), base) : ""].filter(Boolean).join("\n\n");
  } else {
    const banner = c.imageUrl ? `<img src="${esc(safeUrl(c.imageUrl, base))}" alt="" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px;margin:0 0 20px">` : "";
    content = `<tr><td style="background:#09090b;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0;font-size:20px;font-weight:bold;letter-spacing:.5px">ONE SPORTCAR</td></tr>
<tr><td style="padding:24px;font-size:15px">${banner}${textToHtml(r(c.body), base)}</td></tr>`;
    text = textToPlain(r(c.body), base);
  }
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
${preheaderHtml(r(c.preheader))}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden">
${content}
${footer(opts.unsubscribeUrl)}</table></td></tr></table></body></html>`;
  return { html, text: `${text}\n\n—\nPara não receber mais: ${opts.unsubscribeUrl}` };
}

/** Compatibilidade: e-mail de texto simples. */
export function emailHtml(opts: { body: string; imageUrl?: string | null; unsubscribeUrl: string }) {
  return buildEmail({ mode: "TEXTO", body: opts.body, imageUrl: opts.imageUrl }, {}, { unsubscribeUrl: opts.unsubscribeUrl }).html;
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
