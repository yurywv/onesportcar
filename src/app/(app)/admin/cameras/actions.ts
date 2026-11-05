"use server";
import { revalidatePath } from "next/cache";
import type { ServicePhase } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, req, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { PHASES } from "@/lib/phases";

const KINDS = ["HLS", "IFRAME", "MJPEG", "SNAPSHOT"];

export async function saveCamera(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("cameras:configurar");
    const id = str(fd, "id");
    const kind = str(fd, "kind") ?? "HLS";
    if (!KINDS.includes(kind)) throw new RuleError("Tipo de câmera inválido.");
    const url = req(fd, "url", "Endereço da câmera");
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new RuleError("Endereço inválido. Use a URL completa (https://…)."); }
    if (kind !== "SNAPSHOT" && parsed.protocol !== "https:") throw new RuleError("Vídeo exibido no navegador precisa ser HTTPS. (Imagens SNAPSHOT podem ser HTTP: o servidor busca.)");
    if (kind !== "SNAPSHOT" && parsed.username) throw new RuleError("Não coloque usuário/senha na URL de vídeo — ela é vista pelo navegador do cliente. Use um link de compartilhamento/token do NVR ou o tipo SNAPSHOT.");
    const phases = PHASES.filter((p) => bool(fd, `ph_${p}`)) as ServicePhase[];
    const data = { name: req(fd, "name", "Nome"), location: str(fd, "location"), kind, url, active: bool(fd, "active"), customerVisible: bool(fd, "customerVisible"), notes: str(fd, "notes") };
    const cam = await db.$transaction(async (tx) => {
      const c = id ? await tx.camera.update({ where: { id }, data }) : await tx.camera.create({ data });
      await tx.cameraPhaseDefault.deleteMany({ where: { cameraId: c.id, phase: { notIn: phases } } });
      await tx.cameraPhaseDefault.createMany({ data: phases.map((phase) => ({ cameraId: c.id, phase })), skipDuplicates: true });
      await audit({ action: id ? "UPDATE" : "CREATE", entity: "Camera", entityId: c.id, userId: user.id, userName: user.name, after: { name: c.name, kind, phases } }, tx);
      return c;
    });
    revalidatePath("/admin/cameras");
    return `Câmera "${cam.name}" salva.`;
  });
}

export async function deleteCamera(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("cameras:configurar");
    const id = req(fd, "id", "Câmera");
    const used = await db.workOrderCamera.count({ where: { cameraId: id } });
    if (used) {
      await db.camera.update({ where: { id }, data: { active: false } });
      revalidatePath("/admin/cameras");
      return "Câmera usada em OS anteriores — foi desativada (o histórico é mantido).";
    }
    await db.camera.delete({ where: { id } });
    await audit({ action: "DELETE", entity: "Camera", entityId: id, userId: user.id, userName: user.name });
    revalidatePath("/admin/cameras");
    return "Câmera excluída.";
  });
}
