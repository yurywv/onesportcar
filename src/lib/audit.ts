import { db, type Tx } from "./db";

type AuditInput = {
  action: string;
  entity: string;
  entityId?: string | null;
  userId?: string | null;
  userName?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Grava no log de auditoria (append-only). Aceita transação para ficar atômico com a operação. */
export async function audit(input: AuditInput, tx: Tx | typeof db = db) {
  await tx.auditLog.create({
    data: { ...input, before: json(input.before), after: json(input.after) },
  });
}

/** Retorna só os campos alterados entre dois objetos, para o diff da auditoria. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const bv = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const av = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) { b[k] = bv; a[k] = av; }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
