"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { run, str, req, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { normalizeWhatsapp, sendWhatsappTemplate, renderTemplate, varsFor, type Vars } from "@/lib/campaigns";
import { getSetting } from "@/lib/settings";

async function varsForCustomer(customerId: string | null): Promise<Vars> {
  if (!customerId) return {};
  const c = await db.customer.findUnique({
    where: { id: customerId },
    select: { name: true, type: true, tradeName: true, marketingOptOutAt: true, vehicles: { where: { active: true }, select: { make: true, model: true, plate: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!c) throw new RuleError("Cliente não encontrado.");
  return varsFor(c, c.vehicles[0]);
}

/** Envio assistido: a tela abre o wa.me na hora (sem bloqueio de pop-up) e registra aqui. */
export async function logManualWhatsapp(input: { to: string; customerId?: string | null; body: string }) {
  const user = await assertUser("marketing:campanhas");
  const to = normalizeWhatsapp(input.to);
  if (!to) return { ok: false as const };
  await db.messageLog.create({
    data: { channel: "WHATSAPP_MANUAL", to, customerId: input.customerId || null, body: input.body.slice(0, 4000), status: "ABERTO", fromNumber: await getSetting("whatsapp.numero"), userId: user.id, userName: user.name },
  });
  revalidatePath("/marketing/whatsapp");
  return { ok: true as const };
}

/** API oficial: envia um modelo aprovado pela Meta (mensagem iniciada pela empresa exige modelo). */
export async function sendQuickTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("marketing:campanhas");
    const to = normalizeWhatsapp(req(fd, "to", "Celular"));
    if (!to) throw new RuleError("Celular inválido (use DDD + número).");
    const customerId = str(fd, "customerId");
    if (customerId) {
      const c = await db.customer.findUnique({ where: { id: customerId }, select: { marketingOptOutAt: true } });
      if (c?.marketingOptOutAt) throw new RuleError("Este cliente pediu para não receber mensagens de campanha.");
    }
    const template = req(fd, "template", "Modelo aprovado");
    if (!/^[a-z0-9_]+$/.test(template)) throw new RuleError("Nome do modelo: letras minúsculas, números e _.");
    const vars = await varsForCustomer(customerId);
    const params = (str(fd, "params") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((p) => (vars as Record<string, string>)[p] ?? renderTemplate(p, vars));
    const res = await sendWhatsappTemplate(to, template, str(fd, "language") ?? "pt_BR", params);
    await db.messageLog.create({
      data: { channel: "WHATSAPP_API", to, customerId, body: `[modelo ${template}] ${params.join(" | ")}`, template, status: res.ok ? "ENVIADO" : "FALHOU", providerId: res.ok ? res.id : null, error: res.ok ? null : res.error, fromNumber: await getSetting("whatsapp.numero"), userId: user.id, userName: user.name },
    });
    revalidatePath("/marketing/whatsapp");
    if (!res.ok) throw new RuleError(res.error);
    return `Mensagem enviada para +${to}.`;
  });
}
