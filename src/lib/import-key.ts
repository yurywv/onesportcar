import "server-only";
import { randomBytes } from "crypto";
import { db } from "./db";
import { sha256 } from "./hash";
import { can } from "./rbac";
import type { SessionUser } from "./auth";

// Chave temporária da importação direta do SYSCAR: o administrador gera, a página do SYSCAR usa.
export const IMPORT_KEY_HOURS = 4;

export async function createImportKey(user: SessionUser) {
  const token = `osc_imp_${randomBytes(24).toString("base64url")}`;
  await db.importKey.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await db.importKey.create({ data: { tokenHash: sha256(token), userId: user.id, userName: user.name, expiresAt: new Date(Date.now() + IMPORT_KEY_HOURS * 3600_000) } });
  return token;
}

/** Valida a chave e devolve o usuário dono (precisa continuar ativo e com permissão de importar). */
export async function userFromImportKey(header: string | null): Promise<SessionUser | null> {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (!token?.startsWith("osc_imp_")) return null;
  const key = await db.importKey.findUnique({ where: { tokenHash: sha256(token) } });
  if (!key || key.revokedAt || key.expiresAt < new Date()) return null;
  const u = await db.user.findUnique({ where: { id: key.userId } });
  if (!u || !u.active || !can(u.role, "admin:importar")) return null;
  await db.importKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branchId };
}
