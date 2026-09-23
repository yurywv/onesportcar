import Link from "next/link";
import type { Prisma, PurchaseStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { PO_OPEN, PO_STATUS_LABEL, poGoods } from "@/lib/purchasing";
import { PageHeader, Empty, Stat } from "@/components/ui";
import { POBadge } from "@/components/finance-ui";

export const metadata = { title: "Pedidos de compra" };

export default async function PurchaseOrders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireUser("compras:ver");
  const sp = await searchParams;
  const status = sp.status && sp.status in PO_STATUS_LABEL ? (sp.status as PurchaseStatus) : undefined;
  const q = sp.q?.trim();
  const where: Prisma.PurchaseOrderWhereInput = {
    status: status ?? (sp.status === "todos" ? undefined : { in: PO_OPEN }),
    ...(q && { OR: [{ number: { contains: q.toUpperCase() } }, { supplier: { name: { contains: q, mode: "insensitive" } } }, { supplier: { tradeName: { contains: q, mode: "insensitive" } } }] }),
  };
  const [rows, pendingApproval, overdue] = await Promise.all([
    db.purchaseOrder.findMany({ where, include: { supplier: true, items: true, workOrder: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.purchaseOrder.count({ where: { status: "AGUARDANDO_APROVACAO" } }),
    db.purchaseOrder.count({ where: { status: { in: ["ENVIADO", "RECEBIDO_PARCIAL"] }, expectedAt: { lt: new Date() } } }),
  ]);
  const openValue = rows.filter((r) => PO_OPEN.includes(r.status)).reduce((a, r) => a + r.items.reduce((s, i) => s + Math.round((i.quantity - i.receivedQty) * i.unitCost), 0), 0);
  return (
    <>
      <PageHeader
        title="Pedidos de compra"
        subtitle="Solicitação → aprovação (alçada) → envio → recebimento → estoque e contas a pagar"
        actions={<>
          <Link href="/compras/sugestoes" className="btn">Sugestões de compra</Link>
          {can(user.role, "compras:editar") && <Link href="/compras/novo" className="btn btn-primary">Novo pedido</Link>}
        </>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pedidos em aberto" value={rows.filter((r) => PO_OPEN.includes(r.status)).length} />
        <Stat label="Aguardando aprovação" value={pendingApproval} tone={pendingApproval ? "warn" : undefined} />
        <Stat label="Entregas atrasadas" value={overdue} tone={overdue ? "danger" : "ok"} />
        <Stat label="Saldo a receber (valor)" value={money(openValue)} />
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Nº do pedido ou fornecedor" />
        <select name="status" defaultValue={sp.status ?? ""} className="select max-w-56">
          <option value="">Em aberto</option><option value="todos">Todos</option>
          {Object.entries(PO_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Pedido</th><th>Fornecedor</th><th>Criado</th><th>Previsão</th><th>Status</th><th>OS</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const late = p.expectedAt && p.expectedAt < new Date() && ["ENVIADO", "RECEBIDO_PARCIAL"].includes(p.status);
                return (
                  <tr key={p.id}>
                    <td><Link href={`/compras/${p.id}`} className="link">{p.number}</Link></td>
                    <td>{p.supplier.tradeName ?? p.supplier.name}</td>
                    <td className="text-xs">{date(p.createdAt)}<div className="text-muted">{p.createdByName}</div></td>
                    <td className={`text-xs ${late ? "font-semibold text-danger" : ""}`}>{date(p.expectedAt)}</td>
                    <td><POBadge status={p.status} /></td>
                    <td className="text-xs">{p.workOrder ? <Link href={`/os/${p.workOrder.id}`} className="link">{p.workOrder.number}</Link> : "—"}</td>
                    <td className="text-right tabular-nums">{money(poGoods(p.items) + p.freight)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum pedido encontrado.</Empty>}
    </>
  );
}
