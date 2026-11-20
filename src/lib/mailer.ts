import "server-only";

/** E-mail transacional (redefinição de senha etc.) pelo Resend — mesmas chaves das campanhas. */
export async function sendMail(m: { to: string; subject: string; html: string; text: string; idempotencyKey?: string }): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return { ok: false, error: "E-mail não configurado (RESEND_API_KEY / MAIL_FROM)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [m.to], reply_to: process.env.MAIL_REPLY_TO || undefined, subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    return res.ok ? { ok: true, id: j.id } : { ok: false, error: `Resend ${res.status}: ${j.message ?? "erro"}` };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function resetEmail(opts: { name: string; link: string; minutes: number; who: "equipe" | "cliente" }) {
  const first = opts.name.trim().split(/\s+/)[0] ?? "";
  const subject = "Redefinição de senha — One Sportcar";
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#09090b;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold;letter-spacing:.5px">ONE SPORTCAR</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<p style="margin:0 0 14px">Olá, ${esc(first)}!</p>
<p style="margin:0 0 14px">Recebemos um pedido para redefinir a senha do seu acesso ${opts.who === "cliente" ? "ao app do cliente" : "ao sistema"} da One Sportcar.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px"><tr><td style="background:#b91c1c;border-radius:6px"><a href="${esc(opts.link)}" style="display:inline-block;padding:12px 22px;color:#fff;font-weight:bold;text-decoration:none">Criar nova senha</a></td></tr></table>
<p style="margin:0 0 14px"><b>O link vale por ${opts.minutes} minutos</b> e só pode ser usado uma vez.</p>
<p style="margin:0 0 14px;font-size:13px;color:#52525b">Se não foi você, ignore este e-mail — sua senha atual continua valendo.</p>
<p style="margin:0;font-size:12px;color:#71717a;word-break:break-all">Se o botão não funcionar, copie e cole no navegador:<br>${esc(opts.link)}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Olá, ${first}!\n\nRecebemos um pedido para redefinir sua senha na One Sportcar.\nCrie a nova senha neste link (vale ${opts.minutes} minutos, uso único):\n${opts.link}\n\nSe não foi você, ignore este e-mail.`;
  return { subject, html, text };
}
