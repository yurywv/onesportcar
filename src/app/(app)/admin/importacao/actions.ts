"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { db } from "@/lib/db";
import { assertUser, AuthError } from "@/lib/auth";
import { run, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { ENTITY_ORDER, FIELDS, type ImportEntity } from "@/lib/import-fields";
import { stageRows, importRow, revertRow, auditImport, type RawRow } from "@/lib/importer";

const CHUNK = 150;
type Res<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Ações chamadas diretamente pelo navegador devolvem o erro como dado (em produção, exceções chegam sem mensagem). */
async function safe<T>(fn: () => Promise<T>): Promise<Res<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof RuleError || e instanceof AuthError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Erro inesperado no servidor. Tente novamente; se persistir, reduza o arquivo." };
  }
}

export async function createImportJob(input: { entity: ImportEntity; fileName: string; sheetName?: string; mapping: Record<string, number | null>; headers: string[]; totalRows: number }) {
  return safe(async () => {
    const user = await assertUser("admin:importar");
    if (!ENTITY_ORDER.includes(input.entity)) throw new RuleError("Cadastro inválido.");
    const missing = FIELDS[input.entity].filter((f) => f.required && input.mapping[f.key] == null);
    if (missing.length) throw new RuleError(`Mapeie os campos obrigatórios: ${missing.map((m) => m.label).join(", ")}.`);
    const mapping = Object.fromEntries(Object.entries(input.mapping).filter(([, v]) => v != null).map(([k, v]) => [k, input.headers[v!] ?? `coluna ${v! + 1}`]));
    const job = await db.$transaction(async (tx) => {
      const j = await tx.importJob.create({ data: { entity: input.entity, fileName: input.fileName.slice(0, 200), sheetName: input.sheetName, mapping, totalRows: input.totalRows, userId: user.id, userName: user.name } });
      await auditImport(tx, user, "IMPORT_START", j.id, { entity: input.entity, fileName: input.fileName, totalRows: input.totalRows, mapping });
      return j;
    });
    return { jobId: job.id };
  });
}

export async function stageImportRows(jobId: string, rows: RawRow[]) {
  return safe(async () => {
    await assertUser("admin:importar");
    if (rows.length > 1000) throw new RuleError("Lote grande demais.");
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status !== "VALIDANDO") throw new RuleError("Este lote não está em validação.");
    return db.$transaction((tx) => stageRows(tx, jobId, job.entity as ImportEntity, rows), { timeout: 60_000 });
  });
}

export async function finishValidation(jobId: string) {
  return safe(async () => {
    await assertUser("admin:importar");
    await db.importJob.update({ where: { id: jobId }, data: { status: "VALIDADO" } });
    revalidatePath("/admin/importacao");
    return {};
  });
}

/** Importa o próximo bloco de linhas válidas; o navegador chama em laço até não restar nenhuma. */
export async function importNextChunk(jobId: string) {
  return safe(async () => {
    const user = await assertUser("admin:importar");
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (!["VALIDADO", "IMPORTANDO"].includes(job.status)) throw new RuleError("Lote não está pronto para importar.");
    if (job.status === "VALIDADO") await db.importJob.update({ where: { id: jobId }, data: { status: "IMPORTANDO" } });
    const rows = await db.importRow.findMany({ where: { jobId, status: "VALIDO" }, orderBy: { rowNumber: "asc" }, take: CHUNK });
    let done = 0, failed = 0;
    for (const r of rows) {
      try {
        await db.$transaction(async (tx) => {
          const id = await importRow(tx, user, job.entity as ImportEntity, r.data as Record<string, unknown>);
          await tx.importRow.update({ where: { id: r.id }, data: { status: "IMPORTADO", targetId: id } });
        });
        done++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message.split("\n").filter(Boolean).slice(-1)[0] : "erro";
        await db.importRow.update({ where: { id: r.id }, data: { status: "ERRO", messages: { push: `Falha ao gravar: ${msg.slice(0, 300)}` } } });
      }
    }
    const remaining = await db.importRow.count({ where: { jobId, status: "VALIDO" } });
    if (!remaining) {
      await db.$transaction(async (tx) => {
        await tx.importJob.update({ where: { id: jobId }, data: { status: "IMPORTADO", importedAt: new Date() } });
        await auditImport(tx, user, "IMPORT_DONE", jobId, {
          entity: job.entity,
          imported: await tx.importRow.count({ where: { jobId, status: "IMPORTADO" } }),
          errors: await tx.importRow.count({ where: { jobId, status: "ERRO" } }),
        });
      });
      revalidatePath("/admin/importacao");
    }
    return { done, failed, remaining };
  });
}

/** Reverte o próximo bloco: apaga o que ainda não foi usado e mantém (com o motivo) o que já tem vínculos. */
export async function revertNextChunk(jobId: string) {
  return safe(async () => {
    const user = await assertUser("admin:importar");
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status !== "IMPORTADO") throw new RuleError("Só é possível reverter lotes importados.");
    const rows = await db.importRow.findMany({ where: { jobId, status: "IMPORTADO" }, orderBy: { rowNumber: "desc" }, take: CHUNK });
    let reverted = 0, blocked = 0;
    for (const r of rows) {
      const reason = await db.$transaction((tx) => revertRow(tx, user, job.entity as ImportEntity, r.targetId!, jobId.slice(0, 6)));
      if (reason) {
        blocked++;
        await db.importRow.update({ where: { id: r.id }, data: { status: "MANTIDO", messages: { push: `Não revertido: ${reason}` } } });
      } else {
        reverted++;
        await db.importRow.update({ where: { id: r.id }, data: { status: "REVERTIDO" } });
      }
    }
    const remaining = await db.importRow.count({ where: { jobId, status: "IMPORTADO" } });
    if (!remaining) {
      await db.$transaction(async (tx) => {
        await tx.importJob.update({ where: { id: jobId }, data: { status: "REVERTIDO", revertedAt: new Date() } });
        await auditImport(tx, user, "IMPORT_REVERT", jobId, {
          reverted: await tx.importRow.count({ where: { jobId, status: "REVERTIDO" } }),
          kept: await tx.importRow.count({ where: { jobId, status: "MANTIDO" } }),
        });
      });
      revalidatePath("/admin/importacao");
    }
    return { reverted, blocked, remaining };
  });
}

export async function discardJob(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("admin:importar");
    const id = String(fd.get("jobId"));
    const job = await db.importJob.findUniqueOrThrow({ where: { id } });
    if (!["VALIDANDO", "VALIDADO"].includes(job.status)) throw new RuleError("Só é possível descartar lotes ainda não importados.");
    await db.$transaction(async (tx) => {
      await tx.importRow.deleteMany({ where: { jobId: id } });
      await tx.importJob.update({ where: { id }, data: { status: "DESCARTADO" } });
      await auditImport(tx, user, "IMPORT_DISCARD", id, { entity: job.entity });
    });
    revalidatePath("/admin/importacao");
    return "Lote descartado. Nada foi gravado nos cadastros.";
  });
}
