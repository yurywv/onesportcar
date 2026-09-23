import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { date, dateTime, km } from "@/lib/format";
import { formatPlate } from "@/lib/validators";
import { PageHeader, Section, Empty, StatusBadge, DL } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { VehicleForm } from "../vehicle-form";
import { updateVehicle, transferVehicle, addOdometer } from "../actions";

const PROP_LABEL: Record<string, string> = { GASOLINA: "Gasolina", FLEX: "Flex", ETANOL: "Etanol", DIESEL: "Diesel", HIBRIDO: "Híbrido", HIBRIDO_PLUGIN: "Híbrido plug-in", ELETRICO: "Elétrico" };

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("veiculos:ver");
  const { id } = await params;
  const v = await db.vehicle.findUnique({
    where: { id },
    include: {
      customer: true,
      ownerships: { include: { customer: true }, orderBy: { startedAt: "desc" } },
      odometer: { orderBy: { createdAt: "desc" }, take: 10 },
      workOrders: {
        include: { checkIn: true, services: { where: { status: { not: "CANCELADO" } } }, parts: { where: { status: "APLICADA" } } },
        orderBy: { openedAt: "desc" },
      },
    },
  });
  if (!v) notFound();
  const edit = can(user.role, "veiculos:editar");
  const customers = edit ? await db.customer.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];

  return (
    <>
      <PageHeader
        title={<>{v.make} {v.model} <span className="text-muted">{v.version}</span></>}
        subtitle={<><span className="plate">{formatPlate(v.plate)}</span> · {v.yearMfg}/{v.yearModel} · {v.color} · {km(v.mileage)}</>}
        back={<Link href="/veiculos" className="link text-xs">← Veículos</Link>}
        actions={can(user.role, "os:criar") && <Link href={`/os/nova?veiculo=${v.id}`} className="btn btn-primary">Novo check-in</Link>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Timeline de manutenção">
            {v.workOrders.length ? (
              <ol className="relative ml-2 border-l border-line">
                {v.workOrders.map((w) => (
                  <li key={w.id} className="mb-5 ml-5">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold tabular-nums">{w.checkIn ? km(w.checkIn.km) : "—"}</span>
                      <span className="text-muted">{date(w.openedAt)}</span>
                      <Link href={`/os/${w.id}`} className="link">{w.number}</Link>
                      <StatusBadge status={w.status} />
                    </div>
                    <p className="mt-1 text-sm">{w.services.map((s) => s.description).join(" · ") || w.complaint || "—"}</p>
                    {w.parts.length > 0 && <p className="text-xs text-muted">Peças: {w.parts.map((p) => p.description).join(", ")}</p>}
                  </li>
                ))}
              </ol>
            ) : <Empty>Nenhum atendimento registrado.</Empty>}
          </Section>
          {edit && <Section title="Dados do veículo"><VehicleForm action={updateVehicle} vehicle={v} /></Section>}
        </div>
        <div className="space-y-5">
          <Section title="Ficha">
            <DL items={[
              ["Proprietário", <Link key="c" href={`/clientes/${v.customerId}`} className="link">{v.customer.name}</Link>],
              ["Propulsão", PROP_LABEL[v.propulsion]], ["Chassi", v.vin], ["RENAVAM", v.renavam], ["Motor", v.engine],
              ["Transmissão", v.transmission], ["Tração", v.traction], ["Potência", v.power],
            ]} />
          </Section>
          <Section title="Quilometragem">
            <ul className="mb-3 space-y-1 text-sm">
              {v.odometer.map((o) => (
                <li key={o.id} className="flex justify-between gap-2">
                  <span className="tabular-nums">{km(o.km)}</span>
                  <span className="text-xs text-muted">{o.source} · {dateTime(o.createdAt)}</span>
                </li>
              ))}
            </ul>
            {edit && (
              <ActionForm action={addOdometer} reset className="space-y-2">
                <input type="hidden" name="id" value={v.id} />
                <input name="km" className="input" inputMode="numeric" placeholder="Nova leitura (km)" required />
                <input name="justification" className="input" placeholder="Justificativa (se menor que a anterior)" />
                <Submit className="btn w-full">Registrar leitura</Submit>
              </ActionForm>
            )}
          </Section>
          <Section title="Proprietários">
            <ul className="mb-3 space-y-1 text-sm">
              {v.ownerships.map((o) => (
                <li key={o.id}>{o.customer.name} <span className="text-xs text-muted">{date(o.startedAt)} → {o.endedAt ? date(o.endedAt) : "atual"}</span></li>
              ))}
            </ul>
            {edit && (
              <ActionForm action={transferVehicle} className="space-y-2" confirm="Confirmar a troca de proprietário?">
                <input type="hidden" name="id" value={v.id} />
                <select name="customerId" className="select" required defaultValue="">
                  <option value="">Transferir para…</option>
                  {customers.filter((c) => c.id !== v.customerId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <Submit className="btn w-full">Transferir</Submit>
              </ActionForm>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
