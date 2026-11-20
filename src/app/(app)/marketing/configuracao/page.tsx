import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getSettings, formatBrPhone } from "@/lib/settings";
import { emailReadiness, whatsappReadiness } from "@/lib/send-readiness";
import { Checks } from "@/components/checks";
import { PageHeader, Section, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveSendSettings } from "./actions";

export const metadata = { title: "Configurações de envio" };
export const dynamic = "force-dynamic";

export default async function SendSettings() {
  const user = await requireUser("marketing:campanhas");
  const canEdit = can(user.role, "marketing:configurar");
  const [s, email, wa] = await Promise.all([
    getSettings(["whatsapp.numero", "whatsapp.phoneNumberId", "whatsapp.assinatura"]),
    emailReadiness(),
    whatsappReadiness(),
  ]);
  return (
    <>
      <PageHeader title="Configurações de envio" subtitle="Remetentes de e-mail e WhatsApp das campanhas." back={<Link href="/marketing/campanhas" className="text-sm text-muted hover:underline">← Campanhas</Link>} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="WhatsApp comercial">
          <ActionForm action={saveSendSettings} className="space-y-3">
            <fieldset disabled={!canEdit} className="space-y-3">
              <Field label="Número do WhatsApp comercial *" hint="As mensagens saem deste número. Pode ser trocado quando necessário."><input name="numero" className="input text-lg font-semibold" defaultValue={formatBrPhone(s["whatsapp.numero"]) || s["whatsapp.numero"]} placeholder="+55 19 99628-7848" required /></Field>
              <Field label="Assinatura padrão" hint="Sugerida no fim das mensagens avulsas."><input name="assinatura" className="input" defaultValue={s["whatsapp.assinatura"]} /></Field>
              <details className="rounded-lg border border-line p-3 text-sm">
                <summary className="cursor-pointer font-semibold">API oficial do WhatsApp (envio automático) — opcional</summary>
                <div className="mt-3 space-y-3">
                  <Field label="ID do número na Meta (Phone number ID)" hint="Meta Business → WhatsApp → Configuração da API. Se trocar o número comercial, cadastre o novo número na Meta e cole o novo ID aqui."><input name="phoneNumberId" className="input font-mono" defaultValue={s["whatsapp.phoneNumberId"]} placeholder="ex.: 123456789012345" /></Field>
                  <p className="text-xs text-muted">O token de acesso (WHATSAPP_TOKEN) fica guardado só na Vercel, por segurança.</p>
                </div>
              </details>
              {canEdit ? <Submit>Salvar</Submit> : <p className="text-sm text-muted">Somente gestor ou administrador altera o número.</p>}
            </fieldset>
          </ActionForm>
          <div className="mt-4"><Checks checks={wa.checks} /></div>
        </Section>
        <Section title={`E-mail marketing — ${email.ready ? "pronto para enviar" : "ainda não está pronto"}`}>
          <Checks checks={email.checks} />
          {!email.ready && (
            <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
              <b>Como liberar:</b> no Resend, em <i>Domains → Add domain</i>, cadastre <b>onesportcar.com.br</b> e copie os registros (TXT <code>resend._domainkey</code>, MX e TXT <code>send</code>) para a Zona DNS da HostGator. Depois clique em <i>Verify</i> no Resend. Os registros novos não mexem no e-mail atual (Titan).
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
