import { db } from "./db";

/** Configurações editáveis pela tela (sem segredos — tokens e chaves ficam nas variáveis de ambiente da Vercel). */
export const SETTING_DEFAULTS = {
  "whatsapp.numero": "+55 19 99628-7848", // WhatsApp do comercial da One — remetente das mensagens
  "whatsapp.phoneNumberId": "", // ID do número na WhatsApp Cloud API (Meta). Vazio = usa WHATSAPP_PHONE_NUMBER_ID
  "whatsapp.assinatura": "Equipe One Sportcar",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSettings<K extends SettingKey>(keys: readonly K[]): Promise<Record<K, string>> {
  const rows = await db.appSetting.findMany({ where: { key: { in: keys as unknown as string[] } } });
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = rows.find((r) => r.key === k)?.value ?? SETTING_DEFAULTS[k];
  return out;
}

export async function getSetting(key: SettingKey) {
  return (await getSettings([key]))[key];
}

export async function setSetting(key: SettingKey, value: string, user?: string) {
  await db.appSetting.upsert({ where: { key }, create: { key, value, updatedBy: user }, update: { value, updatedBy: user } });
}

/** Número exibido → só dígitos com DDI (5519996287848). */
export const digits = (s: string) => s.replace(/\D/g, "");

export function formatBrPhone(d: string) {
  const x = digits(d);
  if (x.length === 13 && x.startsWith("55")) return `+55 ${x.slice(2, 4)} ${x.slice(4, 9)}-${x.slice(9)}`;
  if (x.length === 12 && x.startsWith("55")) return `+55 ${x.slice(2, 4)} ${x.slice(4, 8)}-${x.slice(8)}`;
  return x ? `+${x}` : "";
}
