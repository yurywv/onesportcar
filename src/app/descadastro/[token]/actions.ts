"use server";
import { revalidatePath } from "next/cache";
import { run, req, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { unsubscribeByToken } from "@/lib/unsubscribe";

export async function confirmUnsubscribe(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const token = req(fd, "token", "token");
    const c = await unsubscribeByToken(token, "página");
    if (!c) throw new RuleError("Link inválido.");
    revalidatePath(`/descadastro/${token}`);
    return "Descadastro confirmado. Você não receberá mais nossas campanhas.";
  });
}
