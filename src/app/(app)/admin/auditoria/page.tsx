import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { PageHeader, Empty, Pager } from "@/components/ui";

export const metadata = { title: "Auditoria" };
const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entidade?: string; acao?: string; usuario?: string; p?: string }> }) {
  await requireUser("auditoria:ver");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const where: Prisma.AuditLogWhereInput = {
    entity: sp.entidade || undefined, action: sp.acao || undefined,
    userName: sp.usuario ? { contains: sp.usuario, mode: "insensitive" } : undefined,
  };
  const [rows, total, entities] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["entity"], _count: true }),
  ]);
  return (
    <>
      <PageHeader title="Auditoria" subtitle={`${total} registro(s) · append-only (UPDATE/DELETE bloqueados no banco)`} />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="entidade" defaultValue={sp.entidade ?? ""} className="select max-w-52"><option value="">Todas as entidades</option>{entities.map((e) => <option key={e.entity} value={e.entity}>{e.entity} ({e._count})</option>)}</select>
        <input name="acao" defaultValue={sp.acao} className="input max-w-40" placeholder="Ação (ex.: LOGIN)" />
        <input name="usuario" defaultValue={sp.usuario} className="input max-w-52" placeholder="Usuário" />
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table text-xs">
            <thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Antes</th><th>Depois</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{dateTime(l.createdAt)}</td>
                  <td>{l.userName ?? "—"}</td>
                  <td className="font-semibold">{l.action}</td>
                  <td>{l.entity}<div className="font-mono text-[10px] text-muted">{l.entityId?.slice(0, 8)}</div></td>
                  <td className="max-w-64"><code className="break-all text-[10px] text-muted">{l.before ? JSON.stringify(l.before) : ""}</code></td>
                  <td className="max-w-80"><code className="break-all text-[10px]">{l.after ? JSON.stringify(l.after) : ""}</code></td>
                  <td>{l.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum registro.</Empty>}
      <Pager page={page} total={total} size={PAGE} params={{ entidade: sp.entidade, acao: sp.acao, usuario: sp.usuario }} />
    </>
  );
}
