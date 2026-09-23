import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { PageHeader, Empty, Stat, Pager } from "@/components/ui";
import { ItemForm, CATEGORY_LABEL } from "./item-form";

export const metadata = { title: "Estoque" };
const PAGE = 50;

export default async function Stock({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; critico?: string; novo?: string; p?: string }> }) {
  const user = await requireUser("estoque:ver");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const q = sp.q?.trim();
  const where: Prisma.InventoryItemWhereInput = {
    active: true, category: sp.cat || undefined,
    ...(q && { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { oemCode: { contains: q, mode: "insensitive" } }, { mfrCode: { contains: q, mode: "insensitive" } }] }),
  };
  const [allItems, reserved] = await Promise.all([
    db.inventoryItem.findMany({ where, orderBy: { name: "asc" } }),
    db.workOrderPart.groupBy({ by: ["inventoryItemId"], where: { status: "RESERVADA" }, _sum: { quantity: true } }),
  ]);
  const res = new Map(reserved.map((r) => [r.inventoryItemId, r._sum.quantity ?? 0]));
  const filtered = sp.critico ? allItems.filter((i) => i.onHand < i.minQty) : allItems;
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const valuation = allItems.reduce((s, i) => s + Math.round(i.onHand * i.avgCost), 0);
  const critical = allItems.filter((i) => i.onHand < i.minQty).length;
  const costs = can(user.role, "orcamento:ver_custos") || can(user.role, "estoque:movimentar");
  const edit = can(user.role, "estoque:movimentar");

  return (
    <>
      <PageHeader title="Estoque" subtitle="Saldo é consequência das movimentações; custo médio ponderado móvel" actions={edit && <Link href="?novo=1" className="btn btn-primary">Novo item</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Itens ativos" value={allItems.length} />
        <Stat label="Abaixo do mínimo" value={critical} tone={critical ? "warn" : "ok"} />
        {costs && <Stat label="Estoque valorizado (custo)" value={money(valuation)} />}
        <Stat label="Unidades reservadas p/ OS" value={[...res.values()].reduce((a, b) => a + b, 0)} />
      </div>
      {sp.novo && edit && <div className="card card-pad mb-5"><h2 className="mb-3 font-semibold">Novo item</h2><ItemForm /></div>}
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="SKU, descrição, OEM" />
        <select name="cat" defaultValue={sp.cat ?? ""} className="select max-w-48"><option value="">Todas as categorias</option>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="critico" value="1" defaultChecked={!!sp.critico} /> só críticos</label>
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>SKU</th><th>Descrição</th><th>Categoria</th><th>Local</th><th className="text-right">Saldo</th><th className="text-right">Reservado</th><th className="text-right">Disponível</th>{costs && <th className="text-right">Custo médio</th>}<th className="text-right">Preço</th></tr></thead>
            <tbody>
              {rows.map((i) => {
                const r = res.get(i.id) ?? 0;
                return (
                  <tr key={i.id}>
                    <td className="font-mono text-xs"><Link href={`/estoque/${i.id}`} className="link">{i.sku}</Link></td>
                    <td>{i.name}{i.oemCode && <div className="text-xs text-muted">OEM {i.oemCode}</div>}</td>
                    <td className="text-xs">{CATEGORY_LABEL[i.category]}</td>
                    <td className="text-xs">{i.location ?? "—"}</td>
                    <td className={`text-right tabular-nums ${i.onHand < i.minQty ? "font-semibold text-warn" : ""}`}>{i.onHand} {i.unit}</td>
                    <td className="text-right tabular-nums text-muted">{r || "—"}</td>
                    <td className="text-right tabular-nums">{i.onHand - r}</td>
                    {costs && <td className="text-right tabular-nums">{money(i.avgCost)}</td>}
                    <td className="text-right tabular-nums">{money(i.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum item encontrado.</Empty>}
      <Pager page={page} total={filtered.length} size={PAGE} params={{ q, cat: sp.cat, critico: sp.critico }} />
    </>
  );
}
