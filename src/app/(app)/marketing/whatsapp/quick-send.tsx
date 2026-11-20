"use client";
import { useState } from "react";
import { renderTemplate, waLink, normalizeWhatsapp, type Vars } from "@/lib/campaign-template";
import { ActionForm, Submit } from "@/components/forms";
import { Field } from "@/components/ui";
import { logManualWhatsapp, sendQuickTemplate } from "./actions";

type Target = { id: string; name: string; phone: string; vars: Vars; optedOut: boolean } | null;

export function QuickSend({ target, waNumber, apiReady, signature }: { target: Target; waNumber: string; apiReady: boolean; signature: string }) {
  const [mode, setMode] = useState<"manual" | "api">("manual");
  const [to, setTo] = useState(target?.phone ?? "");
  const [text, setText] = useState(`Olá, {primeiro_nome}! Tudo bem?\n\n\n\n${signature}`);
  const [done, setDone] = useState("");
  const vars = target?.vars ?? {};
  const rendered = renderTemplate(text, vars);
  const phone = normalizeWhatsapp(to);

  function openWhatsapp() {
    if (!phone) return;
    window.open(waLink(phone, rendered), "_blank", "noopener");
    logManualWhatsapp({ to: phone, customerId: target?.id, body: rendered }).then(() => setDone(`WhatsApp aberto para +${phone}. Confirme o envio na janela do WhatsApp.`));
  }

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-line p-1 text-sm">
        <button type="button" onClick={() => setMode("manual")} className={`rounded-md px-3 py-1.5 ${mode === "manual" ? "bg-accent font-semibold text-[var(--accent-contrast)]" : "text-muted"}`}>Mensagem livre (assistido)</button>
        <button type="button" onClick={() => setMode("api")} className={`rounded-md px-3 py-1.5 ${mode === "api" ? "bg-accent font-semibold text-[var(--accent-contrast)]" : "text-muted"}`}>Modelo aprovado (API)</button>
      </div>
      {target?.optedOut && <p className="alert alert-error">Este cliente pediu para não receber campanhas. Envie só assuntos do serviço dele.</p>}
      <Field label={target ? `Celular de ${target.name}` : "Celular"}>
        <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="(19) 99999-9999" />
      </Field>
      {mode === "manual" ? (
        <>
          <Field label="Mensagem" hint={target ? "Variáveis preenchidas com os dados do cliente." : "Escolha um cliente acima para usar {primeiro_nome}, {carro}…"}>
            <textarea className="textarea min-h-[160px]" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="rounded-lg bg-[#e7ddd3] p-3">
            <div className="mb-2 text-center text-[11px] text-[#54656f]">De {waNumber} para {phone ? `+${phone}` : "…"}</div>
            <div className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm">{rendered}</div>
          </div>
          <button type="button" className="btn btn-primary" disabled={!phone || !rendered.trim()} onClick={openWhatsapp}>Abrir no WhatsApp</button>
          <p className="text-xs text-muted">Abre o WhatsApp (app ou Web) com a mensagem pronta — confira se está logado no número comercial {waNumber}.</p>
          {done && <p className="alert alert-ok">{done}</p>}
        </>
      ) : (
        <ActionForm action={sendQuickTemplate} className="space-y-3">
          <input type="hidden" name="to" value={to} />
          {target && <input type="hidden" name="customerId" value={target.id} />}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Modelo aprovado *" className="sm:col-span-2"><input name="template" className="input font-mono" placeholder="revisao_lembrete" /></Field>
            <Field label="Idioma"><input name="language" className="input font-mono" defaultValue="pt_BR" /></Field>
          </div>
          <Field label="Variáveis do modelo, na ordem" hint="primeiro_nome, carro, placa, nome — ou texto fixo."><input name="params" className="input font-mono" defaultValue="primeiro_nome,carro" /></Field>
          {apiReady ? <Submit>Enviar pela API</Submit> : <p className="text-sm text-muted">API oficial ainda não configurada — veja Configurações de envio.</p>}
        </ActionForm>
      )}
    </div>
  );
}
