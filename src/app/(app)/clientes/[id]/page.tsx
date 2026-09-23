import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date, dateTime, km } from "@/lib/format";
import { formatDocument } from "@/lib/validators";
import { PageHeader, Section, Empty, Plate, StatusBadge, DL } from "@/components/ui";
import { CustomerForm } from "../customer-form";
import { updateCustomer } from "../actions";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("clientes:ver");
  const { id } = await params;
  const c = await db.customer.findUnique({
    where: { id },
    include: {
      vehicles: { orderBy: { createdAt: "asc" } },
      workOrders: { include: { vehicle: true }, orderBy: { openedAt: "desc" }, take: 30 },
      appointments: { where: { startsAt: { gte: new Date() } }, include: { vehicle: true }, orderBy: { startsAt: "asc" } },
    },
  });
  if (!c) notFound();
  const edit = can(user.role, "clientes:editar");
  const docs = can(user.role, "clientes:ver_documentos");
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={<>{c.type === "PF" ? "Pessoa física" : "Pessoa jurídica"}{docs && <> · {formatDocument(c.document)}</>}{!c.active && " · INATIVO"}</>}
        back={<Link href="/clientes" className="link text-xs">← Clientes</Link>}
        actions={<>
          {can(user.role, "veiculos:editar") && <Link href={`/veiculos/novo?cliente=${c.id}`} className="btn">Adicionar veículo</Link>}
          {can(user.role, "agenda:editar") && <Link href={`/agenda?novo=1&cliente=${c.id}`} className="btn">Agendar</Link>}
        </>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Veículos">
            {c.vehicles.length ? (
              <ul className="divide-y divide-line">
                {c.vehicles.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <Link href={`/veiculos/${v.id}`} className="link">{v.make} {v.model} {v.version}</Link>
                    <span className="flex items-center gap-3 text-sm text-muted"><Plate plate={v.plate} /> {v.yearModel} · {km(v.mileage)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nenhum veículo vinculado.</Empty>}
          </Section>
          <Section title="Histórico de atendimentos">
            {c.workOrders.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>OS</th><th>Abertura</th><th>Veículo</th><th>Status</th></tr></thead>
                  <tbody>
                    {c.workOrders.map((w) => (
                      <tr key={w.id}>
                        <td><Link href={`/os/${w.id}`} className="link">{w.number}</Link></td>
                        <td>{date(w.openedAt)}</td>
                        <td>{w.vehicle.model} <Plate plate={w.vehicle.plate} /></td>
                        <td><StatusBadge status={w.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Sem atendimentos.</Empty>}
          </Section>
          <Section title={edit ? "Dados cadastrais" : "Dados"}>
            {edit ? <CustomerForm action={updateCustomer} customer={c} /> : (
              <DL items={[["E-mail", docs ? c.email : "restrito"], ["WhatsApp", docs ? c.whatsapp : "restrito"], ["Cidade", c.city && `${c.city}/${c.uf}`], ["Origem", c.origin]]} />
            )}
          </Section>
        </div>
        <div className="space-y-5">
          <Section title="Resumo">
            <DL items={[
              ["Cliente desde", date(c.createdAt)],
              ["Atendimentos", String(c.workOrders.length)],
              ["Último atendimento", date(c.workOrders[0]?.openedAt)],
              ["Canal preferido", c.preferredChannel],
              ["Consentimento marketing", c.consentMarketing ? `Sim (${date(c.consentAt)})` : "Não"],
            ]} />
          </Section>
          <Section title="Próximos agendamentos">
            {c.appointments.length ? (
              <ul className="space-y-2 text-sm">{c.appointments.map((a) => <li key={a.id}>{dateTime(a.startsAt)} · {a.vehicle.model} · {a.services}</li>)}</ul>
            ) : <Empty>Nenhum.</Empty>}
          </Section>
        </div>
      </div>
    </>
  );
}
