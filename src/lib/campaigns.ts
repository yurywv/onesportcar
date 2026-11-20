import { randomBytes } from "crypto";
import type { Campaign, CampaignChannel, Prisma } from "@prisma/client";
import { db } from "./db";
import { buildEmail, inWindow, MAX_BATCH, nextWindowStart, normalizeWhatsapp, renderTemplate, validEmail, type EmailContent, type Vars } from "./campaign-template";
import { getSetting } from "./settings";

export * from "./campaign-template";


export function addressFor(channel: CampaignChannel, c: { email: string | null; whatsapp: string | null; phone: string | null }): string | null {
  if (channel === "EMAIL") return validEmail(c.email) ? c.email!.trim().toLowerCase() : null;
  return normalizeWhatsapp(c.whatsapp) ?? normalizeWhatsapp(c.phone);
}

export async function ensureMarketingToken(customerId: string, tx: Prisma.TransactionClient = db): Promise<string> {
  const c = await tx.customer.findUnique({ where: { id: customerId }, select: { marketingToken: true } });
  if (c?.marketingToken) return c.marketingToken;
  const token = randomBytes(18).toString("base64url");
  await tx.customer.update({ where: { id: customerId }, data: { marketingToken: token } });
  return token;
}

// ─── Provedores ───
export type SendInput = { campaign: Campaign; to: string; vars: Vars; unsubscribeUrl: string; idempotencyKey: string };
export type SendResult = { ok: true; id?: string } | { ok: false; error: string; retry?: boolean };
export type Sender = (i: SendInput) => Promise<SendResult>;

export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
/** Token fica só na Vercel; o ID do número pode ser trocado pela tela (Configurações de envio). */
export async function whatsappPhoneId() {
  const fromSettings = (await getSetting("whatsapp.phoneNumberId")).trim();
  return fromSettings || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
}
export const whatsappConfigured = async () => !!process.env.WHATSAPP_TOKEN && !!(await whatsappPhoneId());

export function emailContentOf(c: Campaign): EmailContent {
  return {
    mode: (["TEXTO", "ARTE", "HTML"].includes(c.emailMode) ? c.emailMode : "TEXTO") as EmailContent["mode"],
    body: c.body, preheader: c.preheader, imageUrl: c.imageUrl,
    artUrl: c.artId ? `/arte/${c.artId}` : null, artAlt: c.artAlt, artLink: c.artLink, htmlBody: c.htmlBody,
  };
}

export const sendEmail: Sender = async ({ campaign, to, vars, unsubscribeUrl, idempotencyKey }) => {
  if (!emailConfigured()) return { ok: false, error: "E-mail não configurado (RESEND_API_KEY / MAIL_FROM)." };
  const { html, text } = buildEmail(emailContentOf(campaign), vars, { unsubscribeUrl, base: campaign.appUrl ?? new URL(unsubscribeUrl).origin });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [to],
      reply_to: process.env.MAIL_REPLY_TO || undefined,
      subject: renderTemplate(campaign.subject ?? campaign.name, vars),
      html,
      text,
      headers: { "List-Unsubscribe": `<${unsubscribeUrl.replace("/descadastro/", "/api/descadastro/")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campanha", value: campaign.id.replace(/[^a-zA-Z0-9_-]/g, "") }],
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (res.ok) return { ok: true, id: j.id };
  return { ok: false, error: `Resend ${res.status}: ${translateResend(j.message)}`, retry: res.status === 429 || res.status >= 500 };
};

function translateResend(m?: string) {
  if (!m) return "erro";
  if (/domain is not verified|verify a domain/i.test(m)) return `${m} — o domínio do remetente ainda não foi verificado no Resend (faltam os registros DNS).`;
  if (/API key is invalid/i.test(m)) return `${m} — confira a RESEND_API_KEY na Vercel.`;
  if (/testing emails/i.test(m)) return `${m} — conta do Resend em modo de teste: verifique o domínio para enviar a clientes.`;
  return m;
}

/** Envia um modelo aprovado da Meta para um número (usado por campanhas e pelo envio avulso). */
export async function sendWhatsappTemplate(to: string, template: string, language: string, params: string[]): Promise<SendResult> {
  const phoneId = await whatsappPhoneId();
  if (!process.env.WHATSAPP_TOKEN || !phoneId) return { ok: false, error: "WhatsApp API não configurado (WHATSAPP_TOKEN na Vercel e ID do número em Configurações de envio)." };
  const components = params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text || "-" })) }] : [];
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: template, language: { code: language }, components } }),
  });
  const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (res.ok) return { ok: true, id: j.messages?.[0]?.id };
  return { ok: false, error: `WhatsApp ${res.status}: ${j.error?.message ?? "erro"}`, retry: res.status === 429 || res.status >= 500 };
}

/** Confere na Meta qual número está ligado ao ID configurado (para garantir que é o WhatsApp comercial). */
export async function whatsappNumberInfo(): Promise<{ ok: boolean; display?: string; name?: string; quality?: string; error?: string }> {
  const phoneId = await whatsappPhoneId();
  if (!process.env.WHATSAPP_TOKEN || !phoneId) return { ok: false, error: "não configurado" };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}?fields=display_phone_number,verified_name,quality_rating`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, cache: "no-store",
    });
    const j = (await res.json()) as { display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: j.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, display: j.display_phone_number, name: j.verified_name, quality: j.quality_rating };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

