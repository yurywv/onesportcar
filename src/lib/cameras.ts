import "server-only";
import type { ServicePhase } from "@prisma/client";
import { db } from "./db";
import type { CameraView } from "@/components/camera-player";

/** Câmeras da OS numa fase (as associadas; se nenhuma, as padrão da fase). */
export async function camerasForPhase(workOrderId: string, phase: ServicePhase | null, opts: { customer?: boolean } = {}) {
  if (!phase) return [];
  const where = { active: true, ...(opts.customer ? { customerVisible: true } : {}) };
  const assigned = await db.workOrderCamera.findMany({ where: { workOrderId, phase, camera: where }, include: { camera: true }, orderBy: { createdAt: "asc" } });
  const cams = assigned.length ? assigned.map((a) => a.camera) : (await db.cameraPhaseDefault.findMany({ where: { phase, camera: where }, include: { camera: true } })).map((d) => d.camera);
  return cams.map<CameraView>((c) => ({
    id: c.id, name: c.name, location: c.location, kind: c.kind,
    // Imagem atualizada passa pelo servidor (esconde usuário/senha da câmera); vídeo vai direto do servidor de vídeo.
    src: c.kind === "SNAPSHOT" ? `/camera/${c.id}?os=${workOrderId}` : c.url,
  }));
}
