import Link from "next/link";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, km, money, toLocalInput, minutesLabel } from "@/lib/format";
import type { Snapshot } from "@/lib/estimate";
import { Section, DL, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { DamageMap } from "@/components/damage-map";
import { SignaturePad } from "@/components/signature-pad";
import { updateWorkOrder, signCheckIn } from "../actions";
import type { TabProps } from "./types";

const ARRIVAL: Record<string, string> = { RODANDO: "Rodando", GUINCHO: "Guincho", LEVA_E_TRAZ: "Leva-e-traz" };

export async function TabResumo({ wo, user, names, totals, showMoney }: TabProps) {
  const ci = wo.checkIn;
  const editable = can(user.role, "os:transicionar") && !["ENTREGUE", "CANCELADA"].includes(wo.status);
  const [techs, bays, consultants] = editable ? await Promise.all([
    db.user.findMany({ where: { role: "TECNICO", active: true }, orderBy: { name: "asc" } }),
    db.workshopBay.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.user.findMany({ where: { role: { in: ["CONSULTOR", "GESTOR"] }, active: true }, orderBy: { name: "asc" } }),
  ]) : [[], [], []];

  // Rastreabilidade (spec §24)
  const approvals = wo.estimates.flatMap((e) => e.versions.flatMap((v) => v.approvals.map((a) => ({ ...a, est: e.number, v: v.version, snap: v.snapshot as unknown as Snapshot }))));
  const lastQC = wo.qualityChecks.at(-1);
  const executors = [...new Set(wo.timeEntries.map((t) => t.technicianName))];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {ci && !ci.locked && can(user.role, "os:criar") && (
          <Section title="Assinatura do check-in pendente">
            <ActionForm action={signCheckIn} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="checkInId" value={ci.id} />
              <Field label="Nome de quem assina *"><input name="signedName" className="input" defaultValue={ci.broughtBy} required /></Field>
              <SignaturePad />
              <Submit>Assinar e selar check-in</Submit>
            </ActionForm>
          </Section>
        )}

        <Section title="Rastreabilidade">
          <DL items={[
            ["Quem trouxe / como chegou", ci ? `${ci.broughtBy} (${ci.broughtByRelation.toLowerCase().replace(/_/g, " ")}) · ${ARRIVAL[ci.arrivalMode] ?? ci.arrivalMode}` : "—"],
            ["Chegada", dateTime(wo.openedAt)],
            ["Km / combustível na entrada", ci ? `${km(ci.km)} · ${ci.fuelLevel}%` : "—"],
            ["Problema relatado", wo.complaint],
            ["Diagnóstico por", wo.diagnostics.map((d) => d.technicianName).join(", ") || "—"],
            ["Diagnóstico", wo.diagnostics.at(-1)?.diagnosis ?? "—"],
            ["Orçamentos enviados", wo.estimates.map((e) => `${e.number} (v${e.versions[0]?.version ?? 0})`).join(", ") || "—"],
            ["Aprovado por", [...new Set(approvals.filter((a) => a.decision === "APROVADO").map((a) => `${a.approverName} via ${a.channel.toLowerCase()} em ${dateTime(a.createdAt)}`))].join("; ") || "—"],
            ["Executado por", executors.join(", ") || "—"],
            ["Tempo vendido / trabalhado", `${minutesLabel(totals.soldMin)} / ${minutesLabel(totals.workedMin)}`],
            ["Peças aplicadas", wo.parts.filter((p) => p.status === "APLICADA").map((p) => `${p.quantity}× ${p.description}`).join(", ") || "—"],
            ["Controle de qualidade", lastQC ? `${lastQC.result} por ${lastQC.inspectorName} (${wo.qualityChecks.length} tentativa(s))` : "—"],
            ...(showMoney ? [["Cobrado / pago", `${money(totals.total)} / ${money(totals.paid)}`] as [string, string]] : []),
            ...(can(user.role, "orcamento:ver_custos") ? [["Margem bruta", `${money(totals.margin)}${totals.marginPct !== null ? ` (${(totals.marginPct * 100).toFixed(1)}%)` : ""}`] as [string, string]] : []),
            ["Saída", wo.checkOut ? `${dateTime(wo.checkOut.createdAt)} · ${km(wo.checkOut.km)} · retirado por ${wo.checkOut.receivedBy}` : "—"],
            ["Entrega autorizada por", wo.checkOut?.deliveredByName ?? "—"],
          ]} />
        </Section>

        {ci && (
          <Section title={`Check-in ${ci.number}`} actions={<a href={`/os/${wo.id}/imprimir`} target="_blank" className="link text-xs">Imprimir</a>}>
            <DL items={[
              ["Chaves", String(ci.keysCount)], ["Manual / documento", `${ci.hasManual ? "sim" : "não"} / ${ci.hasDocuments ? "sim" : "não"}`],
              ["Luzes no painel", ci.dashLights.join(", ") || "nenhuma"], ["Autonomia", ci.range ? km(ci.range) : "—"],
              ["Objetos pessoais", ci.personalItems], ["Acessórios", ci.accessories],
              ["Estado", Object.entries(ci.conditions as Record<string, string>).filter(([, v]) => v !== "OK").map(([k, v]) => `${k}: ${v}`).join(" · ") || "Tudo OK"],
              ["Observações", [ci.exteriorNotes, ci.interiorNotes].filter(Boolean).join(" / ") || "—"],
            ]} />
            <div className="mt-4"><DamageMap readOnly initial={ci.damages.map((d) => ({ x: d.x, y: d.y, type: d.type, severity: d.severity, note: d.note ?? undefined }))} /></div>
            <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
              {ci.locked ? <>Assinado por <b className="text-fg">{ci.signedName}</b> em {dateTime(ci.signedAt)} · IP {ci.signedIp ?? "—"} · SHA-256 <span className="font-mono break-all">{ci.contentHash}</span></> : "Aguardando assinatura do cliente."}
            </div>
          </Section>
        )}
      </div>

      <div className="space-y-5">
        <Section title="Responsáveis e prazo">
          {editable ? (
            <ActionForm action={updateWorkOrder} className="space-y-3">
              <input type="hidden" name="id" value={wo.id} />
              <Field label="Consultor"><select name="consultantId" className="select" defaultValue={wo.consultantId ?? ""}><option value="">—</option>{consultants.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Técnico"><select name="technicianId" className="select" defaultValue={wo.technicianId ?? ""}><option value="">A definir</option>{techs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Box"><select name="bayId" className="select" defaultValue={wo.bayId ?? ""}><option value="">—</option>{bays.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.description}</option>)}</select></Field>
              <Field label="Previsão"><input type="datetime-local" name="promisedAt" className="input" defaultValue={wo.promisedAt ? toLocalInput(wo.promisedAt) : ""} /></Field>
              <Field label="Prioridade"><select name="priority" className="select" defaultValue={wo.priority}>{["BAIXA", "NORMAL", "ALTA", "URGENTE"].map((p) => <option key={p}>{p}</option>)}</select></Field>
              <Field label="Notas internas"><textarea name="notes" className="textarea" defaultValue={wo.notes ?? ""} /></Field>
              <Submit className="btn w-full">Salvar</Submit>
            </ActionForm>
          ) : (
            <DL items={[["Consultor", wo.consultantId ? names.get(wo.consultantId) : "—"], ["Técnico", wo.technicianId ? names.get(wo.technicianId) : "—"], ["Box", wo.bay?.code], ["Notas", wo.notes]]} />
          )}
        </Section>
        {showMoney && (
          <Section title="Valores">
            <DL items={[["Serviços", money(totals.servicesTotal)], ["Peças e outros", money(totals.partsTotal)], ["Total", money(totals.total)], ["Pago", money(totals.paid)], ["Saldo", money(totals.due)]]} />
          </Section>
        )}
        {wo.cancelReason && <p className="alert alert-error">Cancelada: {wo.cancelReason}</p>}
        <Link href={`/veiculos/${wo.vehicleId}`} className="btn w-full">Histórico do veículo</Link>
      </div>
    </div>
  );
}
