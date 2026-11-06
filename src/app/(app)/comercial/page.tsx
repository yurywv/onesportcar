import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/workflow";
import { PageHeader, Plate, Empty, Section, StatusBadge } from "@/components/ui";

export const metadata = { title: "Comercial" };
export const dynamic = "force-dynamic";

// Painel do consultor comercial: o que precisa ser precificado, o que está com o cliente e o que foi aprovado.
export default async function Commercial() {
  await requireUser("precificacao:editar");
  const include = { vehicle: true, customer: { select: { name: true, whatsapp: true, phone: true } }, estimates: { include: { versions: { orderBy: { version: "desc" as const }, take: 1 } } } };
  const [toPrice, inQuote, waiting, approved] = await Promise.all([
    db.workOrder.findMany({ where: { status: "ORCAMENTO", OR: [{ quoteStatus: "CONCLUIDA" }, { quoteStatus: null }] }, include, orderBy: { updatedAt: "asc" } }),
    db.workOrder.count({ where: { status: "ORCAMENTO", quoteStatus: "PENDENTE" } }),
    db.workOrder.findMany({ where: { status: "AGUARDANDO_APROVACAO" }, include, orderBy: { updatedAt: "asc" } }),
    db.workOrder.findMany({ where: { status: { in: ["AGUARDANDO_PECAS", "EM_EXECUCAO"] }, updatedAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, include, orderBy: { updatedAt: "desc" }, take: 30 }),
  ]);
  const row = (wo: (typeof toPrice)[number], extra?: React.ReactNode) => {
    const v = wo.estimates.flatMap((e) => e.versions).sort((a, b) => +b.sentAt - +a.sentAt)[0];
    return (
      <li key={wo.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <div>
          <Link href={`/os/${wo.id}?tab=${wo.status === "ORCAMENTO" ? "precificacao" : "orcamento"}`} className="font-semibold link">{wo.number}</Link> · {wo.vehicle.make} {wo.vehicle.model} <Plate plate={wo.vehicle.plate} />
          <div className="text-xs text-muted">{wo.customer.name}{wo.customer.whatsapp && ` · ${wo.customer.whatsapp}`} · desde {dateTime(wo.updatedAt)}</div>
        </div>
        <div className="flex items-center gap-2">{v && <span className="tabular-nums">{money(v.total)}</span>}<StatusBadge status={wo.status} />{extra}</div>
      </li>
    );
  };
  return (
    <>
      <PageHeader title="Comercial" subtitle={`${inQuote} OS em cotação com compras.`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={`Para precificar (${toPrice.length})`}>
          {toPrice.length ? <ul className="divide-y divide-line">{toPrice.map((wo) => row(wo))}</ul> : <Empty>Nada para precificar.</Empty>}
        </Section>
        <Section title={`Aguardando o cliente (${waiting.length})`}>
          {waiting.length ? <ul className="divide-y divide-line">{waiting.map((wo) => row(wo))}</ul> : <Empty>Nenhum orçamento pendente.</Empty>}
        </Section>
        <Section title="Aprovados nos últimos 7 dias — OS em execução" className="lg:col-span-2">
          {approved.length ? <ul className="divide-y divide-line">{approved.map((wo) => row(wo, <span className="text-xs text-muted">{STATUS_LABEL[wo.status]}</span>))}</ul> : <Empty>Nenhum.</Empty>}
        </Section>
      </div>
    </>
  );
}
