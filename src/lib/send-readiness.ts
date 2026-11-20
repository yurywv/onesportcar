import { emailConfigured, whatsappNumberInfo, whatsappPhoneId } from "./campaigns";
import { getSettings, digits, formatBrPhone } from "./settings";

export type Check = { label: string; ok: boolean | null; detail: string };

async function dns(name: string, type: "TXT" | "MX" | "CNAME") {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { Answer?: { data: string }[] };
    return (j.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/" "/g, ""));
  } catch {
    return null;
  }
}

export const fromDomain = (from?: string) => from?.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase() ?? null;

/** Verifica, de verdade, se o e-mail está pronto para sair: chaves, domínio do remetente e registros DNS do Resend. */
export async function emailReadiness(): Promise<{ ready: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  const hasKey = !!process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  checks.push({ label: "Chave do Resend (RESEND_API_KEY)", ok: hasKey, detail: hasKey ? "configurada na Vercel" : "falta cadastrar na Vercel" });
  checks.push({ label: "Remetente (MAIL_FROM)", ok: !!from, detail: from ?? "falta cadastrar na Vercel" });
  const domain = fromDomain(from);
  if (domain === "resend.dev") checks.push({ label: "Domínio do remetente", ok: false, detail: "resend.dev só envia para o dono da conta — use um endereço @onesportcar.com.br" });

  let apiStatus: string | null = null;
  if (hasKey && domain && domain !== "resend.dev") {
    try {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = (await r.json()) as { data?: { name: string; status: string }[] };
        const d = j.data?.find((x) => x.name === domain || domain.endsWith(`.${x.name}`));
        apiStatus = d?.status ?? "ausente";
        checks.push({
          label: `Domínio ${domain} no Resend`,
          ok: d?.status === "verified",
          detail: !d ? "domínio não cadastrado no Resend (Domains → Add domain)" : d.status === "verified" ? "verificado" : `status: ${d.status} — faltam/estão propagando os registros DNS`,
        });
      } else if (r.status === 401 || r.status === 403) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (/restricted|sending access/i.test(j.message ?? "")) apiStatus = null; // chave só de envio: não pode listar domínios
        else checks.push({ label: "Chave do Resend válida", ok: false, detail: j.message ?? `HTTP ${r.status}` });
      }
    } catch {
      /* rede: segue só com DNS */
    }
  }
  if (domain && domain !== "resend.dev") {
    const [dkim, spf, mx] = await Promise.all([dns(`resend._domainkey.${domain}`, "TXT"), dns(`send.${domain}`, "TXT"), dns(`send.${domain}`, "MX")]);
    if (dkim === null) checks.push({ label: "DNS do domínio", ok: null, detail: "não foi possível consultar agora" });
    else {
      checks.push({ label: `DKIM (resend._domainkey.${domain})`, ok: dkim.some((t) => t.includes("p=")), detail: dkim.length ? "publicado" : "registro TXT ausente no DNS" });
      checks.push({ label: `SPF de envio (send.${domain})`, ok: (spf ?? []).some((t) => t.includes("amazonses")) && (mx ?? []).some((m) => m.includes("amazonses")), detail: (spf ?? []).length ? "publicado" : "registros TXT e MX ausentes no DNS" });
    }
  }
  const ready = emailConfigured() && checks.every((c) => c.ok !== false) && (apiStatus === null || apiStatus === "verified");
  return { ready, checks };
}

export async function whatsappReadiness(): Promise<{ apiReady: boolean; number: string; checks: Check[] }> {
  const s = await getSettings(["whatsapp.numero"]);
  const number = formatBrPhone(s["whatsapp.numero"]) || s["whatsapp.numero"];
  const checks: Check[] = [{ label: "Número comercial", ok: digits(number).length >= 12, detail: number || "não definido" }];
  const hasToken = !!process.env.WHATSAPP_TOKEN;
  const phoneId = await whatsappPhoneId();
  checks.push({ label: "Envio assistido (wa.me)", ok: true, detail: "funciona sem configuração — sai do WhatsApp aberto no seu celular/computador" });
  checks.push({ label: "API oficial: token (WHATSAPP_TOKEN)", ok: hasToken ? true : null, detail: hasToken ? "configurado na Vercel" : "opcional — necessário só para envio automático" });
  checks.push({ label: "API oficial: ID do número", ok: phoneId ? true : null, detail: phoneId || "opcional — copiar da Meta (WhatsApp → Configuração da API)" });
  let apiReady = false;
  if (hasToken && phoneId) {
    const info = await whatsappNumberInfo();
    if (!info.ok) checks.push({ label: "Conexão com a Meta", ok: false, detail: info.error ?? "erro" });
    else {
      const same = digits(info.display ?? "") === digits(number);
      checks.push({ label: "Número na Meta", ok: same, detail: `${info.display} (${info.name ?? "sem nome"})${same ? "" : ` — diferente do número comercial ${number}`}` });
      apiReady = true; // número diferente é alerta, não bloqueio
    }
  }
  return { apiReady, number, checks };
}
