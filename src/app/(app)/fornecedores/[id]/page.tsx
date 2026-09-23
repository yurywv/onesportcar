import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { formatDocument } from "@/lib/validators";
import { poGoods } from "@/lib/purchasing";
import { PageHeader, Section, Empty, DL, Stat } from "@/components/ui";
import { POBadge, TitleBadge } from "@/components/finance-ui";
import { SupplierForm } from "../supplier-form";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("compras:ver");
  const { id } = await params;
  const s = await db.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: { include: { items: true, receipts: true }, orderBy: { createdAt: "desc" }, take: 30 },
      titles: { where: { kind: "PAGAR" }, orderBy: { dueDate: "desc" }, take: 30 },
      items: { where: { active: true }, orderBy: { name: "asc" } },
    },
  });
  if (!s) notFound();
  const bought = s.purchaseOrders.filter((p) => p.status !== "CANCELADO").reduce((a, p) => a + poGoods(p.items) + p.freight, 0);
  const openPay = s.titles.filter((t) => t.status === "ABERTO" || t.status === "PARCIAL").reduce((a, t) => a + t.amount - t.settled, 0);
  const leadTimes = s.purchaseOrders.flatMap((p) => (p.sentAt && p.receipts[0] ? [(+p.receipts[0].createdAt - +p.sentAt) / 86400_000] : []));
  const avgLead = leadTimes.length ? (leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length).toFixed(1) : null;
  return (
    <>
      <PageHeader
        title={s.tradeName ?? s.name}
        subtitle={<>{s.name} · {formatDocument(s.document)}{!s.active && " · INATIVO"}</>}
        back={<Link href="/fornecedores" className="link text-xs">← Fornecedores</Link>}
        actions={can(user.role, "compras:editar") && <Link href={`/compras/novo?fornecedor=${s.id}`} className="btn btn-primary">Novo pedido</Link>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Comprado (pedidos)" value={money(bought)} />
        <Stat label="A pagar em aberto" value={money(openPay)} tone={openPay ? "warn" : undefined} />
        <Stat label="Pedidos" value={s.purchaseOrders.length} />
        <Stat label="Prazo real médio" value={avgLead ? `${avgLead} dias` : "—"} hint={s.leadTimeDays != null ? `prometido: ${s.leadTimeDays} dias` : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Pedidos de compra">
            {s.purchaseOrders.length ? (
              <table className="table">
                <thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th className="text-right">Total</th></tr></thead>
                <tbody>{s.purchaseOrders.map((p) => <tr key={p.id}><td><Link href={`/compras/${p.id}`} className="link">{p.number}</Link></td><td>{date(p.createdAt)}</td><td><POBadge status={p.status} /></td><td className="text-right tabular-nums">{money(poGoods(p.items) + p.freight)}</td></tr>)}</tbody>
              </table>
            ) : <Empty>Nenhum pedido.</Empty>}
          </Section>
          {can(user.role, "fornecedores:editar") && <Section title="Cadastro"><SupplierForm s={s} /></Section>}
        </div>
        <div className="space-y-5">
          <Section title="Contato">
            <DL items={[["Contato", s.contactName], ["E-mail", s.email], ["WhatsApp", s.whatsapp], ["Telefone", s.phone], ["Condição", s.paymentTerms], ["Especialidades", s.specialties], ["Marcas", s.brands], ["Cidade", s.city && `${s.city}/${s.uf}`]]} />
          </Section>
          {can(user.role, "financeiro:ver") && (
            <Section title="Títulos a pagar">
              {s.titles.length ? (
                <ul className="space-y-1.5 text-sm">{s.titles.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><Link href={`/financeiro/titulos/${t.id}`} className="link">{t.number}</Link><span className="text-xs text-muted">{date(t.dueDate)}</span><span className="tabular-nums">{money(t.amount)}</span><TitleBadge status={t.status} dueDate={t.dueDate} /></li>)}</ul>
              ) : <Empty>Nenhum título.</Empty>}
            </Section>
          )}
          <Section title="Itens com este fornecedor preferencial">
            {s.items.length ? <ul className="space-y-1 text-sm">{s.items.map((i) => <li key={i.id}><Link href={`/estoque/${i.id}`} className="link font-mono text-xs">{i.sku}</Link> {i.name}</li>)}</ul> : <Empty>Nenhum.</Empty>}
          </Section>
        </div>
      </div>
    </>
  );
}
