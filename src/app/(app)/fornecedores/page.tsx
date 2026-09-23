import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { formatDocument, normalizeCNPJ } from "@/lib/validators";
import { PageHeader, Empty } from "@/components/ui";

export const metadata = { title: "Fornecedores" };

export default async function Suppliers({ searchParams }: { searchParams: Promise<{ q?: string; inativos?: string }> }) {
  const user = await requireUser("compras:ver");
  const sp = await searchParams;
  const q = sp.q?.trim();
  const where: Prisma.SupplierWhereInput = {
    active: sp.inativos ? undefined : true,
    ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { tradeName: { contains: q, mode: "insensitive" } }, { document: { contains: normalizeCNPJ(q) } }, { specialties: { contains: q, mode: "insensitive" } }, { brands: { contains: q, mode: "insensitive" } }] }),
  };
  const rows = await db.supplier.findMany({
    where, orderBy: { name: "asc" },
    include: { purchaseOrders: { where: { status: { not: "CANCELADO" } }, select: { id: true } }, titles: { where: { kind: "PAGAR", status: { in: ["ABERTO", "PARCIAL"] } }, select: { amount: true, settled: true } } },
  });
  return (
    <>
      <PageHeader title="Fornecedores" subtitle={`${rows.length} fornecedor(es)`} actions={can(user.role, "fornecedores:editar") && <Link href="/fornecedores/novo" className="btn btn-primary">Novo fornecedor</Link>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Nome, CNPJ, especialidade ou marca" />
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="inativos" value="1" defaultChecked={!!sp.inativos} /> incluir inativos</label>
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Fornecedor</th><th>CNPJ/CPF</th><th>Contato</th><th>Especialidades</th><th>Condição</th><th className="text-right">Pedidos</th><th className="text-right">A pagar</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/fornecedores/${s.id}`} className="link">{s.tradeName ?? s.name}</Link><div className="text-xs text-muted">{s.tradeName && s.name}{s.rating && ` · ${"★".repeat(s.rating)}`}{!s.active && " · inativo"}</div></td>
                  <td className="font-mono text-xs">{formatDocument(s.document)}</td>
                  <td className="text-xs">{s.contactName}<div className="text-muted">{s.whatsapp ?? s.phone ?? s.email}</div></td>
                  <td className="text-xs">{s.specialties ?? "—"}</td>
                  <td className="text-xs">{s.paymentTerms ?? "—"}{s.leadTimeDays != null && ` · entrega ${s.leadTimeDays}d`}</td>
                  <td className="text-right tabular-nums">{s.purchaseOrders.length}</td>
                  <td className="text-right tabular-nums">{money(s.titles.reduce((a, t) => a + t.amount - t.settled, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum fornecedor encontrado.</Empty>}
    </>
  );
}
