import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { Tx } from "./db";
import { sha256 } from "./hash";
import { RuleError } from "./workflow";

const HOURS = 48;

export function checkPasswordStrength(p: string) {
  if (p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new RuleError("A senha deve ter ao menos 10 caracteres, com letras e números.");
}

/** Gera link de uso único (48 h) para o usuário definir a própria senha. Links anteriores deixam de valer. */
export async function createPasswordToken(tx: Tx, userId: string, purpose: "PRIMEIRO_ACESSO" | "REDEFINICAO", createdById?: string) {
  await tx.passwordToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomBytes(32).toString("base64url");
  await tx.passwordToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + HOURS * 3600_000), createdById } });
  return token;
}

export async function findValidToken(tx: Tx, token: string) {
  const t = await tx.passwordToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!t || t.usedAt || t.expiresAt < new Date() || !t.user.active) return null;
  return t;
}

export async function consumeToken(tx: Tx, token: string, password: string) {
  checkPasswordStrength(password);
  const t = await findValidToken(tx, token);
  if (!t) throw new RuleError("Link inválido ou expirado. Peça um novo ao administrador.");
  await tx.user.update({ where: { id: t.userId }, data: { passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null } });
  await tx.passwordToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
  await tx.session.deleteMany({ where: { userId: t.userId } });
  return t.user;
}

/** Hash impossível de acertar, para usuários criados sem senha (aguardando o link). */
export const unusableHash = () => bcrypt.hash(randomBytes(32).toString("hex"), 12);
