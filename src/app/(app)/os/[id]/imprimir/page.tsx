import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, km, money, minutesLabel } from "@/lib/format";
import { formatDocument, formatPlate } from "@/lib/validators";
import { STATUS_LABEL } from "@/lib/workflow";
import { woTotals } from "@/lib/wo";
import { DamageMap } from "@/components/damage-map";
import { PrintButton } from "@/components/print-button";
import { loadWorkOrder } from "../data";

export const metadata = { title: "Impressão da OS" };

export default async function PrintWO({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("os:ver");
  const wo = await loadWorkOrder((await params).id);
  if (!wo) notFound();
  const showMoney = can(user.role, "orcamento:editar") || can(user.role, "financeiro:ver_valores");
  const t = woTotals({ ...wo, techCost: new Map() });
  const ci = wo.checkIn;
  const branch = await db.branch.findUnique({ where: { id: wo.branchId }, include: { company: true } });
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div><span className="text-muted">{k}: </span>{v ?? "—"}</div>;
  return (
    <article className="mx-auto max-w-3xl bg-surface p-6 text-sm print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end"><PrintButton /></div>
      <header className="flex items-start justify-between border-b border-line pb-3">
        <div><div className="text-lg font-bold">OneSportcar</div><div className="text-xs text-muted">{branch?.company.name} · {branch?.name}</div></div>
        <div className="text-right"><div className="text-lg font-bold">{wo.number}</div><div className="text-xs">{STATUS_LABEL[wo.status]} · emitido {dateTime(new Date())}</div></div>
      </header>
      <section className="grid grid-cols-2 gap-4 border-b border-line py-3">
        <div><h2 className="mb-1 font-semibold">Cliente</h2><Row k="Nome" v={wo.customer.name} /><Row k="CPF/CNPJ" v={formatDocument(wo.customer.document)} /><Row k="Contato" v={wo.customer.whatsapp ?? wo.customer.phone} /></div>
        <div><h2 className="mb-1 font-semibold">Veículo</h2><Row k="Veículo" v={`${wo.vehicle.make} ${wo.vehicle.model} ${wo.vehicle.version ?? ""}`} /><Row k="Placa" v={formatPlate(wo.vehicle.plate)} /><Row k="Chassi" v={wo.vehicle.vin} /><Row k="Ano/cor" v={`${wo.vehicle.yearModel ?? ""} ${wo.vehicle.color ?? ""}`} /></div>
      </section>
      {ci && (
        <section className="border-b border-line py-3">
          <h2 className="mb-1 font-semibold">Check-in {ci.number}</h2>
          <div className="grid grid-cols-2 gap-x-4">
            <Row k="Entrada" v={dateTime(wo.openedAt)} /><Row k="Km / combustível" v={`${km(ci.km)} · ${ci.fuelLevel}%`} />
            <Row k="Trazido por" v={`${ci.broughtBy} (${ci.broughtByRelation.toLowerCase()})`} /><Row k="Chaves" v={ci.keysCount} />
            <Row k="Luzes no painel" v={ci.dashLights.join(", ") || "nenhuma"} /><Row k="Objetos pessoais" v={ci.personalItems} />
          </div>
          <p className="mt-2"><span className="text-muted">Reclamação do cliente: </span>{wo.complaint}</p>
          <div className="mt-3"><DamageMap readOnly initial={ci.damages.map((d) => ({ x: d.x, y: d.y, type: d.type, severity: d.severity, note: d.note ?? undefined }))} /></div>
          {ci.locked && <p className="mt-2 text-xs">Assinado eletronicamente por {ci.signedName} em {dateTime(ci.signedAt)} · SHA-256 {ci.contentHash}</p>}
          {ci.signatureData && <img src={ci.signatureData} alt="Assinatura do check-in" className="mt-1 h-16 border-b border-line" />}
        </section>
      )}
      {wo.diagnostics.length > 0 && (
        <section className="border-b border-line py-3">
          <h2 className="mb-1 font-semibold">Diagnóstico</h2>
          {wo.diagnostics.map((d) => <p key={d.id}>{d.diagnosis} <span className="text-xs text-muted">— {d.technicianName}, {dateTime(d.finishedAt)}</span></p>)}
        </section>
      )}
      <section className="border-b border-line py-3">
        <h2 className="mb-1 font-semibold">Serviços e peças aprovados</h2>
        <table className="table">
          <thead><tr><th>Descrição</th><th className="text-right">Qtd/tempo</th>{showMoney && <th className="text-right">Valor</th>}</tr></thead>
          <tbody>
            {wo.services.filter((s) => s.status !== "CANCELADO").map((s) => <tr key={s.id}><td>{s.description}</td><td className="text-right">{minutesLabel(s.soldMin)}</td>{showMoney && <td className="text-right">{money(s.price)}</td>}</tr>)}
            {wo.parts.filter((p) => ["RESERVADA", "AGUARDANDO_COMPRA", "APLICADA"].includes(p.status)).map((p) => <tr key={p.id}><td>{p.description}</td><td className="text-right">{p.quantity}</td>{showMoney && <td className="text-right">{money(p.price)}</td>}</tr>)}
          </tbody>
          {showMoney && <tfoot><tr><td colSpan={2} className="text-right font-semibold">Total</td><td className="text-right font-semibold">{money(t.total)}</td></tr></tfoot>}
        </table>
      </section>
      {wo.checkOut && (
        <section className="py-3">
          <h2 className="mb-1 font-semibold">Entrega</h2>
          <Row k="Data" v={dateTime(wo.checkOut.createdAt)} /><Row k="Km / combustível" v={`${km(wo.checkOut.km)} · ${wo.checkOut.fuelLevel}%`} />
          <Row k="Retirado por" v={wo.checkOut.receivedBy} /><Row k="Entregue por" v={wo.checkOut.deliveredByName} /><Row k="Recomendações" v={wo.checkOut.recommendations} />
          {wo.checkOut.signatureData && <img src={wo.checkOut.signatureData} alt="Assinatura da entrega" className="mt-1 h-16 border-b border-line" />}
          <p className="text-xs">SHA-256 {wo.checkOut.contentHash}</p>
        </section>
      )}
      <footer className="mt-6 text-center text-[11px] text-muted">Documento gerado pelo sistema OneSportcar. Sem valor fiscal.</footer>
    </article>
  );
}
