import type { Tx } from "./db";

const PREFIX: Record<string, string> = { OS: "OS", ORC: "ORC", CHK: "CHK", REC: "REC", PED: "PED", TIT: "TIT", PAG: "PAG" };
/** Unidade cujo número não leva o código da unidade (a matriz). As demais geram, por exemplo, OS-FIL1-000001. */
const MAIN_BRANCH_CODE = "MTZ";

/** Próximo número da sequência (OS-000001...). Deve ser chamado dentro de uma transação: o UPDATE trava a linha. */
export async function nextNumber(tx: Tx, branchId: string, key: keyof typeof PREFIX) {
  const rows = await tx.$queryRaw<{ next: number; prefix: string; padding: number; code: string }[]>`
    WITH s AS (
      INSERT INTO "NumberSequence" (id, "branchId", key, prefix, next, padding)
      VALUES (gen_random_uuid(), ${branchId}, ${key}, ${PREFIX[key]}, 2, 6)
      ON CONFLICT ("branchId", key) DO UPDATE SET next = "NumberSequence".next + 1
      RETURNING next - 1 AS next, prefix, padding, "branchId"
    )
    SELECT s.next, s.prefix, s.padding, b.code FROM s JOIN "Branch" b ON b.id = s."branchId"`;
  const r = rows[0];
  const branch = r.code === MAIN_BRANCH_CODE ? "" : `${r.code}-`;
  return `${r.prefix}-${branch}${String(r.next).padStart(r.padding, "0")}`;
}
