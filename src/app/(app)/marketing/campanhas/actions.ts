"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { CampaignChannel } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, req, int, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import {
  MAX_BATCH, emailConfigured, whatsappConfigured, parseHHMM, runCampaignBatch, senderFor,
  ensureMarketingToken, validEmail, normalizeWhatsapp, varsFor, type Vars,
} from "@/lib/campaigns";
import { FILTER_KEYS, addCustomersToCampaign, audienceWhere, type AudienceFilter } from "@/lib/campaign-audience";

const CHANNELS: CampaignChannel[] = ["EMAIL", "WHATSAPP_API", "WHATSAPP_MANUAL"];
const path = (id: string) => `/marketing/campanhas/${id}`;

async function appUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function load(id: string) {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) throw new RuleError("Campanha não encontrada.");
  return c;
}

export async function saveCampaign(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId: string | null = null;
  const r = await run(async () => {
    const user = await assertUser("marketing:campanhas");
    const id = str(fd, "id");
    const channel = (str(fd, "channel") ?? "EMAIL") as CampaignChannel;
    if (!CHANNELS.includes(channel)) throw new RuleError("Canal inválido.");
    if (id) {
      const cur = await load(id);
      if (cur.status === "ENVIANDO") throw new RuleError("Pause a campanha antes de editar.");
      if (["CONCLUIDA", "CANCELADA"].includes(cur.status)) throw new RuleError("Campanha encerrada não pode ser editada — duplique-a.");
      if (cur.channel !== channel && (await db.campaignRecipient.count({ where: { campaignId: id } })))
        throw new RuleError("Para trocar o canal, remova antes os destinatários (o contato muda: e-mail × celular).");
    }
    const batchSize = Math.max(1, Math.min(int(fd, "batchSize") ?? 50, MAX_BATCH[channel]));
    const intervalMinutes = Math.max(1, Math.min(int(fd, "intervalMinutes") ?? 10, 24 * 60));
    const windowStart = parseHHMM(str(fd, "windowStart"), 480);
    const windowEnd = parseHHMM(str(fd, "windowEnd"), 1200);
    if (windowEnd <= windowStart) throw new RuleError("O horário final precisa ser depois do inicial.");
    const imageUrl = str(fd, "imageUrl");
    if (imageUrl && !/^https:\/\//.test(imageUrl)) throw new RuleError("A imagem precisa ser um endereço https://.");
    const waTemplate = str(fd, "waTemplate");
    if (waTemplate && !/^[a-z0-9_]+$/.test(waTemplate)) throw new RuleError("Nome do modelo da Meta: só letras minúsculas, números e _ (ex.: revisao_lembrete).");
    const isEmail = channel === "EMAIL";
    const emailMode = isEmail ? (["TEXTO", "ARTE", "HTML"].includes(str(fd, "emailMode") ?? "") ? str(fd, "emailMode")! : "TEXTO") : "TEXTO";
    const artId = isEmail && emailMode === "ARTE" ? str(fd, "artId") : null;
    if (artId && !(await db.campaignAsset.findUnique({ where: { id: artId }, select: { id: true } }))) throw new RuleError("Arte não encontrada. Envie a imagem de novo.");
    const artLink = isEmail && emailMode === "ARTE" ? str(fd, "artLink") : null;
    if (artLink && !/^(https?:\/\/|www\.|mailto:|tel:)/i.test(artLink)) throw new RuleError("Link da arte: use um endereço completo (https://…), mailto: ou tel:.");
    const htmlBody = isEmail && emailMode === "HTML" ? str(fd, "htmlBody") : null;
    if (htmlBody && htmlBody.length > 400_000) throw new RuleError("HTML muito grande (máx. 400 KB). Hospede as imagens e use os links.");
    const bodyRaw = (str(fd, "body") ?? "").replace(/\r\n?/g, "\n");
    if (isEmail && emailMode === "TEXTO" && !bodyRaw) throw new RuleError("Preencha: Conteúdo do e-mail.");
    if (isEmail && emailMode === "ARTE" && !artId) throw new RuleError("Envie a arte (imagem) do e-mail.");
    if (isEmail && emailMode === "HTML" && !htmlBody) throw new RuleError("Cole ou importe o HTML do e-mail.");
    if (channel === "WHATSAPP_MANUAL" && !bodyRaw) throw new RuleError("Preencha: Mensagem.");
    const data = {
      name: req(fd, "name", "Nome da campanha"),
      channel,
      subject: isEmail ? req(fd, "subject", "Assunto do e-mail") : null,
      body: bodyRaw,
      imageUrl: isEmail && emailMode === "TEXTO" ? imageUrl : null,
      emailMode, artId, artLink, htmlBody,
      artAlt: isEmail && emailMode === "ARTE" ? str(fd, "artAlt") : null,
      preheader: isEmail ? str(fd, "preheader") : null,
      waTemplate: channel === "WHATSAPP_API" ? waTemplate : null,
      waLanguage: str(fd, "waLanguage") ?? "pt_BR",
      waParams: channel === "WHATSAPP_API" ? str(fd, "waParams") : null,
      batchSize, intervalMinutes, windowStart, windowEnd, weekdaysOnly: bool(fd, "weekdaysOnly"),
    };
    if (channel === "WHATSAPP_API" && !data.waTemplate) throw new RuleError("Informe o nome do modelo aprovado pela Meta.");
    const c = id
      ? await db.campaign.update({ where: { id }, data })
      : await db.campaign.create({ data: { ...data, createdById: user.id, createdByName: user.name } });
    await audit({ action: id ? "UPDATE" : "CREATE", entity: "Campaign", entityId: c.id, userId: user.id, userName: user.name, after: { name: c.name, channel } });
    if (artId) await db.campaignAsset.updateMany({ where: { id: artId, campaignId: null }, data: { campaignId: c.id } });
    if (!id) newId = c.id;
    revalidatePath("/marketing/campanhas");
    revalidatePath(path(c.id));
    return "Campanha salva.";
  });
  if (newId) redirect(`${path(newId)}?aba=publico`);
  return r;
}

export async function duplicateCampaign(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId = "";
  const r = await run(async () => {
    const user = await assertUser("marketing:campanhas");
    const c = await load(req(fd, "id", "Campanha"));
    const copy = await db.campaign.create({
      data: {
        name: `${c.name} (cópia)`, channel: c.channel, subject: c.subject, body: c.body, imageUrl: c.imageUrl,
        emailMode: c.emailMode, preheader: c.preheader, artId: c.artId, artAlt: c.artAlt, artLink: c.artLink, htmlBody: c.htmlBody, waTemplate: c.waTemplate, waLanguage: c.waLanguage,
        waParams: c.waParams, batchSize: c.batchSize, intervalMinutes: c.intervalMinutes, windowStart: c.windowStart, windowEnd: c.windowEnd,
        weekdaysOnly: c.weekdaysOnly, createdById: user.id, createdByName: user.name,
      },
    });
    newId = copy.id;
    return "Campanha duplicada.";
  });
  if (newId) redirect(path(newId));
  return r;
}

function filtersFrom(fd: FormData): AudienceFilter {
  const f: AudienceFilter = {};
  for (const k of FILTER_KEYS) f[k] = str(fd, `f_${k}`) ?? undefined;
  return f;
}

export async function addRecipients(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await assertUser("marketing:campanhas");
    const c = await load(req(fd, "id", "Campanha"));
    if (["CONCLUIDA", "CANCELADA"].includes(c.status)) throw new RuleError("Campanha encerrada.");
    const f = filtersFrom(fd);
    const mode = str(fd, "mode");
    let ids: string[];
    if (mode === "todos") {
      const all = await db.customer.findMany({ where: audienceWhere(c.channel, f), select: { id: true }, take: 20000 });
      ids = all.map((x) => x.id);
    } else {
      ids = fd.getAll("cid").map(String).filter(Boolean);
      if (!ids.length) throw new RuleError("Marque ao menos um cliente.");
      // segurança: só aceita quem atende ao filtro (sem descadastrados)
      const ok = await db.customer.findMany({ where: { AND: [audienceWhere(c.channel, f), { id: { in: ids } }] }, select: { id: true } });
      ids = ok.map((x) => x.id);
    }
    let added = 0, invalid = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const r = await addCustomersToCampaign(c.id, c.channel, ids.slice(i, i + 500), f);
      added += r.added; invalid += r.invalid;
    }
    if (c.status === "CONCLUIDA") await db.campaign.update({ where: { id: c.id }, data: { status: "PAUSADA" } });
    revalidatePath(path(c.id));
    return `${added} cliente(s) incluído(s).${invalid ? ` ${invalid} ignorado(s) por contato inválido.` : ""}${ids.length - added - invalid > 0 ? ` ${ids.length - added - invalid} já estavam na lista.` : ""}`;
  });
}

