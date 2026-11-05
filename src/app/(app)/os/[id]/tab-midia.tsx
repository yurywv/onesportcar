import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { PHASES, PHASE_LABEL, phaseOf } from "@/lib/phases";
import { camerasForPhase } from "@/lib/cameras";
import { Section, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { PhotoUploader } from "@/components/photo-uploader";
import { CameraPlayer } from "@/components/camera-player";
import { addPhoto, togglePhoto, assignCamera, unassignCamera } from "../flow-actions";
import type { TabProps } from "./types";

/** Fotos do veículo por fase e câmeras associadas à OS em cada fase. */
export async function TabMidia({ wo, user }: TabProps) {
  const current = phaseOf(wo.status);
  const canPhoto = can(user.role, "fotos:adicionar");
  const canCfg = can(user.role, "cameras:configurar");
  const defaults = await db.cameraPhaseDefault.findMany({ where: { camera: { active: true } }, include: { camera: { select: { name: true } } } });
  const [live, allCams] = await Promise.all([
    can(user.role, "cameras:ver") ? camerasForPhase(wo.id, current) : Promise.resolve([]),
    canCfg ? db.camera.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const defaultPhase = current && current !== "AGENDAMENTO" ? current : "CHECK_IN";
  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <div className="space-y-5">
        {canPhoto && (
          <Section title="Tirar fotos">
            {wo.status === "CHECK_IN" && <p className="alert alert-info mb-3">Fotografe o carro todo na chegada (4 lados, rodas, painel com km e combustível, interior). As fotos ficam no check-in e aparecem para o cliente no app.</p>}
            <PhotoUploader workOrderId={wo.id} action={addPhoto} defaultPhase={defaultPhase} phases={PHASES.filter((p) => p !== "AGENDAMENTO").map((p) => ({ value: p, label: PHASE_LABEL[p] }))} />
          </Section>
        )}
        {PHASES.map((p) => {
          const list = wo.photos.filter((ph) => ph.phase === p);
          if (!list.length) return null;
          return (
            <Section key={p} title={`Fotos — ${PHASE_LABEL[p]} (${list.length})`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {list.map((ph) => (
                  <div key={ph.id} className="overflow-hidden rounded-lg border border-line">
                    <a href={`/fotos/${ph.id}`} target="_blank" rel="noreferrer"><img src={`/fotos/${ph.id}`} alt={ph.caption ?? ""} loading="lazy" className="aspect-[4/3] w-full object-cover" /></a>
                    <div className="space-y-1 p-1.5 text-[11px]">
                      <div className="truncate">{ph.caption ?? "—"}</div>
                      <div className="text-muted">{ph.createdByName} · {dateTime(ph.createdAt)}</div>
                      {canPhoto ? (
                        <ActionForm action={togglePhoto}><input type="hidden" name="id" value={ph.id} /><Submit className={`btn btn-sm w-full ${ph.visibleToCustomer ? "" : "btn-ghost"}`}>{ph.visibleToCustomer ? "👁 Cliente vê" : "🔒 Interna"}</Submit></ActionForm>
                      ) : <span className="badge">{ph.visibleToCustomer ? "Cliente vê" : "Interna"}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          );
        })}
        {!wo.photos.length && !canPhoto && <Empty>Nenhuma foto.</Empty>}
      </div>

      <div className="space-y-5">
        {live.length > 0 && (
          <Section title={`Ao vivo — ${current ? PHASE_LABEL[current] : ""}`}>
            <div className="space-y-3">{live.map((c) => <CameraPlayer key={c.id} cam={c} />)}</div>
          </Section>
        )}
        <Section title="Câmeras por fase">
          <p className="mb-3 text-xs text-muted">O cliente assiste no app à câmera da fase em que o carro está. Ao entrar em cada fase, a OS recebe as câmeras padrão da fase (Administração → Câmeras); ajuste aqui se o carro estiver em outro box.</p>
          <ul className="divide-y divide-line text-sm">
            {PHASES.map((p) => {
              const list = wo.cameras.filter((c) => c.phase === p);
              return (
                <li key={p} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <b className={p === current ? "text-accent" : ""}>{PHASE_LABEL[p]}{p === current && " • agora"}</b>
                    {!list.length && <span className="text-xs text-muted">{defaults.filter((d) => d.phase === p).map((d) => d.camera.name).join(", ") || "sem câmera"} (padrão)</span>}
                  </div>
                  {list.map((a) => (
                    <div key={a.id} className="mt-1 flex items-center justify-between gap-2">
                      <span>{a.camera.name}{a.camera.location && <span className="text-xs text-muted"> · {a.camera.location}</span>}{!a.camera.active && <span className="badge ml-1">inativa</span>}</span>
                      {canCfg && <ActionForm action={unassignCamera}><input type="hidden" name="id" value={a.id} /><Submit className="btn btn-ghost btn-sm text-danger">remover</Submit></ActionForm>}
                    </div>
                  ))}
                  {canCfg && allCams.length > 0 && (
                    <ActionForm action={assignCamera} className="mt-1 flex gap-1">
                      <input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="phase" value={p} />
                      <select name="cameraId" className="select !min-h-8 text-xs" required defaultValue=""><option value="" disabled>Adicionar câmera…</option>{allCams.map((c) => <option key={c.id} value={c.id}>{c.name}{c.location ? ` · ${c.location}` : ""}</option>)}</select>
                      <Submit className="btn btn-sm">+</Submit>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}
