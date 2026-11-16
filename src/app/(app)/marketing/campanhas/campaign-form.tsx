"use client";
import { useState } from "react";
import type { Campaign } from "@prisma/client";
import { ActionForm, Submit } from "@/components/forms";
import { Field } from "@/components/ui";
import { renderTemplate, textToHtml, fmtMinutes, MAX_BATCH, type Vars } from "@/lib/campaign-template";
import { saveCampaign } from "./actions";

const SAMPLE: Vars = { nome: "Ana Souza", primeiro_nome: "Ana", carro: "Porsche 911 Carrera", placa: "ABC1D23" };

export function CampaignForm({ c, locked }: { c?: Campaign | null; locked?: boolean }) {
  const [channel, setChannel] = useState(c?.channel ?? "EMAIL");
  const [subject, setSubject] = useState(c?.subject ?? "");
  const [body, setBody] = useState(c?.body ?? "Olá, {primeiro_nome}!\n\nEstá chegando a hora da revisão do seu {carro}. Agende pelo app da One Sportcar ou responda esta mensagem.\n\nEquipe One Sportcar");
  const [image, setImage] = useState(c?.imageUrl ?? "");
  const isEmail = channel === "EMAIL", isApi = channel === "WHATSAPP_API";
  const preview = renderTemplate(body, SAMPLE);

  return (
    <ActionForm action={saveCampaign} className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <fieldset disabled={locked} className="space-y-3">
        {c && <input type="hidden" name="id" value={c.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome da campanha *"><input name="name" className="input" defaultValue={c?.name} placeholder="Revisão de verão 2026" required /></Field>
          <Field label="Canal">
            <select name="channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="EMAIL">E-mail</option>
              <option value="WHATSAPP_API">WhatsApp — API oficial (modelo aprovado)</option>
              <option value="WHATSAPP_MANUAL">WhatsApp — envio assistido (um a um)</option>
            </select>
          </Field>
        </div>
        {isEmail && (
          <>
            <Field label="Assunto *"><input name="subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="{primeiro_nome}, seu {carro} merece uma revisão" /></Field>
            <Field label="Imagem de topo (opcional)" hint="Endereço https de uma imagem já publicada (ex.: site ou Instagram)."><input name="imageUrl" className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/banner.jpg" /></Field>
          </>
        )}
        {isApi && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Modelo aprovado na Meta *" className="sm:col-span-2"><input name="waTemplate" className="input font-mono" defaultValue={c?.waTemplate ?? ""} placeholder="revisao_lembrete" /></Field>
            <Field label="Idioma"><input name="waLanguage" className="input font-mono" defaultValue={c?.waLanguage ?? "pt_BR"} /></Field>
            <Field label="Variáveis do modelo, na ordem" className="sm:col-span-3" hint="Para {{1}}, {{2}}… do modelo. Use: nome, primeiro_nome, carro, placa. Ex.: primeiro_nome,carro"><input name="waParams" className="input font-mono" defaultValue={c?.waParams ?? "primeiro_nome,carro"} /></Field>
          </div>
        )}
        <Field label={isApi ? "Texto do modelo (só para registro/prévia)" : "Mensagem *"} hint="Variáveis: {nome} {primeiro_nome} {carro} {placa}. Linha em branco = novo parágrafo. **texto** = negrito.">
          <textarea name="body" className="textarea min-h-[220px]" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="label px-1">Ritmo de envio</legend>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Mensagens por disparo" hint={`máx. ${MAX_BATCH[channel]}`}><input name="batchSize" type="number" min={1} max={MAX_BATCH[channel]} className="input" defaultValue={c?.batchSize ?? (isEmail ? 50 : 20)} /></Field>
            <Field label="Intervalo (min)"><input name="intervalMinutes" type="number" min={1} className="input" defaultValue={c?.intervalMinutes ?? 10} /></Field>
            <Field label="Das"><input name="windowStart" type="time" className="input" defaultValue={fmtMinutes(c?.windowStart ?? 480)} /></Field>
            <Field label="Até"><input name="windowEnd" type="time" className="input" defaultValue={fmtMinutes(c?.windowEnd ?? 1200)} /></Field>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="weekdaysOnly" defaultChecked={c?.weekdaysOnly ?? true} /> Somente dias úteis (seg–sex)</label>
          {channel === "WHATSAPP_MANUAL" && <p className="mt-2 text-xs text-muted">No envio assistido o ritmo é seu: a fila mostra um cliente por vez. Evite mais de ~50 por dia num número novo para não ser bloqueado.</p>}
        </fieldset>
        {!locked && <Submit>{c ? "Salvar alterações" : "Criar e escolher o público"}</Submit>}
        {locked && <p className="text-sm text-muted">Pause a campanha para editar.</p>}
      </fieldset>
      <div>
        <div className="label">Prévia (cliente exemplo)</div>
        {isEmail ? (
          <div className="overflow-hidden rounded-lg border border-line bg-white text-[#18181b]">
            <div className="border-b border-line px-3 py-2 text-xs text-zinc-500">Assunto: <b className="text-zinc-800">{renderTemplate(subject || "(sem assunto)", SAMPLE)}</b></div>
            <div className="bg-zinc-950 px-4 py-3 font-bold tracking-wide text-white">ONE SPORTCAR</div>
            <div className="p-4 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {image && <img src={image} alt="" className="mb-3 w-full rounded" />}
              <div dangerouslySetInnerHTML={{ __html: textToHtml(preview) }} />
            </div>
            <div className="border-t border-line px-4 py-2 text-[11px] text-zinc-500">Não quero mais receber estas mensagens</div>
          </div>
        ) : (
          <div className="rounded-lg bg-[#e7ddd3] p-3">
            <div className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm">{preview}{channel === "WHATSAPP_MANUAL" ? "\n\nPara não receber mais, responda SAIR." : ""}</div>
          </div>
        )}
      </div>
    </ActionForm>
  );
}
