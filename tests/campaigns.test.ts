import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { normalizeWhatsapp, renderTemplate, varsFor, inWindow, nextWindowStart, runCampaignBatch, textToHtml, type Sender } from "@/lib/campaigns";
import { addCustomersToCampaign, audienceWhere } from "@/lib/campaign-audience";
import { unsubscribeByToken } from "@/lib/unsubscribe";

const db = new PrismaClient();
const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
const at = (s: string) => new Date(`${s}-03:00`);
const win = { windowStart: 480, windowEnd: 1200, weekdaysOnly: true };
let ids: string[] = [];

beforeAll(async () => {
  for (let i = 0; i < 5; i++) {
    const c = await db.customer.create({
      data: { type: "PF", name: `MARIA CAMPANHA ${uid} ${i}`, document: `CMP${uid}${i}`, email: i === 4 ? "invalido" : `m${i}-${uid}@t.test`, whatsapp: "(19) 98765-432" + i, consentMarketing: i !== 3 },
    });
    ids.push(c.id);
  }
});

describe("modelo e contatos", () => {
  it("preenche variáveis e normaliza celular", () => {
    const v = varsFor({ name: "MARIA DA SILVA" }, { make: "PORSCHE", model: "CAYENNE", plate: "ABC1D23" });
    expect(renderTemplate("Oi {primeiro_nome}, seu {carro} ({placa})", v)).toBe("Oi Maria, seu Porsche Cayenne (ABC1D23)");
    expect(normalizeWhatsapp("(19) 98765-4321")).toBe("5519987654321");
    expect(normalizeWhatsapp("+55 19 8765-4321")).toBe("5519987654321");
    expect(normalizeWhatsapp("(19) 3232-1234")).toBeNull(); // fixo
    expect(textToHtml("a <b>\n\n**x** https://a.b")).toContain("<strong>x</strong>");
    expect(textToHtml("<script>")).not.toContain("<script>");
  });
  it("respeita janela de horário e dias úteis (Brasília)", () => {
    expect(inWindow(win, at("2026-11-16T09:00:00"))).toBe(true); // segunda
    expect(inWindow(win, at("2026-11-16T07:59:00"))).toBe(false);
    expect(inWindow(win, at("2026-11-16T20:00:00"))).toBe(false);
    expect(inWindow(win, at("2026-11-15T10:00:00"))).toBe(false); // domingo
    expect(nextWindowStart(win, at("2026-11-14T10:00:00")).toISOString()).toBe(at("2026-11-16T08:00:00").toISOString());
  });
});