export async function removeRecipient(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await assertUser("marketing:campanhas");
    const id = req(fd, "id", "Campanha");
    const rid = str(fd, "rid");
    const r = await db.campaignRecipient.deleteMany({ where: { campaignId: id, status: "PENDENTE", ...(rid ? { id: rid } : {}) } });
    revalidatePath(path(id));
    return rid ? "Removido." : `${r.count} destinatário(s) pendente(s) removido(s).`;
  });
}

export async function sendTest(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await assertUser("marketing:campanhas");
    const c = await load(req(fd, "id", "Campanha"));
    const raw = req(fd, "to", "Destino do teste");
    const sample = await db.campaignRecipient.findFirst({ where: { campaignId: c.id }, orderBy: { createdAt: "asc" } });
    const vars: Vars = (sample?.vars as Vars) ?? varsFor({ name: "Cliente Exemplo" }, { make: "Porsche", model: "911 Carrera", plate: "ABC1D23" });
    const base = await appUrl();
    if (c.channel === "WHATSAPP_MANUAL") throw new RuleError("No envio assistido o teste é o próprio botão do WhatsApp na fila.");
    const to = c.channel === "EMAIL" ? (validEmail(raw) ? raw.trim() : null) : normalizeWhatsapp(raw);
    if (!to) throw new RuleError(c.channel === "EMAIL" ? "E-mail inválido." : "Celular inválido (use DDD + número).");
    const res = await senderFor(c.channel)!({ campaign: { ...c, subject: c.subject ? `[TESTE] ${c.subject}` : c.subject }, to, vars, unsubscribeUrl: `${base}/descadastro/teste-sem-efeito-000000`, idempotencyKey: `teste-${c.id}-${Date.now()}` });
    if (!res.ok) throw new RuleError(`Falha no teste: ${res.error}`);
    return `Teste enviado para ${to}${sample ? ` (com os dados de ${sample.name})` : ""}.`;
  });
}

