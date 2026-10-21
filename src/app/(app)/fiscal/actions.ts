"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, req, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { prepareNfse, prepareNfe, transmit, refreshStatus, cancelDocument, FISCAL_STATUS_LABEL } from "@/lib/fiscal";

const refresh = (woId?: string | null) => { revalidatePath("/fiscal"); if (woId) revalidatePath(`/os/${woId}`); };

export async function prepareFiscalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("fiscal:emitir");
    const woId = req(fd, "workOrderId", "OS");
    const kind = String(fd.get("kind"));
    const doc = kind === "NFSE" ? await prepareNfse(woId, user) : kind === "NFE" ? await prepareNfe(woId, user) : null;
    if (!doc) throw new RuleError("Tipo de nota inválido.");
    refresh(woId);
    if (fd.get("send") === "1") {
      const sent = await transmit(doc.id, user);
      refresh(woId);
      return `${kind === "NFSE" ? "NFS-e" : "NF-e"}: ${FISCAL_STATUS_LABEL[sent.status]}${sent.message ? ` — ${sent.message}` : ""}`;
    }
    return "Prévia gerada. Confira e transmita.";
  });
}

export async function emitFiscalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("fiscal:emitir");
    const doc = await transmit(String(fd.get("id")), user);
    refresh(doc.workOrderId);
    return `${FISCAL_STATUS_LABEL[doc.status]}${doc.message ? ` — ${doc.message}` : ""}`;
  });
}

export async function refreshFiscalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("fiscal:emitir");
    const doc = await refreshStatus(String(fd.get("id")), user);
    refresh(doc.workOrderId);
    return `${FISCAL_STATUS_LABEL[doc.status]}${doc.message ? ` — ${doc.message}` : ""}`;
  });
}

export async function cancelFiscalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("fiscal:emitir");
    const doc = await cancelDocument(String(fd.get("id")), req(fd, "reason", "Justificativa"), user);
    refresh(doc.workOrderId);
    return `${FISCAL_STATUS_LABEL[doc.status]}${doc.message ? ` — ${doc.message}` : ""}`;
  });
}

export async function discardFiscalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("fiscal:emitir");
    const id = String(fd.get("id"));
    const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id } });
    if (!["RASCUNHO", "ERRO"].includes(doc.status)) throw new RuleError("Só rascunhos e notas que não chegaram à prefeitura/SEFAZ podem ser descartados. Nota rejeitada: corrija o cadastro e transmita de novo.");
    await db.$transaction(async (tx) => {
      await tx.fiscalDocument.delete({ where: { id } });
      await audit({ action: "DELETE", entity: "FiscalDocument", entityId: id, userId: user.id, userName: user.name, before: { kind: doc.kind, status: doc.status, total: doc.total, ref: doc.ref } }, tx);
    });
    refresh(doc.workOrderId);
    return "Rascunho descartado.";
  });
}
