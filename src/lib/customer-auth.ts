import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db, type Tx } from "./db";
import { audit } from "./audit";
import { sha256 } from "./hash";
import { requestMeta } from "./auth";

// Autenticação do app do cliente — separada da equipe (cookie, tabela de sessão e perfil próprios).
const COOKIE = "osc_cliente";
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const INVITE_DAYS = 7;
let DUMMY: string | undefined;

export type PortalCustomer = { id: string; name: string; document: string };

const onlyDigits = (v: string) => v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

export async function customerLogin(document: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const meta = await requestMeta();
  const doc = onlyDigits(document);
  const generic = "CPF/CNPJ ou senha inválidos.";
  const c = doc ? await db.customer.findUnique({ where: { document: doc } }) : null;
  if (!c || !c.active || !c.portalPasswordHash) {
    await bcrypt.compare(password, (DUMMY ??= await bcrypt.hash("dummy", 12)));
    return { ok: false, error: c && !c.portalPasswordHash ? "Seu acesso ainda não foi ativado. Peça o convite à recepção da OneSportCar." : generic };
  }
  if (c.portalLockedUntil && c.portalLockedUntil > new Date()) return { ok: false, error: "Acesso bloqueado temporariamente por excesso de tentativas. Tente em 15 minutos." };
  if (!(await bcrypt.compare(password, c.portalPasswordHash))) {
    const fails = c.portalFailed + 1;
    await db.customer.update({ where: { id: c.id }, data: { portalFailed: fails, portalLockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    await audit({ action: "LOGIN_FAIL", entity: "CustomerPortal", entityId: c.id, ...meta });
    return { ok: false, error: generic };
  }
  await startSession(c.id, meta);
  return { ok: true };
}

async function startSession(customerId: string, meta: { ip: string | null; userAgent: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.$transaction([
    db.customerSession.create({ data: { customerId, tokenHash: sha256(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent } }),
    db.customer.update({ where: { id: customerId }, data: { portalFailed: 0, portalLockedUntil: null, portalLastLoginAt: new Date() } }),
  ]);
  await audit({ action: "LOGIN", entity: "CustomerPortal", entityId: customerId, ...meta });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

export async function customerLogout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.customerSession.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}

export async function getCustomer(): Promise<PortalCustomer | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.customerSession.findUnique({ where: { tokenHash: sha256(token) }, include: { customer: true } });
  if (!s || s.expiresAt < new Date() || !s.customer.active) return null;
  return { id: s.customer.id, name: s.customer.name, document: s.customer.document };
}

export async function requireCustomer(): Promise<PortalCustomer> {
  const c = await getCustomer();
  if (!c) redirect("/cliente/entrar");
  return c;
}

/** Gera o link de convite (ou de nova senha). O token só existe no link; aqui fica o hash. */
export async function createPortalInvite(tx: Tx, customerId: string, userId: string) {
  await tx.customerPortalToken.updateMany({ where: { customerId, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomBytes(24).toString("base64url");
  await tx.customerPortalToken.create({ data: { customerId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000), createdById: userId } });
  return token;
}

export async function findInvite(token: string) {
  const t = await db.customerPortalToken.findUnique({ where: { tokenHash: sha256(token) }, include: { customer: true } });
  if (!t || t.usedAt || t.expiresAt < new Date() || !t.customer.active) return null;
  return t;
}

export async function activateWithInvite(token: string, password: string) {
  const t = await findInvite(token);
  if (!t) return { ok: false as const, error: "Convite inválido ou expirado. Peça um novo à recepção." };
  if (password.length < 8) return { ok: false as const, error: "A senha precisa ter pelo menos 8 caracteres." };
  await db.$transaction([
    db.customer.update({ where: { id: t.customerId }, data: { portalPasswordHash: await bcrypt.hash(password, 12), portalActivatedAt: new Date(), portalFailed: 0, portalLockedUntil: null } }),
    db.customerPortalToken.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
    db.customerSession.deleteMany({ where: { customerId: t.customerId } }),
  ]);
  await startSession(t.customerId, await requestMeta());
  return { ok: true as const };
}
