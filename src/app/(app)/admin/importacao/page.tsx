import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { ENTITY_LABEL, type ImportEntity } from "@/lib/import-fields";
import { PageHeader, Empty } from "@/components/ui";
import { JOB_STATUS } from "./status";

export const metadata = { title: "Importação do SYSCAR" };
export const dynamic = "force-dynamic";


export default async function Imports() {
  await requireUser("admin:importar");
  const jobs = await db.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const counts = await db.importRow.groupBy({ by: ["jobId", "status"], where: { jobId: { in: jobs.map((j) => j.id) } }, _count: true });
  const c = (id: string, st: string) => counts.find((x) => x.jobId === id && x.status === st)?._count ?? 0;
  return (
    <>
      <PageHeader title="Importação do SYSCAR" subtitle="Cadastros entram só depois de validados e confirmados. Cada lote pode ser revertido enquanto os registros não forem usados."
        actions={<Link href="/admin/importacao/nova" className="btn btn-primary">Nova importação</Link>} />
      {jobs.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Data</th><th>Cadastro</th><th>Arquivo</th><th>Situação</th><th className="text-right">Linhas</th><th className="text-right">Importados</th><th className="text-right">Duplicados</th><th className="text-right">Inválidos/erro</th><th>Usuário</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="text-xs whitespace-nowrap"><Link href={`/admin/importacao/${j.id}`} className="link">{dateTime(j.createdAt)}</Link></td>
                  <td>{ENTITY_LABEL[j.entity as ImportEntity]}</td>
                  <td className="max-w-56 truncate text-xs">{j.fileName}{j.sheetName && ` · ${j.sheetName}`}</td>
                  <td><span className={JOB_STATUS[j.status]?.[1] ?? "badge"}>{JOB_STATUS[j.status]?.[0] ?? j.status}</span></td>
                  <td className="text-right tabular-nums">{j.totalRows}</td>
                  <td className="text-right tabular-nums">{j.status === "VALIDADO" ? `${c(j.id, "VALIDO")} a importar` : j.status === "REVERTIDO" ? `${c(j.id, "MANTIDO")} mantidos` : c(j.id, "IMPORTADO")}</td>
                  <td className="text-right tabular-nums">{c(j.id, "DUPLICADO")}</td>
                  <td className="text-right tabular-nums">{c(j.id, "INVALIDO") + c(j.id, "ERRO")}</td>
                  <td className="text-xs">{j.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhuma importação ainda. Comece por <b>Clientes</b>.</Empty>}
    </>
  );
}
