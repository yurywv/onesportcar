import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { campaignCounts, emailConfigured, whatsappConfigured, nextWindowStart, renderTemplate, waLink, fmtMinutes, type Vars } from "@/lib/campaigns";
import { FILTER_KEYS, audienceWhere, type AudienceFilter } from "@/lib/campaign-audience";
import { PageHeader, Section, Field, Empty, Stat, Pager } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { CampaignForm } from "../campaign-form";
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE, RSTATUS_LABEL } from "../labels";
import { addRecipients, removeRecipient, sendTest, startCampaign, setCampaignStatus, retryFailed, markManual, duplicateCampaign } from "../actions";
import { Ticker } from "./ticker";

export const metadata = { title: "Campanha" };
export const dynamic = "force-dynamic";

const TABS = [["mensagem", "Mensagem e ritmo"], ["publico", "Público"], ["destinatarios", "Destinatários"], ["envio", "Envio"]] as const;
const PAGE = 50;

type SP = AudienceFilter & { aba?: string; p?: string; st?: string };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser("marketing:campanhas");
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) notFound();
  const counts = await campaignCounts(id);
  const aba = sp.aba ?? (counts.total ? "envio" : "publico");
  const closed = c.status === "CONCLUIDA" || c.status === "CANCELADA";
  const configured = c.channel === "EMAIL" ? emailConfigured() : c.channel === "WHATSAPP_API" ? whatsappConfigured() : true;
  const pct = counts.total ? Math.round(((counts.enviado + counts.falhou + counts.pulado) / counts.total) * 100) : 0;

  return (
    <>
      <PageHeader
        back={<Link href="/marketing/campanhas" className="text-sm text-muted hover:underline">← Campanhas</Link>}
        title={<span className="flex flex-wrap items-center gap-2">{c.name} <span className={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</span></span>}
        subtitle={c.channel === "WHATSAPP_MANUAL" ? "WhatsApp assistido · um cliente por vez, enviado pelo seu WhatsApp" : `${CHANNEL_LABEL[c.channel]} · ${c.batchSize} por disparo a cada ${c.intervalMinutes} min · ${fmtMinutes(c.windowStart)}–${fmtMinutes(c.windowEnd)}${c.weekdaysOnly ? " em dias úteis" : ""}`}
        actions={<ActionForm action={duplicateCampaign}><input type="hidden" name="id" value={c.id} /><Submit className="btn">Duplicar</Submit></ActionForm>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Destinatários" value={counts.total} />
        <Stat label="Enviados" value={counts.enviado} tone="ok" />
        <Stat label="Na fila" value={counts.pendente} />
        <Stat label="Falhas" value={counts.falhou} tone={counts.falhou ? "danger" : undefined} />
        <Stat label="Pulados" value={counts.pulado} hint="descadastro/cancelamento" />
      </div>
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`?aba=${k}`} className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === k ? "border-accent font-semibold" : "border-transparent text-muted hover:text-fg"}`}>{l}</Link>
        ))}
      </nav>

      {aba === "mensagem" && <CampaignForm c={c} locked={c.status === "ENVIANDO" || closed} />}
      {aba === "publico" && <Audience c={c} sp={sp} closed={closed} />}
      {aba === "destinatarios" && <Recipients id={c.id} sp={sp} canEdit={!closed} />}
      {aba === "envio" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <Section title="Andamento">
              <div className="mb-2 h-3 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
              <p className="text-sm">{pct}% processado · iniciada {dateTime(c.startedAt) || "—"} · último disparo {dateTime(c.lastRunAt) || "—"}{c.status === "ENVIANDO" && c.channel !== "WHATSAPP_MANUAL" ? ` · próximo ${dateTime(c.nextRunAt ?? nextWindowStart(c, new Date()))}` : ""}{c.finishedAt ? ` · encerrada ${dateTime(c.finishedAt)}` : ""}</p>
              {!configured && <p className="alert alert-error mt-3">Canal ainda não configurado na Vercel — o envio só começa depois das chaves (veja a lista de campanhas).</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {(c.status === "RASCUNHO" || c.status === "PAUSADA") && (
                  <ActionForm action={startCampaign} confirm={`Iniciar o envio para ${counts.pendente} cliente(s)?`}><input type="hidden" name="id" value={c.id} /><Submit>{c.status === "PAUSADA" ? "Retomar envio" : "Iniciar envio"}</Submit></ActionForm>
                )}
                {c.status === "ENVIANDO" && (
                  <ActionForm action={setCampaignStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value="PAUSADA" /><Submit className="btn">Pausar</Submit></ActionForm>
                )}
                {!closed && (
                  <ActionForm action={setCampaignStatus} confirm="Cancelar a campanha? Os pendentes não serão enviados."><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value="CANCELADA" /><Submit className="btn btn-ghost text-danger">Cancelar campanha</Submit></ActionForm>
                )}
                {counts.falhou > 0 && c.status !== "CANCELADA" && (
                  <ActionForm action={retryFailed}><input type="hidden" name="id" value={c.id} /><Submit className="btn">Reenviar falhas ({counts.falhou})</Submit></ActionForm>
                )}
              </div>
              {c.status === "ENVIANDO" && c.channel !== "WHATSAPP_MANUAL" && <div className="mt-3"><Ticker id={c.id} cron={!!process.env.CRON_SECRET} /></div>}
            </Section>
            {c.channel === "WHATSAPP_MANUAL" && c.status === "ENVIANDO" && <ManualQueue c={c} />}
          </div>
          {c.channel !== "WHATSAPP_MANUAL" && (
            <Section title="Envio de teste">
              <ActionForm action={sendTest} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <Field label={c.channel === "EMAIL" ? "Enviar para o e-mail" : "Enviar para o celular"} hint="Usa os dados do primeiro destinatário da lista para preencher as variáveis.">
                  <input name="to" className="input" placeholder={c.channel === "EMAIL" ? "voce@onesportcar.com.br" : "(19) 99999-9999"} required />
                </Field>
                <Submit className="btn">Enviar teste</Submit>
              </ActionForm>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

async function Audience({ c, sp, closed }: { c: { id: string; channel: "EMAIL" | "WHATSAPP_API" | "WHATSAPP_MANUAL" }; sp: SP; closed: boolean }) {
  const f: AudienceFilter = {};
  for (const k of FILTER_KEYS) f[k] = sp[k] || undefined;
  const where = audienceWhere(c.channel, f);
  const page = Math.max(1, Number(sp.p) || 1);
  const [total, inCampaign, rows] = await Promise.all([
    db.customer.count({ where }),
    db.campaignRecipient.count({ where: { campaignId: c.id } }),
    db.customer.findMany({
      where, orderBy: { name: "asc" }, skip: (page - 1) * PAGE, take: PAGE,
      select: {
        id: true, name: true, email: true, whatsapp: true, phone: true, city: true, consentMarketing: true,
        vehicles: { where: { active: true }, select: { make: true, model: true, plate: true }, take: 2, orderBy: { createdAt: "desc" } },
        workOrders: { select: { openedAt: true }, orderBy: { openedAt: "desc" }, take: 1 },
        campaignRecipients: { where: { campaignId: c.id }, select: { id: true } },
      },
    }),
  ]);
  const hidden = FILTER_KEYS.map((k) => f[k] ? <input key={k} type="hidden" name={`f_${k}`} value={f[k]} /> : null);
  const params = { aba: "publico", ...Object.fromEntries(FILTER_KEYS.map((k) => [k, f[k]])) };

  return (
    <div className="space-y-5">
      <Section title="Filtrar clientes">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="aba" value="publico" />
          <Field label="Base">
            <select name="base" className="select" defaultValue={f.base ?? "consentidos"}>
              <option value="consentidos">Só quem autorizou marketing</option>
              <option value="clientes">Todos os clientes (exceto descadastrados)</option>
            </select>
          </Field>
          <Field label="Nome contém"><input name="q" className="input" defaultValue={f.q} /></Field>
          <Field label="Tipo"><select name="tipo" className="select" defaultValue={f.tipo ?? ""}><option value="">PF e PJ</option><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></select></Field>
          <Field label="Cidade"><input name="cidade" className="input" defaultValue={f.cidade} /></Field>
          <Field label="Marca do veículo"><input name="marca" className="input" defaultValue={f.marca} placeholder="Porsche" /></Field>
          <Field label="Modelo do veículo"><input name="modelo" className="input" defaultValue={f.modelo} placeholder="Cayenne" /></Field>
          <Field label="Veio nos últimos (meses)"><input name="ativoMeses" type="number" min={1} className="input" defaultValue={f.ativoMeses} /></Field>
          <Field label="Sumido há pelo menos (meses)"><input name="sumidoMeses" type="number" min={1} className="input" defaultValue={f.sumidoMeses} placeholder="12" /></Field>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4"><button className="btn btn-primary">Filtrar</button><Link href="?aba=publico" className="btn btn-ghost">Limpar</Link></div>
        </form>
        {f.base === "clientes" && <p className="mt-3 text-xs text-muted">LGPD: para clientes sem autorização expressa, envie apenas comunicações ligadas aos serviços que eles já usam (legítimo interesse), sempre com opção de descadastro.</p>}
      </Section>

      <Section title={`${total} cliente(s) com ${c.channel === "EMAIL" ? "e-mail" : "celular"} no filtro · ${inCampaign} já na campanha`}>
        {rows.length ? (
          <ActionForm action={addRecipients}>
            <input type="hidden" name="id" value={c.id} />
            {hidden}
            {!closed && (
              <div className="mb-3 flex flex-wrap gap-2">
                <Submit name="mode" value="selecionados">Incluir marcados</Submit>
                <Submit className="btn" name="mode" value="todos">Incluir todos os {total} do filtro</Submit>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th></th><th>Cliente</th><th>Contato</th><th>Veículos</th><th>Última OS</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.campaignRecipients.length ? <span className="badge badge-ok">na lista</span> : <input type="checkbox" name="cid" value={r.id} aria-label={`Selecionar ${r.name}`} />}</td>
                      <td><Link href={`/clientes/${r.id}`} className="hover:underline">{r.name}</Link>{r.city && <div className="text-xs text-muted">{r.city}</div>}{!r.consentMarketing && <div className="text-[11px] text-muted">sem autorização registrada</div>}</td>
                      <td className="text-xs">{c.channel === "EMAIL" ? r.email : r.whatsapp ?? r.phone}</td>
                      <td className="text-xs">{r.vehicles.map((v) => `${v.make} ${v.model} (${v.plate})`).join(", ") || "—"}</td>
                      <td className="text-xs">{dateTime(r.workOrders[0]?.openedAt) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        ) : <Empty>Nenhum cliente no filtro. {f.base !== "clientes" && "Poucos clientes têm autorização registrada — experimente a base “Todos os clientes”."}</Empty>}
        <Pager page={page} total={total} size={PAGE} params={params} />
      </Section>
    </div>
  );
}

async function Recipients({ id, sp, canEdit }: { id: string; sp: SP; canEdit: boolean }) {
  const page = Math.max(1, Number(sp.p) || 1);
  const st = ["PENDENTE", "ENVIADO", "FALHOU", "PULADO"].includes(sp.st ?? "") ? (sp.st as "PENDENTE") : undefined;
  const where = { campaignId: id, ...(st ? { status: st } : {}) };
  const [total, rows] = await Promise.all([
    db.campaignRecipient.count({ where }),
    db.campaignRecipient.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  return (
    <Section title={`${total} destinatário(s)`} actions={canEdit ? <ActionForm action={removeRecipient} confirm="Remover todos os destinatários pendentes?"><input type="hidden" name="id" value={id} /><Submit className="btn btn-ghost btn-sm text-danger">Remover pendentes</Submit></ActionForm> : undefined}>
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        {[["", "Todos"], ["PENDENTE", "Na fila"], ["ENVIADO", "Enviados"], ["FALHOU", "Falhas"], ["PULADO", "Pulados"]].map(([k, l]) => (
          <Link key={k} href={`?aba=destinatarios${k ? `&st=${k}` : ""}`} className={`btn btn-sm ${(sp.st ?? "") === k ? "btn-primary" : ""}`}>{l}</Link>
        ))}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Cliente</th><th>Para</th><th>Status</th><th>Detalhe</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/clientes/${r.customerId}`} className="hover:underline">{r.name}</Link></td>
                  <td className="text-xs">{r.address}</td>
                  <td><span className={r.status === "ENVIADO" ? "badge badge-ok" : r.status === "FALHOU" ? "badge badge-danger" : "badge"}>{RSTATUS_LABEL[r.status]}</span></td>
                  <td className="text-xs text-muted">{r.sentAt ? dateTime(r.sentAt) : r.error ?? ""}</td>
                  <td>{canEdit && r.status === "PENDENTE" && <ActionForm action={removeRecipient}><input type="hidden" name="id" value={id} /><input type="hidden" name="rid" value={r.id} /><Submit className="btn btn-ghost btn-sm">Remover</Submit></ActionForm>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum destinatário. Inclua clientes na aba Público.</Empty>}
      <Pager page={page} total={total} size={PAGE} params={{ aba: "destinatarios", st: sp.st }} />
    </Section>
  );
}

