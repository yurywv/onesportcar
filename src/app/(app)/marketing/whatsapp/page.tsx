import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { varsFor } from "@/lib/campaigns";
import { getSettings, formatBrPhone } from "@/lib/settings";
import { whatsappReadiness } from "@/lib/send-readiness";
import { PageHeader, Section, Empty } from "@/components/ui";
import { Checks } from "@/components/checks";
import { STATUS_LABEL, STATUS_TONE, CHANNEL_LABEL } from "../campanhas/labels";
import { QuickSend } from "./quick-send";

export const metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

export default async function WhatsappPage({ searchParams }: { searchParams: Promise<{ q?: string; cliente?: string }> }) {
  const user = await requireUser("marketing:campanhas");
  const sp = await searchParams;
  const [s, wa] = await Promise.all([getSettings(["whatsapp.numero", "whatsapp.assinatura"]), whatsappReadiness()]);
  const waNumber = formatBrPhone(s["whatsapp.numero"]) || s["whatsapp.numero"];
  const q = sp.q?.trim();
  const [found, picked, campaigns, groups, logs] = await Promise.all([
    q && q.length >= 2
      ? db.customer.findMany({
          where: { active: true, OR: [{ name: { contains: q, mode: "insensitive" } }, { whatsapp: { contains: q.replace(/\D/g, "") || q } }, { phone: { contains: q.replace(/\D/g, "") || q } }, { vehicles: { some: { plate: { contains: q.toUpperCase().replace(/[^A-Z0-9]/g, "") } } } }] },
          select: { id: true, name: true, whatsapp: true, phone: true, vehicles: { select: { plate: true, make: true, model: true }, take: 2 } },
          take: 8, orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    sp.cliente
      ? db.customer.findUnique({ where: { id: sp.cliente }, select: { id: true, name: true, type: true, tradeName: true, whatsapp: true, phone: true, marketingOptOutAt: true, vehicles: { where: { active: true }, select: { make: true, model: true, plate: true }, orderBy: { createdAt: "desc" }, take: 1 } } })
      : Promise.resolve(null),
    db.campaign.findMany({ where: { channel: { in: ["WHATSAPP_MANUAL", "WHATSAPP_API"] } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.campaignRecipient.groupBy({ by: ["campaignId", "status"], where: { campaign: { channel: { in: ["WHATSAPP_MANUAL", "WHATSAPP_API"] } } }, _count: true }),
    db.messageLog.findMany({ where: { channel: { startsWith: "WHATSAPP" } }, orderBy: { createdAt: "desc" }, take: 15, include: { customer: { select: { name: true } } } }),
  ]);
  const count = (id: string, st?: string) => groups.filter((g) => g.campaignId === id && (!st || g.status === st)).reduce((a, g) => a + g._count, 0);
  const target = picked
    ? { id: picked.id, name: picked.name, phone: picked.whatsapp ?? picked.phone ?? "", vars: varsFor(picked, picked.vehicles[0]), optedOut: !!picked.marketingOptOutAt }
    : null;

  return (
    <>
      <PageHeader
        title="WhatsApp"
        subtitle={<span>Mensagens saem do WhatsApp comercial <b className="text-fg">{waNumber}</b>{can(user.role, "marketing:configurar") && <> · <Link href="/marketing/configuracao" className="underline">alterar número</Link></>}</span>}
        actions={<Link href="/marketing/campanhas/nova?canal=WHATSAPP_MANUAL" className="btn btn-primary">Disparo em massa</Link>}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Section title="Mensagem para um cliente">
            <form className="mb-3 flex gap-2">
              <input name="q" className="input" defaultValue={q} placeholder="Buscar cliente por nome, celular ou placa" />
              <button className="btn">Buscar</button>
            </form>
            {q && (
              found.length ? (
                <ul className="mb-4 divide-y divide-line rounded-lg border border-line text-sm">
                  {found.map((c) => (
                    <li key={c.id}>
                      <Link href={`?cliente=${c.id}`} className={`flex flex-wrap justify-between gap-2 px-3 py-2 hover:bg-[var(--surface-2)] ${sp.cliente === c.id ? "font-semibold" : ""}`}>
                        <span>{c.name}<span className="ml-2 text-xs text-muted">{c.vehicles.map((v) => `${v.make} ${v.model} ${v.plate}`).join(" · ")}</span></span>
                        <span className="text-xs text-muted">{c.whatsapp ?? c.phone ?? "sem celular"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="mb-3 text-sm text-muted">Nenhum cliente encontrado. Você pode digitar o número direto abaixo.</p>
            )}
            {target && <p className="mb-3 text-sm">Cliente: <Link href={`/clientes/${target.id}`} className="font-semibold underline">{target.name}</Link> · <Link href="?" className="text-muted underline">limpar</Link></p>}
            <QuickSend key={target?.id ?? "avulso"} target={target} waNumber={waNumber} apiReady={wa.apiReady} signature={s["whatsapp.assinatura"]} />
          </Section>

          <Section title="Campanhas de WhatsApp" actions={<Link href="/marketing/campanhas/nova?canal=WHATSAPP_MANUAL" className="btn btn-sm">Nova</Link>}>
            {campaigns.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Campanha</th><th>Tipo</th><th>Status</th><th className="text-right">Enviadas</th><th>Criada</th></tr></thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id}>
                        <td><Link className="font-semibold hover:underline" href={`/marketing/campanhas/${c.id}${c.status === "ENVIANDO" ? "?aba=envio" : ""}`}>{c.name}</Link></td>
                        <td className="text-xs">{CHANNEL_LABEL[c.channel]}</td>
                        <td><span className={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</span></td>
                        <td className="text-right tabular-nums">{count(c.id, "ENVIADO")}/{count(c.id)}</td>
                        <td className="text-xs text-muted">{dateTime(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Nenhuma campanha de WhatsApp. Use “Disparo em massa” para escolher os clientes e enviar em fila.</Empty>}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Situação do WhatsApp"><Checks checks={wa.checks} /></Section>
          <Section title="Últimas mensagens avulsas">
            {logs.length ? (
              <ul className="divide-y divide-line text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="py-2">
                    <div className="flex justify-between gap-2"><b className="truncate">{l.customer?.name ?? `+${l.to}`}</b><span className={l.status === "FALHOU" ? "badge badge-danger" : "badge"}>{l.status === "ABERTO" ? "aberto no WhatsApp" : l.status.toLowerCase()}</span></div>
                    <div className="line-clamp-2 text-xs text-muted">{l.body}</div>
                    <div className="text-[11px] text-muted">{dateTime(l.createdAt)} · {l.userName}{l.error ? ` · ${l.error}` : ""}</div>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nenhuma mensagem avulsa ainda.</Empty>}
          </Section>
        </div>
      </div>
    </>
  );
}
