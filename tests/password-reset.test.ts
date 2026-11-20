import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Map() }));

const db = new PrismaClient();
const uid = Math.random().toString(36).slice(2, 8);
const meta = { ip: `10.0.0.${Math.floor(Math.random() * 200)}`, userAgent: "vitest" };
let userId = "";
const sent: { to: string[]; html: string }[] = [];

beforeAll(async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "One <nao-responda@onesportcar.com.br>";
  const c = await db.company.create({ data: { name: "T", document: `R${uid}` } });
  const b = await db.branch.create({ data: { companyId: c.id, code: `R${uid}`, name: "T" } });
  userId = (await db.user.create({ data: { branchId: b.id, name: "Yury Teste", email: `yury-${uid}@t.test`, passwordHash: "x", role: "ADMIN" } })).id;
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
  }));
});
afterEach(() => { sent.length = 0; });

describe("esqueci minha senha", () => {
  it("envia link de 15 minutos só para e-mail cadastrado e limita pedidos", async () => {
    const { requestStaffReset } = await import("@/lib/password-reset");
    const r = await requestStaffReset(`YURY-${uid}@t.test`, "https://app.test", meta);
    expect(r.sent).toBe(true);
    expect(sent[0].to).toEqual([`yury-${uid}@t.test`]);
    const link = sent[0].html.match(/https:\/\/app\.test\/definir-senha\/[\w-]+/)![0];
    const t = await db.passwordToken.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: "desc" } });
    const mins = (t!.expiresAt.getTime() - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThanOrEqual(15);
    expect(link).toBeTruthy();

    // e-mail inexistente: nada enviado (e a tela responde igual)
    const n = await requestStaffReset(`ninguem-${uid}@t.test`, "https://app.test", meta);
    expect(n.sent).toBe(false);
    expect(sent.length).toBe(1);

    // novo link invalida o anterior; 3 por conta a cada 15 min
    await requestStaffReset(`yury-${uid}@t.test`, "https://app.test", meta);
    await requestStaffReset(`yury-${uid}@t.test`, "https://app.test", meta);
    expect(await db.passwordToken.count({ where: { userId, usedAt: null } })).toBe(1);
    const lim = await requestStaffReset(`yury-${uid}@t.test`, "https://app.test", meta);
    expect(lim).toMatchObject({ sent: false, reason: "limite" });
  });

  it("link usado define a senha e não vale de novo", async () => {
    const { requestStaffReset } = await import("@/lib/password-reset");
    const { consumeToken, findValidToken } = await import("@/lib/password");
    await db.passwordToken.deleteMany({ where: { userId } });
    await requestStaffReset(`yury-${uid}@t.test`, "https://x.test", { ...meta, ip: "10.9.9.9" });
    const token = sent[0].html.match(/definir-senha\/([\w-]+)/)![1];
    await db.$transaction((tx) => consumeToken(tx, token, "NovaSenha2026x"));
    expect(await findValidToken(db, token)).toBeNull();
  });
});