async function ManualQueue({ c }: { c: { id: string; body: string } }) {
  const next = await db.campaignRecipient.findMany({ where: { campaignId: c.id, status: "PENDENTE" }, orderBy: { createdAt: "asc" }, take: 5 });
  if (!next.length) return null;
  return (
    <Section title="Fila do envio assistido">
      <p className="mb-3 text-sm text-muted">Clique em “Abrir WhatsApp”, envie a mensagem e depois marque como enviada. Vá no seu ritmo — mandar muitas seguidas pode bloquear o número.</p>
      <ul className="divide-y divide-line">
        {next.map((r, i) => {
          const text = `${renderTemplate(c.body, r.vars as Vars)}\n\nPara não receber mais, responda SAIR.`;
          return (
            <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 py-3 ${i ? "opacity-60" : ""}`}>
              <div><b>{r.name}</b><div className="text-xs text-muted">+{r.address}</div></div>
              <div className="flex flex-wrap gap-1">
                <a href={waLink(r.address, text)} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">Abrir WhatsApp</a>
                {(["sent", "skip", "optout"] as const).map((how) => (
                  <ActionForm key={how} action={markManual}>
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="rid" value={r.id} /><input type="hidden" name="how" value={how} />
                    <Submit className="btn btn-sm">{how === "sent" ? "Enviada ✓" : how === "skip" ? "Pular" : "Pediu para sair"}</Submit>
                  </ActionForm>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
