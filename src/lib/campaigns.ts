import { randomBytes } from "crypto";
import type { Campaign, CampaignChannel, Prisma } from "@prisma/client";
import { db } from "./db";
import { emailHtml, inWindow, MAX_BATCH, nextWindowStart, normalizeWhatsapp, renderTemplate, validEmail, type Vars } from "./campaign-template";

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
export const whatsappConfigured = () => !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;

export const sendEmail: Sender = async ({ campaign, to, vars, unsubscribeUrl, idempotencyKey }) => {
  if (!emailConfigured()) return { ok: false, error: "E-mail não configurado (RESEND_API_KEY / MAIL_FROM)." };
  const body = renderTemplate(campaign.body, vars);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [to],
      reply_to: process.env.MAIL_REPLY_TO || undefined,
      subject: renderTemplate(campaign.subject ?? campaign.name, vars),
      html: emailHtml({ body, imageUrl: campaign.imageUrl, unsubscribeUrl }),
      text: `${body}\n\n—\nPara não receber mais: ${unsubscribeUrl}`,
      headers: { "List-Unsubscribe": `<${unsubscribeUrl.replace("/descadastro/", "/api/descadastro/")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campanha", value: campaign.id.replace(/[^a-zA-Z0-9_-]/g, "") }],
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (res.ok) return { ok: true, id: j.id };
  return { ok: false, error: `Resend ${res.status}: ${j.message ?? "erro"}`, retry: res.status === 429 || res.status >= 500 };
};

export const sendWhatsapp: Sender = async ({ campaign, to, vars }) => {
  if (!whatsappConfigured()) return { ok: false, error: "WhatsApp não configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)." };
  if (!campaign.waTemplate) return { ok: false, error: "Campanha sem modelo aprovado da Meta." };
  const params = (campaign.waParams ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const components = params.length
    ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: (vars as Record<string, string>)[p] || "-" })) }]
    : [];
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: campaign.waTemplate, language: { code: campaign.waLanguage }, components } }),
  });
  const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (res.ok) return { ok: true, id: j.messages?.[0]?.id };
  return { ok: false, error: `WhatsApp ${res.status}: ${j.error?.message ?? "erro"}`, retry: res.status === 429 || res.status >= 500 };
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
