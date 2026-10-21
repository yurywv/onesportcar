import Link from "next/link";
import type { FiscalKind, FiscalStatus, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { FISCAL_STATUS_LABEL, providerStatus } from "@/lib/fiscal";
import { PageHeader, Empty, Pager } from "@/components/ui";
import { FiscalActions } from "./fiscal-actions";

export const metadata = { title: "Notas fiscais" };
const PAGE = 50;
const TONE: Record<FiscalStatus, string> = { RASCUNHO: "badge", PROCESSANDO: "badge badge-info", AUTORIZADA: "badge badge-ok", REJEITADA: "badge badge-danger", CANCELADA: "badge", ERRO: "badge badge-danger" };

export default async function FiscalList({ searchParams }: { searchParams: Promise<{ tipo?: string; status?: string; p?: string }> }) {
  const user = await requireUser("fiscal:ver");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const where: Prisma.FiscalDocumentWhereInput = {
    ...(sp.tipo === "NFSE" || sp.tipo === "NFE" ? { kind: sp.tipo as FiscalKind } : {}),
    ...(sp.status && sp.status in FISCAL_STATUS_LABEL ? { status: sp.status as FiscalStatus } : {}),
  };
  const [rows, total, settings] = await Promise.all([
    db.fiscalDocument.findMany({ where, include: { workOrder: { select: { id: true, number: true } }, customer: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.fiscalDocument.count({ where }),
    db.fiscalSettings.findUnique({ where: { id: "default" } }),
  ]);
  const st = providerStatus();
  const env = settings?.environment ?? "HOMOLOGACAO";
  return (
    <>
      <PageHeader
        title="Notas fiscais"
        subtitle="NFS-e de serviços (Prefeitura de Campinas) e NF-e de produtos. A emissão parte da OS, aba “Notas fiscais”."
        actions={can(user.role, "fiscal:configurar") && <Link href="/fiscal/configuracao" className="btn">Emitente e numeração</Link>}
      />
      <div className={`alert mb-4 ${env === "PRODUCAO" ? "alert-warn" : "alert-info"}`}>
        Ambiente: <b>{env === "PRODUCAO" ? "PRODUÇÃO — notas com validade fiscal" : "HOMOLOGAÇÃO — notas de teste, sem validade fiscal"}</b>
        {!st[env as "PRODUCAO" | "HOMOLOGACAO"] && <> · <b>token do provedor não configurado</b>: as notas ficam como rascunho (prévia) até a configuração.</>}
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="tipo" defaultValue={sp.tipo ?? ""} className="select max-w-48"><option value="">NFS-e e NF-e</option><option value="NFSE">NFS-e (serviços)</option><option value="NFE">NF-e (produtos)</option></select>
        <select name="status" defaultValue={sp.status ?? ""} className="select max-w-48"><option value="">Todos os status</option>{Object.entries(FISCAL_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Tipo</th><th>Número</th><th>OS</th><th>Tomador / destinatário</th><th className="text-right">Valor</th><th>Status</th><th>Emissão</th><th /></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{d.kind === "NFSE" ? "NFS-e" : "NF-e"}{d.environment === "HOMOLOGACAO" && <div className="text-[10px] text-muted">homologação</div>}</td>
                  <td className="tabular-nums">{d.number ? `${d.number}${d.series ? `/${d.series}` : ""}` : d.rpsNumber ? <span className="text-muted">DPS {d.rpsNumber}</span> : "—"}</td>
                  <td>{d.workOrder ? <Link className="link" href={`/os/${d.workOrder.id}?tab=fiscal`}>{d.workOrder.number}</Link> : "—"}</td>
                  <td>{d.customer?.name ?? "—"}</td>
                  <td className="text-right tabular-nums">{money(d.total)}</td>
                  <td><span className={TONE[d.status]}>{FISCAL_STATUS_LABEL[d.status]}</span>{d.message && d.status !== "AUTORIZADA" && <div className="max-w-64 text-xs text-danger">{d.message}</div>}</td>
                  <td className="text-xs">{dateTime(d.issuedAt ?? d.createdAt)}</td>
                  <td><FiscalActions doc={{ id: d.id, status: d.status, pdfUrl: d.pdfUrl, xmlUrl: d.xmlUrl }} canEmit={can(user.role, "fiscal:emitir")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhuma nota ainda. Emita a partir da OS (aba “Notas fiscais”).</Empty>}
      <Pager page={page} total={total} size={PAGE} params={{ tipo: sp.tipo, status: sp.status }} />
    </>
  );
}
