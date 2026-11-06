import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer-auth";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { formatPlate } from "@/lib/validators";
import { STATUS_LABEL } from "@/lib/workflow";

export const metadata = { title: "Histórico do veículo" };

export default async function VehicleHistory({ params }: { params: Promise<{ id: string }> }) {
  const c = await requireCustomer();
  const v = await db.vehicle.findFirst({
    where: { id: (await params).id, customerId: c.id },
    include: {
      workOrders: {
        where: { status: { not: "CANCELADA" } },
        include: { checkIn: { select: { km: true } }, services: { where: { status: { not: "CANCELADO" } }, select: { description: true, price: true } }, parts: { where: { status: { in: ["RESERVADA", "AGUARDANDO_COMPRA", "APLICADA"] } }, select: { description: true, quantity: true, price: true } } },
        orderBy: { openedAt: "desc" },
      },
    },
  });
  if (!v) notFound();
  return (
    <div className="space-y-4">
      <Link href="/cliente" className="link text-xs">← Início</Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{v.make} {v.model} <span className="plate">{formatPlate(v.plate)}</span></h1>
          <p className="text-sm text-muted">{v.version} {v.yearMfg && `· ${v.yearMfg}/${v.yearModel ?? ""}`} {v.color && `· ${v.color}`} · {v.mileage.toLocaleString("pt-BR")} km</p>
        </div>
        <Link href={`/cliente/agendar?veiculo=${v.id}`} className="btn btn-primary btn-sm">Agendar para este carro</Link>
      </div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Histórico de manutenção</h2>
      {v.workOrders.length ? (
        <ol className="space-y-3">
          {v.workOrders.map((wo) => {
            const total = wo.legacy ? wo.legacyTotal : wo.services.reduce((s, x) => s + x.price, 0) + wo.parts.reduce((s, x) => s + x.price, 0);
            const kmVal = wo.checkIn?.km ?? wo.kmIn;
            return (
              <li key={wo.id} className="card card-pad">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">{date(wo.openedAt)} · {wo.legacy ? `OS ${wo.legacyNumber}` : wo.number}</div>
                  <span className="badge">{wo.legacy ? "Concluída" : STATUS_LABEL[wo.status]}</span>
                </div>
                <div className="text-xs text-muted">{kmVal != null && `${kmVal.toLocaleString("pt-BR")} km · `}{total ? money(total) : ""}</div>
                {(wo.services.length > 0 || wo.parts.length > 0) && (
                  <ul className="mt-2 list-inside list-disc text-sm">
                    {wo.services.map((s, i) => <li key={`s${i}`}>{s.description}</li>)}
                    {wo.parts.map((p, i) => <li key={`p${i}`} className="text-muted">{p.quantity !== 1 && `${p.quantity}× `}{p.description}</li>)}
                  </ul>
                )}
                {wo.legacy && wo.complaint && <p className="mt-2 text-sm text-muted">{wo.complaint}</p>}
                {!wo.legacy && <Link href={`/cliente/os/${wo.id}`} className="link mt-2 inline-block text-xs">Ver detalhes, fotos e check-in →</Link>}
              </li>
            );
          })}
        </ol>
      ) : <p className="card card-pad text-sm text-muted">Ainda não há manutenções registradas para este veículo.</p>}
    </div>
  );
}
