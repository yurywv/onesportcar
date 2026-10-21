import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { userFromImportKey } from "@/lib/import-key";
import { ENTITY_ORDER, type ImportEntity } from "@/lib/import-fields";
import { stageRows, auditImport } from "@/lib/importer";

// Importação direta do SYSCAR: a página do SYSCAR (logada pelo usuário) lê os relatórios e envia as linhas para cá.
// As linhas entram em VALIDAÇÃO exatamente como num upload de planilha; nada é gravado nos cadastros até o
// administrador conferir o lote e clicar em "Importar" na tela de Importação.

export const maxDuration = 60;
const ORIGINS = ["https://apolo.syscar.com.br", "https://externo.syscar.com.br"];

function cors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  if (origin && ORIGINS.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  return res;
}
const json = (req: NextRequest, body: unknown, status = 200) => cors(req, NextResponse.json(body, { status }));

export function OPTIONS(req: NextRequest) {
  return cors(req, new NextResponse(null, { status: 204 }));
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), entity: z.string(), fileName: z.string().max(200), totalRows: z.number().int().min(0).max(500_000) }),
  z.object({ action: z.literal("rows"), jobId: z.string().uuid(), rows: z.array(z.object({ rowNumber: z.number().int(), values: z.record(z.string(), z.string().max(2000)) })).max(500) }),
  z.object({ action: z.literal("finish"), jobId: z.string().uuid() }),
]);

export async function POST(req: NextRequest) {
  const user = await userFromImportKey(req.headers.get("authorization"));
  if (!user) return json(req, { ok: false, error: "Chave de importação inválida ou expirada. Gere outra em Administração → Importação SYSCAR." }, 401);
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); } catch (e) { return json(req, { ok: false, error: `Requisição inválida: ${e instanceof Error ? e.message.slice(0, 300) : ""}` }, 400); }

  try {
    if (body.action === "start") {
      if (!ENTITY_ORDER.includes(body.entity as ImportEntity)) return json(req, { ok: false, error: "Cadastro inválido." }, 400);
      const job = await db.$transaction(async (tx) => {
        const j = await tx.importJob.create({ data: { entity: body.entity, fileName: body.fileName, sheetName: "SYSCAR direto", mapping: { origem: "Relatórios do SYSCAR (envio direto)" }, totalRows: body.totalRows, userId: user.id, userName: user.name } });
        await auditImport(tx, user, "IMPORT_START", j.id, { entity: body.entity, fileName: body.fileName, totalRows: body.totalRows, via: "SYSCAR direto" });
        return j;
      });
      return json(req, { ok: true, jobId: job.id });
    }
    const job = await db.importJob.findUnique({ where: { id: body.jobId } });
    if (!job || job.userId !== user.id) return json(req, { ok: false, error: "Lote não encontrado." }, 404);
    if (job.status !== "VALIDANDO") return json(req, { ok: false, error: "Este lote não está mais em validação." }, 409);
    if (body.action === "rows") {
      const counts = await db.$transaction((tx) => stageRows(tx, job.id, job.entity as ImportEntity, body.rows), { timeout: 60_000 });
      return json(req, { ok: true, ...counts });
    }
    await db.importJob.update({ where: { id: job.id }, data: { status: "VALIDADO" } });
    const grouped = await db.importRow.groupBy({ by: ["status"], where: { jobId: job.id }, _count: true });
    return json(req, { ok: true, jobId: job.id, summary: Object.fromEntries(grouped.map((g) => [g.status, g._count])) });
  } catch (e) {
    console.error(e);
    return json(req, { ok: false, error: "Erro no servidor ao validar as linhas." }, 500);
  }
}
