import "server-only";
import { db } from "./db";
import { audit } from "./audit";
import { createPasswordToken } from "./password";
import { createPortalInvite } from "./customer-auth";
import { sendMail, resetEmail } from "./mailer";

export const RESET_MINUTES = 15;
const MAX_PER_ACCOUNT = 3; // pedidos por conta a cada 15 min
const MAX_PER_IP = 10; // pedidos por IP a cada 15 min

const since = () => new Date(Date.now() - RESET_MINUTES * 60_000);

async function ipBlocked(ip: string | null) {
  if (!ip) return false;
  const n = await db.auditLog.count({ where: { action: "PASSWORD_RESET_REQUEST", ip, createdAt: { gte: since() } } });
  return n >= MAX_PER_IP;
}

/**
 * Esqueci minha senha (equipe): se o e-mail for de um usuário ativo, envia link de 15 minutos.
 * A resposta para a tela é sempre a mesma — não revela quais e-mails existem.
 */
export async function requestStaffReset(emailRaw: string, base: string, meta: { ip: string | null; userAgent: string | null }, by?: { id: string; name: string }) {
  const email = emailRaw.trim().toLowerCase();
  await audit({ action: "PASSWORD_RESET_REQUEST", entity: "User", after: { email, by: by?.name }, userId: by?.id, userName: by?.name, ...meta });
  if (!by && (await ipBlocked(meta.ip))) return { sent: false, reason: "limite" as const };
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, active: true } });
  if (!user || !user.active) return { sent: false, reason: "inexistente" as const };
  const recent = await db.passwordToken.count({ where: { userId: user.id, purpose: "REDEFINICAO_EMAIL", createdAt: { gte: since() } } });
  if (!by && recent >= MAX_PER_ACCOUNT) return { sent: false, reason: "limite" as const };
  const token = await db.$transaction((tx) => createPasswordToken(tx, user.id, "REDEFINICAO_EMAIL", by?.id, RESET_MINUTES));
  const link = `${base.replace(/\/$/, "")}/definir-senha/${token}`;
  const r = await sendMail({ to: user.email, ...resetEmail({ name: user.name, link, minutes: RESET_MINUTES, who: "equipe" }) });
  await audit({ action: r.ok ? "PASSWORD_RESET_SENT" : "PASSWORD_RESET_FAIL", entity: "User", entityId: user.id, userId: by?.id, userName: by?.name, after: { email: user.email, error: r.ok ? undefined : r.error }, ...meta });
  return r.ok ? { sent: true as const, email: user.email } : { sent: false as const, reason: "falha_envio" as const, error: r.error };
}

/** Esqueci minha senha (app do cliente): por CPF/CNPJ, para o e-mail cadastrado. */
export async function requestCustomerReset(documentRaw: string, base: string, meta: { ip: string | null; userAgent: string | null }) {
  const doc = documentRaw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  await audit({ action: "PASSWORD_RESET_REQUEST", entity: "CustomerPortal", after: { document: doc.slice(0, 3) + "***" }, ...meta });
  if (await ipBlocked(meta.ip)) return { sent: false, reason: "limite" as const };
  const c = doc ? await db.customer.findUnique({ where: { document: doc }, select: { id: true, name: true, email: true, active: true } }) : null;
  if (!c || !c.active || !c.email || !/@/.test(c.email)) return { sent: false, reason: "inexistente" as const };
  const recent = await db.customerPortalToken.count({ where: { customerId: c.id, createdById: "autoatendimento", createdAt: { gte: since() } } });
  if (recent >= MAX_PER_ACCOUNT) return { sent: false, reason: "limite" as const };
  const token = await db.$transaction((tx) => createPortalInvite(tx, c.id, "autoatendimento", RESET_MINUTES));
  const link = `${base.replace(/\/$/, "")}/cliente/ativar/${token}`;
  const r = await sendMail({ to: c.email.trim(), ...resetEmail({ name: c.name, link, minutes: RESET_MINUTES, who: "cliente" }) });
  await audit({ action: r.ok ? "PASSWORD_RESET_SENT" : "PASSWORD_RESET_FAIL", entity: "CustomerPortal", entityId: c.id, after: { error: r.ok ? undefined : r.error }, ...meta });
  return r.ok ? { sent: true as const } : { sent: false as const, reason: "falha_envio" as const };
}

export const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_, a: string, b: string, c: string) => a + "*".repeat(Math.min(b.length, 6)) + c);
