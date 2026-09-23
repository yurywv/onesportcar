import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { normalizeCNPJ, onlyDigits, formatDocument } from "@/lib/validators";
import { PageHeader, Section, Plate, StatusBadge, Empty } from "@/components/ui";

export const metadata = { title: "Busca" };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const q = (await searchParams).q?.trim() ?? "";
  const up = q.toUpperCase();
  const norm = normalizeCNPJ(q);
  const digits = onlyDigits(q);
  const ok = q.length >= 2;
  const allOS = can(user.role, "os:ver_todas");
  const [customers, vehicles, orders, items] = ok ? await Promise.all([
    can(user.role, "clientes:ver") ? db.customer.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(norm.length >= 4 ? [{ document: { contains: norm } }] : []), ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-8) } }, { whatsapp: { contains: digits.slice(-8) } }] : [])] },
      take: 10, orderBy: { name: "asc" },
    }) : [],
    can(user.role, "veiculos:ver") ? db.vehicle.findMany({ where: { OR: [{ plate: { contains: norm } }, { vin: { contains: norm } }, { model: { contains: q, mode: "insensitive" } }] }, include: { customer: true }, take: 10 }) : [],
    can(user.role, "os:ver") ? db.workOrder.findMany({
      where: { technicianId: allOS ? undefined : user.id, OR: [{ number: { contains: up } }, { vehicle: { plate: { contains: norm } } }, { estimates: { some: { number: { contains: up } } } }] },
      include: { vehicle: true, customer: true }, take: 10, orderBy: { openedAt: "desc" },
    }) : [],
    can(user.role, "estoque:ver") ? db.inventoryItem.findMany({ where: { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { oemCode: { contains: q, mode: "insensitive" } }] }, take: 10 }) : [],
  ]) : [[], [], [], []];
  const none = ok && !customers.length && !vehicles.length && !orders.length && !items.length;
  return (
    <>
      <PageHeader title="Busca" subtitle={q ? `Resultados para “${q}”` : "Digite ao menos 2 caracteres na barra superior"} />
      {none && <Empty>Nada encontrado.</Empty>}
      <div className="grid gap-5 lg:grid-cols-2">
        {orders.length > 0 && <Section title="Ordens de serviço"><ul className="space-y-2 text-sm">{orders.map((w) => <li key={w.id} className="flex flex-wrap items-center gap-2"><Link className="link" href={`/os/${w.id}`}>{w.number}</Link><StatusBadge status={w.status} /> {w.vehicle.model} <Plate plate={w.vehicle.plate} /> <span className="text-muted">{w.customer.name} · {date(w.openedAt)}</span></li>)}</ul></Section>}
        {vehicles.length > 0 && <Section title="Veículos"><ul className="space-y-2 text-sm">{vehicles.map((v) => <li key={v.id}><Plate plate={v.plate} /> <Link className="link" href={`/veiculos/${v.id}`}>{v.make} {v.model}</Link> <span className="text-muted">{v.customer.name}</span></li>)}</ul></Section>}
        {customers.length > 0 && <Section title="Clientes"><ul className="space-y-2 text-sm">{customers.map((c) => <li key={c.id}><Link className="link" href={`/clientes/${c.id}`}>{c.name}</Link>{can(user.role, "clientes:ver_documentos") && <span className="text-muted"> · {formatDocument(c.document)}</span>}</li>)}</ul></Section>}
        {items.length > 0 && <Section title="Peças"><ul className="space-y-2 text-sm">{items.map((i) => <li key={i.id}><span className="font-mono text-xs">{i.sku}</span> <Link className="link" href={`/estoque/${i.id}`}>{i.name}</Link> <span className="text-muted">saldo {i.onHand}</span></li>)}</ul></Section>}
      </div>
    </>
  );
}