export const sendWhatsapp: Sender = async ({ campaign, to, vars }) => {
  if (!campaign.waTemplate) return { ok: false, error: "Campanha sem modelo aprovado da Meta." };
  const params = (campaign.waParams ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return sendWhatsappTemplate(to, campaign.waTemplate, campaign.waLanguage, params.map((p) => (vars as Record<string, string>)[p] || "-"));
};

export const senderFor = (ch: CampaignChannel): Sender | null => (ch === "EMAIL" ? sendEmail : ch === "WHATSAPP_API" ? sendWhatsapp : null);

export const unsubscribeUrl = (appUrl: string | null | undefined, token: string) => `${(appUrl ?? "").replace(/\/$/, "")}/descadastro/${token}`;

// ─── Motor de disparo ───
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Executa um disparo da campanha se estiver na hora. Reserva o disparo de forma atômica
 * (atualiza nextRunAt antes de enviar), então cron e tela aberta nunca enviam o mesmo lote em dobro.
 */
export async function runCampaignBatch(id: string, opts: { now?: Date; sender?: Sender; pauseMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c || c.status !== "ENVIANDO" || c.channel === "WHATSAPP_MANUAL") return { sent: 0, reason: "inativa" };
  if (c.nextRunAt && c.nextRunAt > now) return { sent: 0, reason: "aguardando" };
  if (!inWindow(c, now)) {
    await db.campaign.update({ where: { id }, data: { nextRunAt: nextWindowStart(c, now) } });
    return { sent: 0, reason: "fora_do_horario" };
  }
  const claim = await db.campaign.updateMany({
    where: { id, status: "ENVIANDO", OR: [{ nextRunAt: null }, { nextRunAt: c.nextRunAt }] },
    data: { nextRunAt: new Date(now.getTime() + c.intervalMinutes * 60_000), lastRunAt: now },
  });
  if (!claim.count) return { sent: 0, reason: "concorrente" };

  const sender = opts.sender ?? senderFor(c.channel)!;
  const batch = await db.campaignRecipient.findMany({
    where: { campaignId: id, status: "PENDENTE" },
    include: { customer: { select: { marketingOptOutAt: true, marketingToken: true } } },
    orderBy: { createdAt: "asc" },
    take: Math.min(c.batchSize, MAX_BATCH[c.channel]),
  });
  let sent = 0;
  for (const r of batch) {
    const fresh = await db.campaign.findUnique({ where: { id }, select: { status: true } });
    if (fresh?.status !== "ENVIANDO") break; // pausada/cancelada no meio do lote
    if (r.customer.marketingOptOutAt) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "PULADO", error: "Cliente descadastrado" } });
      continue;
    }
    const token = r.customer.marketingToken ?? (await ensureMarketingToken(r.customerId));
    let res: SendResult;
    try {
      res = await sender({ campaign: c, to: r.address, vars: r.vars as Vars, unsubscribeUrl: unsubscribeUrl(c.appUrl, token), idempotencyKey: `${c.id}-${r.id}` });
    } catch (e) {
      res = { ok: false, error: String((e as Error).message ?? e), retry: true };
    }
    const attempts = r.attempts + 1;
    if (res.ok) {
      sent++;
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "ENVIADO", providerId: res.id, sentAt: new Date(), attempts, error: null } });
    } else {
      const giveUp = !res.retry || attempts >= 3;
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: giveUp ? "FALHOU" : "PENDENTE", error: res.error.slice(0, 500), attempts } });
      if (res.retry) break; // limite do provedor: tenta o resto no próximo disparo
    }
    if (opts.pauseMs !== 0) await sleep(opts.pauseMs ?? 600); // respeita o limite de requisições/segundo do provedor
  }
  const left = await db.campaignRecipient.count({ where: { campaignId: id, status: "PENDENTE" } });
  if (!left) await db.campaign.updateMany({ where: { id, status: "ENVIANDO" }, data: { status: "CONCLUIDA", finishedAt: new Date(), nextRunAt: null } });
  return { sent, left, reason: "ok" };
}

/** Chamado pelo cron (a cada minuto): roda o disparo de todas as campanhas vencidas. */
export async function runDueCampaigns(now = new Date()) {
  const due = await db.campaign.findMany({
    where: { status: "ENVIANDO", channel: { not: "WHATSAPP_MANUAL" }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
    select: { id: true },
    take: 5,
  });
  const out: Record<string, unknown> = {};
  for (const { id } of due) out[id] = await runCampaignBatch(id, { now });
  return out;
}

export async function campaignCounts(id: string) {
  const g = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: true });
  const by = Object.fromEntries(g.map((x) => [x.status, x._count])) as Record<string, number>;
  const total = g.reduce((a, x) => a + x._count, 0);
  return { total, pendente: by.PENDENTE ?? 0, enviado: by.ENVIADO ?? 0, falhou: by.FALHOU ?? 0, pulado: by.PULADO ?? 0 };
}
