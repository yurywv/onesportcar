import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { can, type Permission } from "./rbac";
import { audit } from "./audit";
import { sha256 } from "./hash";

const COOKIE = "osc_session";
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
let DUMMY_HASH: string | undefined;

export type SessionUser = { id: string; name: string; email: string; role: Role; branchId: string };


export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent"),
  };
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const meta = await requestMeta();
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  const generic = "E-mail ou senha inválidos.";
  if (!user || !user.active) {
    await bcrypt.compare(password, (DUMMY_HASH ??= await bcrypt.hash("dummy", 12))); // tempo ~constante
    await audit({ action: "LOGIN_FAIL", entity: "User", after: { email }, ...meta });
    return { ok: false, error: generic };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "Conta bloqueada temporariamente por excesso de tentativas. Tente mais tarde." };
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const fails = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await audit({ action: "LOGIN_FAIL", entity: "User", entityId: user.id, userName: user.name, ...meta });
    return { ok: false, error: generic };
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await db.$transaction([
    db.session.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent } }),
    db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }),
  ]);
  await audit({ action: "LOGIN", entity: "User", entityId: user.id, userId: user.id, userName: user.name, ...meta });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (s) {
      await db.session.delete({ where: { id: s.id } });
      await audit({ action: "LOGOUT", entity: "User", entityId: s.userId, userId: s.userId, userName: s.user.name });
    }
  }
  jar.delete(COOKIE);
}

export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || !s.user.active) return null;
  const { id, name, email, role, branchId } = s.user;
  return { id, name, email, role, branchId };
}

/** Para páginas: redireciona ao login ou mostra 403. */
export async function requireUser(perm?: Permission): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (perm && !can(u.role, perm)) redirect("/sem-permissao");
  return u;
}

export class AuthError extends Error {}

/** Para server actions / APIs: lança erro em vez de redirecionar. */
export async function assertUser(perm?: Permission): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new AuthError("Sessão expirada. Entre novamente.");
  if (perm && !can(u.role, perm)) throw new AuthError("Você não tem permissão para esta operação.");
  return u;
}

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
