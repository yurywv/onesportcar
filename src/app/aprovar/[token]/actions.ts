"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requestMeta } from "@/lib/auth";
import { sha256 } from "@/lib/hash";
import { run, req, bool, str, type ActionState } from "@/lib/action";
import { recordDecisions, type Snapshot } from "@/lib/estimate";
import { RuleError } from "@/lib/workflow";

export async function customerDecision(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const token = String(fd.get("token") ?? "");
    const link = await db.approvalLink.findUnique({ where: { tokenHash: sha256(token) }, include: { version: true } });
    if (!link || link.revokedAt || link.expiresAt < new Date()) throw new RuleError("Este link não é mais válido. Solicite um novo link ao seu consultor.");
    if (!bool(fd, "accept")) throw new RuleError("Confirme que leu e concorda com os itens selecionados.");
    const snap = link.version.snapshot as unknown as Snapshot;
    const meta = await requestMeta();
    const res = await db.$transaction((tx) => recordDecisions(tx, link.versionId, snap.items.map((i) => ({ itemId: i.id, decision: fd.get(`d_${i.id}`) === "APROVADO" ? "APROVADO" : "RECUSADO" })), {
      channel: "LINK", approverName: req(fd, "name", "Seu nome"), removedPartsDestination: str(fd, "removedParts"), ip: meta.ip, userAgent: meta.userAgent,
      evidence: `Aceite eletrônico via link (token ${link.id.slice(0, 8)})`,
    }, null));
    revalidatePath(`/aprovar/${token}`);
    return `Obrigado! Registramos sua resposta: ${res.approved} de ${res.total} item(ns) aprovado(s). Seu consultor foi notificado no sistema.`;
  });
}
