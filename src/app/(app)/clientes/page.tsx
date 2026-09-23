import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { formatDocument, normalizeCNPJ, onlyDigits } from "@/lib/validators";
import { PageHeader, Empty, Plate, Pager } from "@/components/ui";

export const metadata = { title: "Clientes" };
const PAGE = 30;

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; p?: string; inativos?: string }> }) {
  const user = await requireUser("clientes:ver");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.p) || 1);
  const showDocs = can(user.role, "clientes:ver_documentos");
  const where: Prisma.CustomerWhereInput = {
    active: sp.inativos ? undefined : true,
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { tradeName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(onlyDigits(q).length >= 4 ? [{ phone: { contains: onlyDigits(q).slice(-8) } }, { whatsapp: { contains: onlyDigits(q).slice(-8) } }, { document: { contains: onlyDigits(q) } }] : []),
        { document: { contains: normalizeCNPJ(q) } },
        { vehicles: { some: { plate: { contains: q.toUpperCase().replace(/[^0-9A-Z]/g, "") } } } },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    db.customer.findMany({ where, include: { vehicles: { where: { active: true } }, workOrders: { orderBy: { openedAt: "desc" }, take: 1 } }, orderBy: { name: "asc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.customer.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Clientes" subtitle={`${total} cadastro(s)`} actions={can(user.role, "clientes:editar") && <Link href="/clientes/novo" className="btn btn-primary">Novo cliente</Link>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Nome, CPF/CNPJ, telefone, e-mail ou placa" />
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="inativos" value="1" defaultChecked={!!sp.inativos} /> incluir inativos</label>
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Cliente</th>{showDocs && <th>CPF/CNPJ</th>}<th>Contato</th><th>Veículos</th><th>Último atendimento</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clientes/${c.id}`} className="link">{c.name}</Link>
                    <div className="text-xs text-muted">{c.type}{!c.active && " · inativo"}</div>
                  </td>
                  {showDocs && <td className="font-mono text-xs">{formatDocument(c.document)}</td>}
                  <td className="text-xs">{showDocs ? (c.whatsapp ?? c.phone ?? c.email ?? "—") : "restrito"}</td>
                  <td><div className="flex flex-wrap gap-1">{c.vehicles.map((v) => <Plate key={v.id} plate={v.plate} />)}</div></td>
                  <td className="text-xs">{date(c.workOrders[0]?.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum cliente encontrado.</Empty>}
      <Pager page={page} total={total} size={PAGE} params={{ q, inativos: sp.inativos }} />
    </>
  );
}
