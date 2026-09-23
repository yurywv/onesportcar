import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toLocalInput } from "@/lib/format";
import { CHECKIN_CONDITIONS, CONDITION_OPTIONS, DASH_LIGHTS } from "@/lib/checklists";
import { PageHeader, Field, Section } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { DamageMap } from "@/components/damage-map";
import { SignaturePad } from "@/components/signature-pad";
import { createCheckIn } from "../actions";

export const metadata = { title: "Novo check-in" };

export default async function NewCheckIn({ searchParams }: { searchParams: Promise<{ agendamento?: string; veiculo?: string }> }) {
  const user = await requireUser("os:criar");
  const sp = await searchParams;
  const appt = sp.agendamento ? await db.appointment.findUnique({ where: { id: sp.agendamento } }) : null;
  const [vehicles, techs, bays, consultants] = await Promise.all([
    db.vehicle.findMany({ where: { active: true }, include: { customer: true }, orderBy: { model: "asc" } }),
    db.user.findMany({ where: { role: "TECNICO", active: true }, orderBy: { name: "asc" } }),
    db.workshopBay.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.user.findMany({ where: { role: { in: ["CONSULTOR", "GESTOR"] }, active: true }, orderBy: { name: "asc" } }),
  ]);
  const vehicleId = appt?.vehicleId ?? sp.veiculo ?? "";
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const ev = vehicle?.propulsion === "ELETRICO";
  const promised = toLocalInput(new Date(Date.now() + 2 * 86400_000));

  return (
    <>
      <PageHeader title="Novo check-in" subtitle="Abre a OS e registra a entrada do veículo" back={<Link href="/os" className="link text-xs">← Ordens de serviço</Link>} />
      <ActionForm action={createCheckIn} className="space-y-5">
        {appt && <input type="hidden" name="appointmentId" value={appt.id} />}
        <Section title="1 · Veículo e atendimento">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Veículo *" className="sm:col-span-2">
              <select name="vehicleId" className="select" required defaultValue={vehicleId}>
                <option value="">Selecione…</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.make} {v.model} — {v.customer.name} ({v.mileage.toLocaleString("pt-BR")} km)</option>)}
              </select>
            </Field>
            <Field label="Consultor"><select name="consultantId" className="select" defaultValue={appt?.consultantId ?? user.id}>{consultants.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Prioridade"><select name="priority" className="select" defaultValue={appt?.priority ?? "NORMAL"}>{["BAIXA", "NORMAL", "ALTA", "URGENTE"].map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Técnico"><select name="technicianId" className="select" defaultValue={appt?.technicianId ?? ""}><option value="">A definir</option>{techs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Box"><select name="bayId" className="select" defaultValue={appt?.bayId ?? ""}><option value="">A definir</option>{bays.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.description}</option>)}</select></Field>
            <Field label="Previsão de entrega"><input type="datetime-local" name="promisedAt" className="input" defaultValue={promised} /></Field>
            <Field label="Chegada">
              <select name="arrivalMode" className="select" defaultValue={appt?.pickup ? "LEVA_E_TRAZ" : "RODANDO"}><option value="RODANDO">Rodando</option><option value="GUINCHO">Guincho</option><option value="LEVA_E_TRAZ">Leva-e-traz</option></select>
            </Field>
            <Field label="Reclamação do cliente (texto original) *" className="sm:col-span-2 lg:col-span-4">
              <textarea name="complaint" className="textarea" required defaultValue={appt?.complaint ?? appt?.services ?? ""} placeholder="Registre com as palavras do cliente" />
            </Field>
          </div>
        </Section>

        <Section title="2 · Entrada">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Quilometragem *"><input name="km" className="input" inputMode="numeric" required defaultValue={vehicle?.mileage ?? ""} /></Field>
            <Field label={ev ? "Carga da bateria (SoC %) *" : "Combustível / carga (%) *"}><input name="fuelLevel" type="number" min={0} max={100} className="input" required defaultValue={50} /></Field>
            <Field label="Autonomia (km)"><input name="range" className="input" inputMode="numeric" /></Field>
            <Field label="Justificativa de km" hint="Só se menor que o último registro"><input name="kmJustification" className="input" /></Field>
            <Field label="Quem trouxe *"><input name="broughtBy" className="input" required /></Field>
            <Field label="Relação com o titular">
              <select name="broughtByRelation" className="select"><option value="TITULAR">Titular</option><option value="TERCEIRO_AUTORIZADO">Terceiro autorizado</option><option value="MOTORISTA">Motorista</option><option value="GUINCHO">Guincho</option></select>
            </Field>
            <Field label="Chaves entregues"><input name="keysCount" type="number" min={0} className="input" defaultValue={2} /></Field>
            <div className="flex flex-col justify-end gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="hasManual" /> Manual</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="hasDocuments" /> Documento do veículo</label>
            </div>
          </div>
          <fieldset className="mt-4">
            <legend className="label">Luzes acesas no painel</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {DASH_LIGHTS.map((l) => <label key={l} className="flex items-center gap-2"><input type="checkbox" name="dashLights" value={l} /> {l}</label>)}
            </div>
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Objetos pessoais no veículo"><input name="personalItems" className="input" placeholder="Ex.: óculos no porta-luvas" /></Field>
            <Field label="Acessórios"><input name="accessories" className="input" placeholder="Ex.: carregador portátil, tapetes extras" /></Field>
          </div>
        </Section>

        <Section title="3 · Estado do veículo">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CHECKIN_CONDITIONS.map((c) => (
              <Field key={c} label={c}>
                <select name={`cond_${c}`} className="select" defaultValue="OK">{CONDITION_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select>
              </Field>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Observações externas"><textarea name="exteriorNotes" className="textarea" /></Field>
            <Field label="Observações internas"><textarea name="interiorNotes" className="textarea" /></Field>
          </div>
          <h3 className="mt-5 mb-2 text-sm font-semibold">Mapa de avarias</h3>
          <DamageMap />
          <p className="mt-3 text-xs text-muted">Fotos e vídeos: o armazenamento de arquivos ainda não está configurado neste ambiente (ver docs/ENTREGA-MVP.md).</p>
        </Section>

        <Section title="4 · Assinatura do cliente">
          <p className="mb-3 text-sm text-muted">O cliente confirma as informações acima. Após assinar, o check-in é selado (hash SHA-256) e não pode mais ser alterado. É possível salvar sem assinatura e assinar depois na tela da OS.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome de quem assina"><input name="signedName" className="input" /></Field>
            <SignaturePad />
          </div>
        </Section>
        <Submit className="btn btn-primary w-full sm:w-auto">Abrir OS e registrar check-in</Submit>
      </ActionForm>
    </>
  );
}