export async function startCampaign(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("marketing:campanhas");
    const c = await load(req(fd, "id", "Campanha"));
    if (!["RASCUNHO", "PAUSADA"].includes(c.status)) throw new RuleError("Esta campanha não pode ser iniciada agora.");
    if (c.channel === "EMAIL" && !emailConfigured()) throw new RuleError("E-mail ainda não configurado na Vercel (RESEND_API_KEY e MAIL_FROM).");
    if (c.channel === "EMAIL") {
      const { emailReadiness } = await import("@/lib/send-readiness");
      const r = await emailReadiness();
      const bad = r.checks.filter((x) => x.ok === false);
      if (bad.length) throw new RuleError(`O e-mail ainda não está pronto: ${bad.map((b) => `${b.label} (${b.detail})`).join("; ")}. Veja Configurações de envio.`);
    }
    if (c.channel === "WHATSAPP_API" && !(await whatsappConfigured())) throw new RuleError("WhatsApp API ainda não configurado (WHATSAPP_TOKEN na Vercel e ID do número em Configurações de envio).");
    const pending = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "PENDENTE" } });
    if (!pending) throw new RuleError("Nenhum destinatário pendente. Inclua clientes na aba Público.");
    await db.campaign.update({ where: { id: c.id }, data: { status: "ENVIANDO", appUrl: await appUrl(), startedAt: c.startedAt ?? new Date(), nextRunAt: null } });
    await audit({ action: "UPDATE", entity: "Campaign", entityId: c.id, userId: user.id, userName: user.name, after: { status: "ENVIANDO", pending } });
    revalidatePath(path(c.id));
    revalidatePath("/marketing/campanhas");
    return c.channel === "WHATSAPP_MANUAL" ? "Fila liberada. Use os botões de WhatsApp abaixo." : `Envio iniciado: ${pending} pendente(s), ${c.batchSize} a cada ${c.intervalMinutes} min.`;
  });
}

