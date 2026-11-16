import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { emailConfigured, whatsappConfigured } from "@/lib/campaigns";
import { PageHeader, Section, Empty } from "@/components/ui";
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE } from "./labels";

export const metadata = { title: "Campanhas" };
export const dynamic = "force-dynamic";

export default async function Campaigns() {
  await requireUser("marketing:campanhas");
  const [list, groups, consent, optout] = await Promise.all([
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.campaignRecipient.groupBy({ by: ["campaignId", "status"], _count: true }),
    db.customer.count({ where: { consentMarketing: true, marketingOptOutAt: null, active: true } }),
    db.customer.count({ where: { marketingOptOutAt: { not: null } } }),
  ]);
  const count = (id: string, st?: string) => groups.filter((g) => g.campaignId === id && (!st || g.status === st)).reduce((a, g) => a + g._count, 0);
  const cfg = [
    ["E-mail (Resend)", emailConfigured()],
    ["WhatsApp API (Meta)", whatsappConfigured()],
    ["Disparo automático (cron)", !!process.env.CRON_SECRET],
  ] as const;

  return (
    <>
      <PageHeader title="Campanhas" subtitle="Mala direta por e-mail e WhatsApp, em lotes com intervalo e horário controlados." actions={<Link href="/marketing/campanhas/nova" className="btn btn-primary">Nova campanha</Link>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Section title="Campanhas">
          {list.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Campanha</th><th>Canal</th><th>Status</th><th className="text-right">Enviados</th><th className="text-right">Falhas</th><th>Criada</th></tr></thead>
                <tbody>
                  {list.map((c) => {
                    const total = count(c.id), sent = count(c.id, "ENVIADO"), fail = count(c.id, "FALHOU");
                    return (
                      <tr key={c.id}>
                        <td><Link className="font-semibold hover:underline" href={`/marketing/campanhas/${c.id}`}>{c.name}</Link></td>
                        <td>{CHANNEL_LABEL[c.channel]}</td>
                        <td><span className={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</span></td>
                        <td className="text-right tabular-nums">{sent}/{total}</td>
                        <td className="text-right tabular-nums">{fail || "—"}</td>
                        <td className="text-xs text-muted">{dateTime(c.createdAt)}{c.createdByName ? ` · ${c.createdByName}` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhuma campanha ainda. Clique em “Nova campanha”.</Empty>}
        </Section>
        <div className="space-y-5">
          <Section title="Configuração">
            <ul className="space-y-1 text-sm">
              {cfg.map(([l, ok]) => <li key={l} className="flex justify-between gap-2"><span>{l}</span><span className={ok ? "badge badge-ok" : "badge badge-warn"}>{ok ? "ativo" : "pendente"}</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-muted">As chaves ficam nas variáveis de ambiente da Vercel. O envio assistido de WhatsApp funciona sem configuração.</p>
          </Section>
          <Section title="Base (LGPD)">
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>Autorizaram marketing</span><b className="tabular-nums">{consent}</b></li>
              <li className="flex justify-between"><span>Descadastrados</span><b className="tabular-nums">{optout}</b></li>
            </ul>
            <p className="mt-3 text-xs text-muted">Descadastrados nunca entram em campanhas. Todo e-mail sai com link de descadastro.</p>
          </Section>
        </div>
      </div>
    </>
  );
}
