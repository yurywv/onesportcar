"use server";
import { revalidatePath } from "next/cache";
import { assertUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, req, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { getSettings, setSetting, digits, formatBrPhone } from "@/lib/settings";

export async function saveSendSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("marketing:configurar");
    const raw = req(fd, "numero", "Número do WhatsApp comercial");
    let d = digits(raw);
    if (d.length === 10 || d.length === 11) d = "55" + d;
    if (d.length < 12 || d.length > 15) throw new RuleError("Número inválido. Informe com DDD, ex.: +55 19 99628-7848.");
    const phoneId = (str(fd, "phoneNumberId") ?? "").replace(/\s/g, "");
    if (phoneId && !/^\d{6,25}$/.test(phoneId)) throw new RuleError("O ID do número da Meta tem só dígitos (ex.: 123456789012345).");
    const before = await getSettings(["whatsapp.numero", "whatsapp.phoneNumberId", "whatsapp.assinatura"]);
    const numero = formatBrPhone(d);
    await setSetting("whatsapp.numero", numero, user.name);
    await setSetting("whatsapp.phoneNumberId", phoneId, user.name);
    await setSetting("whatsapp.assinatura", str(fd, "assinatura") ?? "", user.name);
    await audit({ action: "UPDATE", entity: "AppSetting", entityId: "whatsapp", userId: user.id, userName: user.name, before, after: { numero, phoneId, assinatura: str(fd, "assinatura") } });
    revalidatePath("/marketing", "layout");
    return before["whatsapp.numero"] !== numero && phoneId
      ? `Salvo. O WhatsApp comercial agora é ${numero}. Lembre de cadastrar este número na Meta e conferir o ID do número.`
      : `Salvo. WhatsApp comercial: ${numero}.`;
  });
}