export async function setCampaignStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("marketing:campanhas");
    const c = await load(req(fd, "id", "Campanha"));
    const to = str(fd, "to");
    if (to === "PAUSADA" && c.status === "ENVIANDO") await db.campaign.update({ where: { id: c.id }, data: { status: "PAUSADA" } });
    else if (to === "CANCELADA" && !["CONCLUIDA", "CANCELADA"].includes(c.status)) {
      await db.$transaction([
        db.campaign.update({ where: { id: c.id }, data: { status: "CANCELADA", finishedAt: new Date(), nextRunAt: null } }),
        db.campaignRecipient.updateMany({ where: { campaignId: c.id, status: "PENDENTE" }, data: { status: "PULADO", error: "Campanha cancelada" } }),
      ]);
    } else throw new RuleError("Ação indisponível neste status.");
    await audit({ action: "UPDATE", entity: "Campaign", entityId: c.id, userId: user.id, userName: user.name, after: { status: to } });
    revalidatePath(path(c.id));
    revalidatePath("/marketing/campanhas");
    return to === "PAUSADA" ? "Campanha pausada." : "Campanha cancelada.";
  });
}

export async function retryFailed(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await assertUser("marketing:campanhas");
    const c = await load(req(fd, "id", "Campanha"));
    const r = await db.campaignRecipient.updateMany({ where: { campaignId: c.id, status: "FALHOU" }, data: { status: "PENDENTE", attempts: 0 } });
    if (c.status === "CONCLUIDA") await db.campaign.update({ where: { id: c.id }, data: { status: "PAUSADA" } });
    revalidatePath(path(c.id));
    return `${r.count} falha(s) voltaram para a fila. Inicie/retome o envio.`;
  });
}

/** Chamado pela tela aberta a cada 30 s — garante o envio mesmo sem o cron da Vercel. */
export async function tickCampaign(id: string) {
  await assertUser("marketing:campanhas");
  const r = await runCampaignBatch(id);
  return r;
}

// ─── Envio assistido (WhatsApp manual) ───
export async function markManual(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("marketing:campanhas");
    const id = req(fd, "id", "Campanha");
    const rid = req(fd, "rid", "Destinatário");
    const how = str(fd, "how");
    const r = await db.campaignRecipient.findFirst({ where: { id: rid, campaignId: id } });
    if (!r) throw new RuleError("Destinatário não encontrado.");
    if (how === "optout") {
      const token = await ensureMarketingToken(r.customerId);
      const { unsubscribeByToken } = await import("@/lib/unsubscribe");
      await unsubscribeByToken(token, `WhatsApp — registrado por ${user.name}`);
    } else {
      await db.campaignRecipient.update({ where: { id: rid }, data: how === "skip" ? { status: "PULADO", error: "Pulado no envio assistido" } : { status: "ENVIADO", sentAt: new Date(), attempts: { increment: 1 } } });
    }
    const left = await db.campaignRecipient.count({ where: { campaignId: id, status: "PENDENTE" } });
    if (!left) await db.campaign.update({ where: { id }, data: { status: "CONCLUIDA", finishedAt: new Date() } });
    revalidatePath(path(id));
    return how === "optout" ? "Cliente descadastrado." : how === "skip" ? "Pulado." : "Marcado como enviado.";
  });
}

// ─── Imagens do e-mail (arte pronta e imagens no meio do texto) ───
const MAGIC: [string, (b: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/gif", (b) => b.subarray(0, 4).toString() === "GIF8"],
  ["image/webp", (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP"],
];

export async function uploadCampaignAsset(fd: FormData): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
  try {
    const user = await assertUser("marketing:campanhas");
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) return { ok: false, error: "Escolha uma imagem." };
    if (f.size > 3.5 * 1024 * 1024) return { ok: false, error: "Imagem acima de 3,5 MB. Exporte em JPG com qualidade menor (ou largura de 1200 px)." };
    const buf = Buffer.from(await f.arrayBuffer());
    const mime = MAGIC.find(([, t]) => t(buf))?.[0];
    if (!mime) return { ok: false, error: "Formato não aceito. Use JPG, PNG, GIF ou WebP." };
    const w = Number(fd.get("width")) || null, h = Number(fd.get("height")) || null;
    const campaignId = (fd.get("campaignId") as string) || null;
    const a = await db.campaignAsset.create({
      data: { fileName: f.name.slice(0, 200), mime, size: buf.length, width: w, height: h, data: buf, createdBy: user.name, campaignId: campaignId && (await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true } })) ? campaignId : null },
      select: { id: true },
    });
    return { ok: true, id: a.id, url: `/arte/${a.id}` };
  } catch (e) {
    if (e instanceof RuleError || e instanceof AuthError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Não foi possível enviar a imagem." };
  }
}
