import Link from "next/link";
import { notFound } from "next/navigation";
import type { ServicePhase } from "@prisma/client";
import { requireCustomer } from "@/lib/customer-auth";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { formatPlate } from "@/lib/validators";
import { STATUS_LABEL } from "@/lib/workflow";
import { PHASES, PHASE_LABEL, phaseOf } from "@/lib/phases";
import { camerasForPhase } from "@/lib/cameras";
import { ITEM_CLASS_LABEL, type Snapshot } from "@/lib/estimate";
import { PhaseStepper } from "@/components/phase-stepper";
import { CameraPlayer } from "@/components/camera-player";
import { ActionForm, Submit } from "@/components/forms";
import { portalDecision } from "../../actions";

export const metadata = { title: "Acompanhar manutenção" };
const CLASS_TONE: Record<string, string> = { OBRIGATORIO: "badge badge-danger", RECOMENDADO: "badge badge-warn", PREVENTIVO: "badge badge-info", OPCIONAL: "badge" };

// O cliente vê etapas, check-in, fotos liberadas, orçamento e câmeras — nunca o diagnóstico técnico detalhado.
export default async function PortalWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const c = await requireCustomer();
  const wo = await db.workOrder.findFirst({
    where: { id: (await params).id, customerId: c.id, legacy: false },
    include: {
      vehicle: true, checkIn: { include: { damages: true } }, statusHistory: { orderBy: { createdAt: "asc" } },
      photos: { where: { visibleToCustomer: true }, select: { id: true, phase: true, caption: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      estimates: { include: { versions: { include: { approvals: true }, orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } },
      services: { where: { status: { not: "CANCELADO" } }, select: { id: true, description: true, status: true } },
    },
  });
  if (!wo) notFound();
  const phase = phaseOf(wo.status);
  const done = ["ENTREGUE", "ENCERRADA_SEM_SERVICO"].includes(wo.status);
  const live = await camerasForPhase(wo.id, phase, { customer: true });
  const byPhase = new Map<ServicePhase, typeof wo.photos>();
  for (const p of wo.photos) byPhase.set(p.phase, [...(byPhase.get(p.phase) ?? []), p]);
  const ci = wo.checkIn;
  const conds = ci ? Object.entries(ci.conditions as Record<string, string>).filter(([, v]) => v && v !== "OK") : [];

  return (
    <div className="space-y-5">
      <Link href="/cliente" className="link text-xs">← Início</Link>
      <section className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{wo.vehicle.make} {wo.vehicle.model} <span className="plate">{formatPlate(wo.vehicle.plate)}</span></h1>
          <span className="badge badge-accent">{STATUS_LABEL[wo.status]}</span>
        </div>
        <PhaseStepper current={phase} done={done} />
        <p className="text-xs text-muted">{wo.number} · aberta em {dateTime(wo.openedAt)}{wo.promisedAt && ` · previsão de entrega ${dateTime(wo.promisedAt)}`}</p>
      </section>

      {live.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Ao vivo — {phase && PHASE_LABEL[phase]}</h2>
          <div className="grid gap-3 sm:grid-cols-2">{live.map((cam) => <CameraPlayer key={cam.id} cam={cam} />)}</div>
          <p className="text-xs text-muted">As imagens mudam de câmera automaticamente conforme o carro avança de etapa.</p>
        </section>
      )}

      {wo.estimates.map((est) => {
        const v = est.versions[0];
        if (!v) return null;
        const snap = v.snapshot as unknown as Snapshot;
        const decided = new Map(v.approvals.map((a) => [a.itemId, a.decision]));
        const pending = est.status === "ENVIADO" && !v.approvals.length;
        return (
          <section key={est.id} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Orçamento {est.number}{est.kind === "COMPLEMENTAR" && " (complementar)"}</h2>
            {pending ? (
              <ActionForm action={portalDecision} className="space-y-3">
                <input type="hidden" name="versionId" value={v.id} />
                <div className="card divide-y divide-line">
                  {snap.items.map((i) => (
                    <div key={i.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <span className={CLASS_TONE[i.classification]}>{ITEM_CLASS_LABEL[i.classification]}</span>
                        <div className="mt-1 font-medium">{i.quantity !== 1 && `${i.quantity}× `}{i.description}</div>
                        <div className="text-sm tabular-nums">{money(i.total)}{i.discount > 0 && <span className="text-xs text-muted"> (desconto de {money(i.discount)})</span>}</div>
                      </div>
                      <div className="flex shrink-0 gap-3 text-sm">
                        <label className="flex items-center gap-1.5"><input type="radio" name={`d_${i.id}`} value="APROVADO" defaultChecked={i.classification !== "OPCIONAL"} /> Aprovar</label>
                        <label className="flex items-center gap-1.5"><input type="radio" name={`d_${i.id}`} value="RECUSADO" defaultChecked={i.classification === "OPCIONAL"} /> Recusar</label>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between p-4 font-semibold"><span>Total</span><span className="tabular-nums">{money(v.total)}</span></div>
                </div>
                {snap.notes && <p className="card card-pad text-sm whitespace-pre-line">{snap.notes}</p>}
                <div className="card card-pad space-y-3">
                  <label className="block"><span className="label">Seu nome completo *</span><input name="name" className="input" defaultValue={c.name} required /></label>
                  <label className="block"><span className="label">Peças substituídas</span>
                    <select name="removedParts" className="select"><option value="DEVOLVER">Quero receber as peças substituídas</option><option value="DESCARTAR">Podem descartar</option></select>
                  </label>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="accept" className="mt-1" required /> Li e autorizo a execução dos itens marcados como “Aprovar”. O aceite registra data, hora, IP e aparelho.</label>
                  <Submit className="btn btn-primary w-full">Enviar resposta</Submit>
                </div>
              </ActionForm>
            ) : (
              <div className="card card-pad">
                <ul className="divide-y divide-line text-sm">
                  {snap.items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2 py-2">
                      <span>{i.quantity !== 1 && `${i.quantity}× `}{i.description}</span>
                      <span className="flex items-center gap-2 tabular-nums">{money(i.total)}
                        {decided.get(i.id) && <span className={decided.get(i.id) === "APROVADO" ? "badge badge-ok" : "badge badge-danger"}>{decided.get(i.id) === "APROVADO" ? "Aprovado" : "Recusado"}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {v.approvals[0] && <p className="mt-2 text-xs text-muted">Respondido por {v.approvals[0].approverName} em {dateTime(v.approvals[0].createdAt)}</p>}
              </div>
            )}
          </section>
        );
      })}

      {wo.services.length > 0 && (
        <section className="card card-pad">
          <h2 className="mb-2 font-semibold">Serviços em andamento</h2>
          <ul className="divide-y divide-line text-sm">
            {wo.services.map((s) => <li key={s.id} className="flex justify-between gap-2 py-1.5"><span>{s.description}</span><span className={s.status === "CONCLUIDO" ? "badge badge-ok" : s.status === "EM_EXECUCAO" ? "badge badge-accent" : "badge"}>{({ PENDENTE: "Na fila", EM_EXECUCAO: "Em execução", PAUSADO: "Pausado", CONCLUIDO: "Concluído" } as Record<string, string>)[s.status] ?? s.status}</span></li>)}
          </ul>
        </section>
      )}

      {ci && (
        <section className="card card-pad space-y-3">
          <h2 className="font-semibold">Check-in {ci.number}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Quilometragem</dt><dd>{ci.km.toLocaleString("pt-BR")} km</dd></div>
            <div><dt className="text-xs text-muted">Combustível / carga</dt><dd>{ci.fuelLevel}%</dd></div>
            <div><dt className="text-xs text-muted">Chaves</dt><dd>{ci.keysCount}</dd></div>
            <div><dt className="text-xs text-muted">Entregue por</dt><dd>{ci.broughtBy}</dd></div>
          </dl>
          {ci.dashLights.length > 0 && <p className="text-sm"><span className="text-muted">Luzes no painel:</span> {ci.dashLights.join(", ")}</p>}
          {conds.length > 0 && <p className="text-sm"><span className="text-muted">Observado na chegada:</span> {conds.map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
          {ci.damages.length > 0 && <p className="text-sm"><span className="text-muted">Avarias marcadas:</span> {ci.damages.map((d) => `${d.type.toLowerCase()} (${d.severity.toLowerCase()})${d.note ? ` — ${d.note}` : ""}`).join("; ")}</p>}
          {(ci.exteriorNotes || ci.interiorNotes) && <p className="text-sm whitespace-pre-line text-muted">{[ci.exteriorNotes, ci.interiorNotes].filter(Boolean).join("\n")}</p>}
          {ci.personalItems && <p className="text-sm"><span className="text-muted">Objetos pessoais:</span> {ci.personalItems}</p>}
          <p className="text-xs text-muted">{ci.locked ? `Assinado por ${ci.signedName} em ${dateTime(ci.signedAt)} · registro selado #${ci.contentHash?.slice(0, 10)}` : "Aguardando assinatura"}</p>
        </section>
      )}

      {PHASES.filter((p) => byPhase.has(p)).map((p) => (
        <section key={p} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Fotos — {PHASE_LABEL[p]}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {byPhase.get(p)!.map((ph) => (
              <a key={ph.id} href={`/fotos/${ph.id}`} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border border-line">
                <img src={`/fotos/${ph.id}`} alt={ph.caption ?? PHASE_LABEL[p]} loading="lazy" className="aspect-[4/3] w-full object-cover transition group-hover:scale-105" />
                <div className="truncate px-2 py-1 text-xs">{ph.caption ?? dateTime(ph.createdAt)}</div>
              </a>
            ))}
          </div>
        </section>
      ))}

      <section className="card card-pad">
        <h2 className="mb-2 font-semibold">Linha do tempo</h2>
        <ol className="space-y-1 text-sm">
          {wo.statusHistory.map((h) => <li key={h.id} className="flex justify-between gap-2"><span>{STATUS_LABEL[h.toStatus]}</span><span className="text-xs text-muted">{dateTime(h.createdAt)}</span></li>)}
        </ol>
      </section>
    </div>
  );
}
