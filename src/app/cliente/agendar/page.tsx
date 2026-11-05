import { requireCustomer } from "@/lib/customer-auth";
import { db } from "@/lib/db";
import { formatPlate } from "@/lib/validators";
import { ActionForm, Submit } from "@/components/forms";
import { portalSchedule } from "../actions";

export const metadata = { title: "Agendar" };

const HOURS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];

export default async function Schedule({ searchParams }: { searchParams: Promise<{ veiculo?: string; tipo?: string }> }) {
  const c = await requireCustomer();
  const sp = await searchParams;
  const vehicles = await db.vehicle.findMany({ where: { customerId: c.id, active: true }, orderBy: { model: "asc" } });
  const services = await db.serviceCatalog.findMany({ where: { active: true }, select: { name: true, category: true }, orderBy: [{ category: "asc" }, { name: "asc" }], take: 200 });
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">Agendar</h1>
      <p className="mt-1 text-sm text-muted">Escolha o veículo, o tipo de atendimento e o melhor horário. A recepção confirma pelo WhatsApp.</p>
      <ActionForm action={portalSchedule} className="card card-pad mt-4 space-y-3" reset>
        <label className="block"><span className="label">Veículo *</span>
          <select name="vehicleId" className="select" required defaultValue={sp.veiculo ?? vehicles[0]?.id}>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model} · {formatPlate(v.plate)}</option>)}</select>
        </label>
        <fieldset className="grid grid-cols-2 gap-2 text-sm">
          <label className="card flex items-start gap-2 p-3"><input type="radio" name="kind" value="SERVICO" defaultChecked={sp.tipo !== "diagnostico"} className="mt-1" /><span><b>Serviço</b><br /><span className="text-xs text-muted">Revisão, troca de óleo, pneus, estética…</span></span></label>
          <label className="card flex items-start gap-2 p-3"><input type="radio" name="kind" value="DIAGNOSTICO" defaultChecked={sp.tipo === "diagnostico"} className="mt-1" /><span><b>Diagnóstico</b><br /><span className="text-xs text-muted">Barulho, luz no painel, falha…</span></span></label>
        </fieldset>
        <label className="block"><span className="label">Serviço (opcional)</span>
          <input name="service" className="input" list="svc" placeholder="Ex.: Revisão anual" />
          <datalist id="svc">{services.map((s) => <option key={`${s.category}-${s.name}`} value={s.name} />)}</datalist>
        </label>
        <label className="block"><span className="label">Descreva o que precisa ou o que o carro está apresentando *</span><textarea name="complaint" className="textarea" required /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="label">Data *</span><input type="date" name="date" min={tomorrow} defaultValue={tomorrow} className="input" required /></label>
          <label className="block"><span className="label">Horário *</span><select name="time" className="select" required>{HOURS.map((h) => <option key={h}>{h}</option>)}</select></label>
        </div>
        <details className="text-sm"><summary className="cursor-pointer">Quero o leva-e-traz</summary>
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" name="pickup" /> Buscar o carro no endereço abaixo</label>
          <input name="pickupAddress" className="input mt-2" placeholder="Endereço de retirada" />
        </details>
        <Submit className="btn btn-primary w-full">Solicitar agendamento</Submit>
      </ActionForm>
    </div>
  );
}