describe("motor de disparo", () => {
  it("envia em lotes, respeita intervalo, pula descadastrados e não envia em dobro", async () => {
    const camp = await db.campaign.create({ data: { name: `T ${uid}`, channel: "EMAIL", subject: "Oi {primeiro_nome}", body: "x", batchSize: 2, intervalMinutes: 10, weekdaysOnly: false, windowStart: 0, windowEnd: 1440, status: "ENVIANDO", appUrl: "https://app.test" } });
    // só consentidos
    const allowed = await db.customer.findMany({ where: { AND: [audienceWhere("EMAIL", {}), { id: { in: ids } }] }, select: { id: true } });
    expect(allowed.length).toBe(3); // sem consentimento (3) e e-mail sem @ (4) ficam fora
    const r = await addCustomersToCampaign(camp.id, "EMAIL", ids, {});
    expect(r).toEqual({ added: 4, invalid: 1 }); // inclusão manual: só e-mail inválido é barrado

    const calls: string[] = [];
    const sender: Sender = async ({ to, unsubscribeUrl }) => { calls.push(to); expect(unsubscribeUrl).toMatch(/^https:\/\/app\.test\/descadastro\/[a-f0-9]{64}$/); return { ok: true, id: "x" }; };
    const t0 = new Date();
    const b1 = await runCampaignBatch(camp.id, { now: t0, sender, pauseMs: 0 });
    expect(b1.sent).toBe(2);
    // mesmo instante: já reservado → não envia de novo
    expect((await runCampaignBatch(camp.id, { now: t0, sender, pauseMs: 0 })).sent).toBe(0);
    // 5 min depois ainda aguarda
    expect((await runCampaignBatch(camp.id, { now: new Date(t0.getTime() + 5 * 60_000), sender, pauseMs: 0 })).reason).toBe("aguardando");

    // cliente se descadastra antes do 2º lote
    const third = await db.campaignRecipient.findFirst({ where: { campaignId: camp.id, status: "PENDENTE" }, include: { customer: true }, orderBy: { createdAt: "asc" } });
    await unsubscribeByToken(third!.customer.marketingToken!, "teste");
    const b2 = await runCampaignBatch(camp.id, { now: new Date(t0.getTime() + 11 * 60_000), sender, pauseMs: 0 });
    expect(b2.sent).toBe(1);
    expect(new Set(calls).size).toBe(3);
    const c = await db.campaign.findUnique({ where: { id: camp.id } });
    expect(c?.status).toBe("CONCLUIDA");
    const cust = await db.customer.findUnique({ where: { id: third!.customerId } });
    expect(cust?.marketingOptOutAt).not.toBeNull();
    // descadastrado não entra em novas campanhas
    expect(await db.customer.count({ where: { AND: [audienceWhere("EMAIL", { base: "clientes" }), { id: third!.customerId }] } })).toBe(0);
  });

  it("falha temporária volta para a fila; definitiva marca como falhou", async () => {
    const camp = await db.campaign.create({ data: { name: `F ${uid}`, channel: "WHATSAPP_API", waTemplate: "t", body: "", batchSize: 10, intervalMinutes: 1, weekdaysOnly: false, windowStart: 0, windowEnd: 1440, status: "ENVIANDO" } });
    await db.customer.updateMany({ where: { id: { in: ids } }, data: { marketingOptOutAt: null } });
    await addCustomersToCampaign(camp.id, "WHATSAPP_API", ids.slice(0, 2), {});
    let n = 0;
    const sender: Sender = async () => (n++ === 0 ? { ok: false, error: "inválido" } : { ok: false, error: "limite", retry: true });
    await runCampaignBatch(camp.id, { sender, pauseMs: 0 });
    const rs = await db.campaignRecipient.findMany({ where: { campaignId: camp.id }, orderBy: { createdAt: "asc" } });
    expect(rs.map((r) => r.status).sort()).toEqual(["FALHOU", "PENDENTE"]);
  });
});

describe("editor de e-mail", () => {
  it("formata título, lista, botão, imagem e links com segurança", async () => {
    const { textToHtml, buildEmail, sanitizeEmailHtml } = await import("@/lib/campaigns");
    const h = textToHtml("# Oi {x}\n\n- a\n- b\n\n[[Agendar|https://wa.me/5519]]\n\n![arte](/arte/abc)\n\nVeja [site](https://one.com) e **já** _hoje_ www.one.com.br\n\n[mal](javascript:alert(1))", "https://app.test");
    expect(h).toContain("<h1");
    expect(h).toContain("<ul");
    expect(h).toContain('href="https://wa.me/5519"');
    expect(h).toContain('src="https://app.test/arte/abc"');
    expect(h).toContain("<strong>já</strong>");
    expect(h).toContain("<em>hoje</em>");
    expect(h).toContain('href="https://www.one.com.br"');
    expect(h).not.toContain("javascript:");
    const art = buildEmail({ mode: "ARTE", body: "Olá {primeiro_nome}", artUrl: "/arte/x", artAlt: "Promo", artLink: "https://one.com" }, { primeiro_nome: "Ana" }, { unsubscribeUrl: "https://app.test/descadastro/t", base: "https://app.test" });
    expect(art.html).toContain('<a href="https://one.com"><img src="https://app.test/arte/x" alt="Promo"');
    expect(art.text).toContain("Olá Ana");
    const html = buildEmail({ mode: "HTML", body: "", htmlBody: '<html><body><p onclick="x()">Oi {primeiro_nome}</p><script>alert(1)</script></body></html>' }, { primeiro_nome: "Ana" }, { unsubscribeUrl: "https://u/t" });
    expect(html.html).not.toMatch(/script|onclick/);
    expect(html.html).toContain("Oi Ana");
    expect(html.html).toContain("https://u/t");
    expect(sanitizeEmailHtml('<a href="javascript:x">a</a>')).toContain('href="#"');
  });
});
