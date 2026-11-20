"use client";
import { useMemo, useRef, useState } from "react";
import type { Campaign } from "@prisma/client";
import { ActionForm, Submit } from "@/components/forms";
import { Field } from "@/components/ui";
import { renderTemplate, buildEmail, fmtMinutes, MAX_BATCH, type EmailMode, type Vars } from "@/lib/campaign-template";
import { saveCampaign } from "./actions";
import { uploadImage } from "./image-upload";

const SAMPLE: Vars = { nome: "Ana Souza", primeiro_nome: "Ana", carro: "Porsche 911 Carrera", placa: "ABC1D23" };
const VARS = ["primeiro_nome", "nome", "carro", "placa"] as const;

const START_TEXT = `# Hora da revisão, {primeiro_nome}!

Seu **{carro}** merece o cuidado de especialistas. Agende agora a revisão na One Sportcar e garanta prioridade na oficina.

- Diagnóstico completo
- Peças originais
- Acompanhamento pelo app, com câmeras

[[Agendar revisão|https://wa.me/5519996287848]]

Equipe One Sportcar`;

export function CampaignForm({ c, locked, waNumber, initialChannel }: { c?: Campaign | null; locked?: boolean; waNumber?: string; initialChannel?: Campaign["channel"] }) {
  const [channel, setChannel] = useState(c?.channel ?? initialChannel ?? "EMAIL");
  const [mode, setMode] = useState<EmailMode>((c?.emailMode as EmailMode) ?? "TEXTO");
  const [subject, setSubject] = useState(c?.subject ?? "");
  const [preheader, setPreheader] = useState(c?.preheader ?? "");
  const [body, setBody] = useState(c?.body ?? (channel === "EMAIL" ? START_TEXT : ""));
  const [artId, setArtId] = useState(c?.artId ?? "");
  const [artAlt, setArtAlt] = useState(c?.artAlt ?? "");
  const [artLink, setArtLink] = useState(c?.artLink ?? "");
  const [html, setHtml] = useState(c?.htmlBody ?? "");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const isEmail = channel === "EMAIL", isApi = channel === "WHATSAPP_API";

  const preview = useMemo(() => {
    if (!isEmail) return "";
    return buildEmail({ mode, body, preheader, imageUrl: c?.imageUrl, artUrl: artId ? `/arte/${artId}` : null, artAlt, artLink, htmlBody: html }, SAMPLE, { unsubscribeUrl: "#" }).html;
  }, [isEmail, mode, body, preheader, artId, artAlt, artLink, html, c?.imageUrl]);

  /** Insere marcação no cursor (ou em volta do texto selecionado). */
  function insert(before: string, after = "", placeholder = "") {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const sel = value.slice(s, e) || placeholder;
    const block = before.startsWith("\n");
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + before.length;
      el.setSelectionRange(pos, pos + sel.length);
      if (block) el.scrollTop = el.scrollTop;
    });
  }
  function linePrefix(prefix: string) {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const ls = value.lastIndexOf("\n", s - 1) + 1;
    const chunk = value.slice(ls, e).split("\n").map((l) => (l.startsWith(prefix) ? l : prefix + l)).join("\n");
    setBody(value.slice(0, ls) + chunk + value.slice(e));
    requestAnimationFrame(() => el.focus());
  }

  async function upload(file: File | undefined, then: (url: string, id: string) => void) {
    if (!file) return;
    setErr("");
    setBusy("Enviando imagem…");
    const r = await uploadImage(file, c?.id);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    then(r.url, r.id);
  }

  const toolbar: [string, string, () => void][] = [
    ["Título", "T", () => insert("\n\n# ", "\n\n", "Título")],
    ["Subtítulo", "t", () => insert("\n\n## ", "\n\n", "Subtítulo")],
    ["Negrito", "B", () => insert("**", "**", "texto")],
    ["Itálico", "I", () => insert("_", "_", "texto")],
    ["Link", "🔗", () => { const u = prompt("Endereço do link (https://…)"); if (u) insert("[", `](${u})`, "texto do link"); }],
    ["Botão", "▭", () => { const u = prompt("Para onde o botão leva? (https://…, ou wa.me/55…)"); if (u) insert("\n\n[[", `|${u}]]\n\n`, "Agendar agora"); }],
    ["Lista", "•", () => linePrefix("- ")],
    ["Linha divisória", "—", () => insert("\n\n---\n\n")],
  ];

  return (
    <ActionForm action={saveCampaign} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,620px)]">
      <fieldset disabled={locked} className="min-w-0 space-y-4">
        {c && <input type="hidden" name="id" value={c.id} />}
        <input type="hidden" name="emailMode" value={mode} />
        <input type="hidden" name="artId" value={artId} />
        {c?.imageUrl && mode === "TEXTO" && <input type="hidden" name="imageUrl" value={c.imageUrl} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome da campanha *"><input name="name" className="input" defaultValue={c?.name} placeholder="Revisão de verão 2026" required /></Field>
          <Field label="Canal">
            <select name="channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="EMAIL">E-mail marketing</option>
              <option value="WHATSAPP_MANUAL">WhatsApp — envio assistido (um a um)</option>
              <option value="WHATSAPP_API">WhatsApp — API oficial (modelo aprovado)</option>
            </select>
          </Field>
        </div>

        {isEmail && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Assunto *"><input name="subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="{primeiro_nome}, seu {carro} merece uma revisão" /></Field>
              <Field label="Pré-cabeçalho" hint="Texto curto que aparece ao lado do assunto na caixa de entrada."><input name="preheader" className="input" value={preheader} onChange={(e) => setPreheader(e.target.value)} placeholder="Agende em 1 minuto e ganhe prioridade" maxLength={140} /></Field>
            </div>
            <div>
              <div className="label">Conteúdo do e-mail</div>
              <div className="inline-flex rounded-lg border border-line p-1 text-sm" role="tablist">
                {([["TEXTO", "✍️ Escrever"], ["ARTE", "🖼️ Arte pronta"], ["HTML", "</> HTML pronto"]] as const).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`rounded-md px-3 py-1.5 ${mode === k ? "bg-accent font-semibold text-[var(--accent-contrast)]" : "text-muted hover:text-fg"}`}>{l}</button>
                ))}
              </div>
            </div>

            {mode === "TEXTO" && (
              <div className="rounded-lg border border-line">
                <div className="flex flex-wrap items-center gap-1 border-b border-line p-1.5">
                  {toolbar.map(([title, label, fn]) => (
                    <button key={title} type="button" title={title} aria-label={title} onClick={fn} className={`btn btn-ghost btn-sm min-w-8 ${label === "B" ? "font-bold" : label === "I" ? "italic" : ""}`}>{label}</button>
                  ))}
                  <label className="btn btn-ghost btn-sm cursor-pointer" title="Inserir imagem">
                    🖼️ Imagem
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f, (url) => insert("\n\n![", `](${url})\n\n`, f?.name.replace(/\.\w+$/, "") ?? "imagem")); }} />
                  </label>
                  <span className="mx-1 h-5 w-px bg-[var(--border)]" />
                  {VARS.map((v) => <button key={v} type="button" onClick={() => insert(`{${v}}`)} className="badge cursor-pointer hover:bg-[var(--surface-2)]" title={`Inserir ${v}`}>{`{${v}}`}</button>)}
                </div>
                <textarea ref={ta} name="body" className="textarea min-h-[340px] rounded-none border-0 font-mono text-[13px] leading-relaxed focus:outline-none" value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
            )}

            {mode === "ARTE" && (
              <div className="space-y-3 rounded-lg border border-line p-3">
                <label
                  className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line p-4 text-center text-sm text-muted hover:border-accent"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0], (_, id) => setArtId(id)); }}
                >
                  {artId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/arte/${artId}`} alt="" className="max-h-48 rounded" />
                  ) : <span className="text-3xl">🖼️</span>}
                  <span><b className="text-fg">{artId ? "Trocar a arte" : "Clique ou arraste a arte aqui"}</b><br />JPG, PNG, GIF ou WebP · ideal 600–1200 px de largura · até 3,5 MB</span>
                  <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f, (_, id) => setArtId(id)); }} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Link ao clicar na arte" hint="Site, agendamento ou wa.me do comercial."><input name="artLink" className="input" value={artLink} onChange={(e) => setArtLink(e.target.value)} placeholder="https://wa.me/5519996287848" /></Field>
                  <Field label="Texto alternativo *" hint="Aparece se o e-mail bloquear imagens — escreva a oferta."><input name="artAlt" className="input" value={artAlt} onChange={(e) => setArtAlt(e.target.value)} placeholder="Revisão completa com 10% de desconto em dezembro" /></Field>
                </div>
                <Field label="Texto abaixo da arte (opcional, recomendado)" hint="E-mails só com imagem caem mais no spam. Um parágrafo curto ajuda. Mesma formatação do editor.">
                  <textarea name="body" className="textarea min-h-[100px]" value={body === START_TEXT ? "" : body} onChange={(e) => setBody(e.target.value)} placeholder="Olá, {primeiro_nome}! Confira nossa condição especial para o seu {carro}." />
                </Field>
              </div>
            )}

            {mode === "HTML" && (
              <div className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted">Cole o HTML exportado do Canva, Mailchimp, Stripo etc. Variáveis {"{primeiro_nome}"} funcionam. O link de descadastro é incluído automaticamente (ou use {"{descadastro}"}).</span>
                  <label className="btn btn-sm cursor-pointer">Importar arquivo .html
                    <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setHtml(await f.text()); }} />
                  </label>
                </div>
                <textarea name="htmlBody" className="textarea min-h-[300px] font-mono text-xs" value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<html>…</html>" />
                <input type="hidden" name="body" value={body === START_TEXT ? "" : body} />
              </div>
            )}
            {busy && <p className="text-sm text-muted">{busy}</p>}
            {err && <p className="alert alert-error">{err}</p>}
          </>
        )}

        {isApi && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Modelo aprovado na Meta *" className="sm:col-span-2"><input name="waTemplate" className="input font-mono" defaultValue={c?.waTemplate ?? ""} placeholder="revisao_lembrete" /></Field>
            <Field label="Idioma"><input name="waLanguage" className="input font-mono" defaultValue={c?.waLanguage ?? "pt_BR"} /></Field>
            <Field label="Variáveis do modelo, na ordem" className="sm:col-span-3" hint="Para {{1}}, {{2}}… do modelo. Use: nome, primeiro_nome, carro, placa. Ex.: primeiro_nome,carro"><input name="waParams" className="input font-mono" defaultValue={c?.waParams ?? "primeiro_nome,carro"} /></Field>
          </div>
        )}
        {!isEmail && (
          <Field label={isApi ? "Texto do modelo (só para registro e prévia)" : "Mensagem *"} hint="Variáveis: {nome} {primeiro_nome} {carro} {placa}. *negrito* e _itálico_ como no WhatsApp.">
            <textarea name="body" className="textarea min-h-[200px]" value={body === START_TEXT ? "" : body} onChange={(e) => setBody(e.target.value)} placeholder={"Olá, {primeiro_nome}! Tudo bem?\n\nPassando para lembrar da revisão do seu {carro}…"} />
          </Field>
        )}

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
        {!locked && <Submit>{c ? "Salvar alterações" : "Salvar e escolher o público"}</Submit>}
        {locked && <p className="text-sm text-muted">Pause a campanha para editar.</p>}
      </fieldset>

      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="label m-0">Prévia (cliente exemplo: Ana · Porsche 911)</span>
          {isEmail && (
            <div className="inline-flex rounded-md border border-line text-xs">
              {(["desktop", "mobile"] as const).map((d) => <button key={d} type="button" onClick={() => setDevice(d)} className={`px-2 py-1 ${device === d ? "bg-[var(--surface-2)] font-semibold" : "text-muted"}`}>{d === "desktop" ? "🖥 Computador" : "📱 Celular"}</button>)}
            </div>
          )}
        </div>
        {isEmail ? (
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="border-b border-line px-3 py-2 text-xs text-zinc-600">
              <div><b className="text-zinc-900">{renderTemplate(subject || "(sem assunto)", SAMPLE)}</b></div>
              {preheader && <div className="truncate text-zinc-500">{renderTemplate(preheader, SAMPLE)}</div>}
            </div>
            <div className="flex justify-center bg-zinc-100">
              <iframe title="Prévia do e-mail" sandbox="allow-same-origin allow-popups" srcDoc={preview} className="h-[720px] border-0 bg-white" style={{ width: device === "mobile" ? 375 : "100%" }} />
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-[#e7ddd3] p-3">
            <div className="mb-2 text-center text-[11px] text-[#54656f]">Enviado de {waNumber ?? "WhatsApp comercial"}</div>
            <div className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm">{renderTemplate(body === START_TEXT ? "" : body, SAMPLE) || "…"}{channel === "WHATSAPP_MANUAL" ? "\n\nPara não receber mais, responda SAIR." : ""}</div>
          </div>
        )}
      </div>
    </ActionForm>
  );
}
