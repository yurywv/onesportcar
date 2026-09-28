import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Lista de linhas com problema para correção no SYSCAR (inclui dados pessoais: acesso restrito e auditado). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || !can(user.role, "admin:importar")) return new Response("Sem permissão", { status: 403 });
  const { id } = await params;
  const rows = await db.importRow.findMany({ where: { jobId: id, status: { in: ["INVALIDO", "DUPLICADO", "ERRO", "MANTIDO"] } }, orderBy: { rowNumber: "asc" } });
  await audit({ action: "EXPORT", entity: "ImportJob", entityId: id, userId: user.id, userName: user.name, after: { rows: rows.length } });
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.data as object)))];
  const lines = [["linha", "situacao", "mensagens", ...keys].map(esc).join(";"), ...rows.map((r) => [r.rowNumber, r.status, r.messages.join(" | "), ...keys.map((k) => (r.data as Record<string, unknown>)[k])].map(esc).join(";"))];
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="importacao-${id.slice(0, 8)}-problemas.csv"`, "Cache-Control": "no-store" },
  });
}
