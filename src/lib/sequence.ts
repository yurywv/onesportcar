import type { Tx } from "./db";

const PREFIX: Record<string, string> = { OS: "OS", ORC: "ORC", CHK: "CHK", REC: "REC" };

/** Próximo número da sequência (OS-000001...). Deve ser chamado dentro de uma transação: o UPDATE trava a linha. */
export async function nextNumber(tx: Tx, branchId: string, key: keyof typeof PREFIX) {
  const rows = await tx.$queryRaw<{ next: number; prefix: string; padding: number }[]>`
    INSERT INTO "NumberSequence" (id, "branchId", key, prefix, next, padding)
    VALUES (gen_random_uuid(), ${branchId}, ${key}, ${PREFIX[key]}, 2, 6)
    ON CONFLICT ("branchId", key) DO UPDATE SET next = "NumberSequence".next + 1
    RETURNING next - 1 AS next, prefix, padding`;
  const r = rows[0];
  return `${r.prefix}-${String(r.next).padStart(r.padding, "0")}`;
}
