import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { createPurchaseOrder } from "../actions";

export const metadata = { title: "Novo pedido de compra" };

export default async function NewPO({ searchParams }: { searchParams: Promise<{ fornecedor?: string }> }) {
  await requireUser("compras:editar");
  const sp = await searchParams;
  const [suppliers, orders] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.workOrder.findMany({ where: { status: { in: ["AGUARDANDO_PECAS", "EM_EXECUCAO", "AGUARDANDO_APROVACAO"] } }, include: { vehicle: true }, orderBy: { number: "desc" } }),
  ]);
  return (
    <>
      <PageHeader title="Novo pedido de compra" subtitle="O pedido começa como rascunho; os itens são incluídos em seguida." back={<Link href="/compras" className="link text-xs">← Pedidos</Link>} />
      {suppliers.length ? (
        <ActionForm action={createPurchaseOrder} className="card card-pad grid max-w-2xl gap-4">
          <Field label="Fornecedor *">
            <select name="supplierId" className="select" required defaultValue={sp.fornecedor ?? ""}>
              <option value="">Selecione…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName ?? s.name}{s.specialties ? ` — ${s.specialties}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Vincular a uma OS (opcional)">
            <select name="workOrderId" className="select" defaultValue="">
              <option value="">Estoque geral</option>
              {orders.map((w) => <option key={w.id} value={w.id}>{w.number} — {w.vehicle.model}</option>)}
            </select>
          </Field>
          <Submit>Criar rascunho</Submit>
        </ActionForm>
      ) : <Empty>Cadastre um fornecedor antes. <Link href="/fornecedores/novo" className="link">Novo fornecedor</Link></Empty>}
    </>
  );
}
