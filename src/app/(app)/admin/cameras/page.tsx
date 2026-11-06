import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PHASES, PHASE_LABEL } from "@/lib/phases";
import { PageHeader, Section, Field, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { CameraPlayer } from "@/components/camera-player";
import { saveCamera, deleteCamera } from "./actions";

export const metadata = { title: "Câmeras" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { HLS: "Vídeo HLS (.m3u8)", IFRAME: "Player embutido (link do NVR/nuvem)", MJPEG: "MJPEG (https)", SNAPSHOT: "Imagem atualizada (JPEG)" };

export default async function Cameras({ searchParams }: { searchParams: Promise<{ editar?: string; ver?: string }> }) {
  await requireUser("cameras:configurar");
  const sp = await searchParams;
  const cams = await db.camera.findMany({ include: { phases: true }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const edit = sp.editar ? cams.find((c) => c.id === sp.editar) : null;
  const view = sp.ver ? cams.find((c) => c.id === sp.ver) : null;
  const byPhase = PHASES.map((p) => [p, cams.filter((c) => c.active && c.phases.some((x) => x.phase === p))] as const);

  return (
    <>
      <PageHeader title="Câmeras da oficina" subtitle="O cliente assiste pelo app à câmera da fase em que o carro está (agendamento → check-out)." actions={<Link href="?editar=" className="btn btn-primary">Nova câmera</Link>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <Section title="Câmeras por fase">
            <ul className="divide-y divide-line text-sm">
              {byPhase.map(([p, list]) => (
                <li key={p} className="flex flex-wrap justify-between gap-2 py-2"><b>{PHASE_LABEL[p]}</b><span className="text-muted">{list.length ? list.map((c) => c.name).join(", ") : "nenhuma câmera"}</span></li>
              ))}
            </ul>
          </Section>
          <Section title={`Cadastradas (${cams.length})`}>
            {cams.length ? (
              <ul className="divide-y divide-line text-sm">
                {cams.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <b>{c.name}</b>{c.location && <span className="text-muted"> · {c.location}</span>} {!c.active && <span className="badge">inativa</span>} {!c.customerVisible && <span className="badge">só equipe</span>}
                      <div className="text-xs text-muted">{KIND_LABEL[c.kind]} · {c.phases.map((p) => PHASE_LABEL[p.phase]).join(", ") || "sem fase padrão"}</div>
                    </div>
                    <div className="flex gap-1">
                      <Link href={`?ver=${c.id}`} className="btn btn-sm">Ver</Link>
                      <Link href={`?editar=${c.id}`} className="btn btn-sm">Editar</Link>
                      <ActionForm action={deleteCamera} confirm="Excluir esta câmera?"><input type="hidden" name="id" value={c.id} /><Submit className="btn btn-ghost btn-sm text-danger">Excluir</Submit></ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nenhuma câmera cadastrada.</Empty>}
          </Section>
        </div>
        <div className="space-y-5">
          {view && <Section title={`Pré-visualização — ${view.name}`}><CameraPlayer cam={{ id: view.id, name: view.name, location: view.location, kind: view.kind, src: view.kind === "SNAPSHOT" ? `/camera/${view.id}` : view.url }} /></Section>}
          {sp.editar !== undefined && (
            <Section title={edit ? `Editar ${edit.name}` : "Nova câmera"}>
              <ActionForm action={saveCamera} className="space-y-3" reset={!edit}>
                {edit && <input type="hidden" name="id" value={edit.id} />}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nome *"><input name="name" className="input" defaultValue={edit?.name} placeholder="Box 2 — elevador" required /></Field>
                  <Field label="Local"><input name="location" className="input" defaultValue={edit?.location ?? ""} placeholder="Oficina, Recepção, Lavagem" /></Field>
                </div>
                <Field label="Tipo"><select name="kind" className="select" defaultValue={edit?.kind ?? "HLS"}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Endereço (URL) *" hint="HLS/iframe/MJPEG: https e sem senha na URL (o navegador do cliente acessa direto). SNAPSHOT: pode ter usuário:senha — o servidor busca a imagem."><input name="url" className="input font-mono text-xs" defaultValue={edit?.url} required /></Field>
                <fieldset>
                  <legend className="label">Câmera padrão nas fases</legend>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                    {PHASES.map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`ph_${p}`} defaultChecked={edit?.phases.some((x) => x.phase === p)} /> {PHASE_LABEL[p]}</label>)}
                  </div>
                </fieldset>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={edit?.active ?? true} /> Ativa</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="customerVisible" defaultChecked={edit?.customerVisible ?? true} /> Cliente pode assistir</label>
                </div>
                <Field label="Observações"><textarea name="notes" className="textarea" defaultValue={edit?.notes ?? ""} /></Field>
                <Submit>Salvar câmera</Submit>
              </ActionForm>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
