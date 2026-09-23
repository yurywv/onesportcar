import { db } from "@/lib/db";
import { sha256 } from "@/lib/hash";
import { money, dateTime } from "@/lib/format";
import { formatPlate } from "@/lib/validators";
import { ITEM_CLASS_LABEL, type Snapshot } from "@/lib/estimate";
import { ActionForm, Submit } from "@/components/forms";
import { customerDecision } from "./actions";

export const metadata = { title: "Aprovação de orçamento", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const CLASS_TONE: Record<string, string> = { OBRIGATORIO: "badge badge-danger", RECOMENDADO: "badge badge-warn", PREVENTIVO: "badge badge-info", OPCIONAL: "badge" };

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await db.approvalLink.findUnique({
    where: { tokenHash: sha256(token) },
    include: { version: { include: { approvals: true, estimate: { include: { workOrder: { include: { vehicle: true, customer: true, diagnostics: true } } } } } } },
  });
  const shell = (children: React.ReactNode) => (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-accent font-black text-[var(--accent-contrast)]">1S</span>
        <div><div className="font-bold">OneSportcar</div><div className="text-xs text-muted">Aprovação de orçamento</div></div>
      </header>
      {children}
    </main>
  );
  const answered = link?.version.approvals.length;
  if (!link || (!answered && (link.revokedAt || link.expiresAt < new Date())))
    return shell(<div className="card card-pad text-center"><h1 className="text-lg font-semibold">Link inválido ou expirado</h1><p className="mt-2 text-sm text-muted">Solicite um novo link ao seu consultor OneSportcar.</p></div>);

  if (!link.openedAt) await db.approvalLink.update({ where: { id: link.id }, data: { openedAt: new Date() } });
  const v = link.version;
  const wo = v.estimate.workOrder;
  const snap = v.snapshot as unknown as Snapshot;
  const decision = new Map(v.approvals.map((a) => [a.itemId, a.decision]));
  const diag = wo.diagnostics.at(-1);

  return shell(
    <>
      <section className="card card-pad mb-4">
        <h1 className="text-lg font-semibold">{wo.vehicle.make} {wo.vehicle.model} <span className="plate">{formatPlate(wo.vehicle.plate)}</span></h1>
        <p className="text-sm text-muted">{wo.customer.name.split(" ")[0]}, este é o orçamento {v.estimate.number} (versão {v.version}) da {wo.number}.</p>
        {diag && <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm"><div className="text-xs font-semibold uppercase tracking-wider text-muted">Diagnóstico</div>{diag.diagnosis}</div>}
      </section>
      {answered ? (
        <section className="card card-pad">
          <h2 className="font-semibold">Resposta registrada em {dateTime(v.approvals[0].createdAt)}</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {snap.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-2 py-2"><span>{i.description}</span><span className={decision.get(i.id) === "APROVADO" ? "badge badge-ok" : "badge badge-danger"}>{decision.get(i.id) === "APROVADO" ? "Aprovado" : "Recusado"}</span></li>
            ))}
          </ul>
        </section>
      ) : (
        <ActionForm action={customerDecision} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <section className="card divide-y divide-line">
            {snap.items.map((i) => (
              <div key={i.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className={CLASS_TONE[i.classification]}>{ITEM_CLASS_LABEL[i.classification]}</span>
                  <div className="mt-1 font-medium">{i.quantity !== 1 && `${i.quantity}× `}{i.description}</div>
                  <div className="text-sm tabular-nums">{money(i.total)}{i.discount > 0 && <span className="text-xs text-muted"> (desconto de {money(i.discount)})</span>}</div>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" name={`d_${i.id}`} value="APROVADO" defaultChecked={i.classification !== "OPCIONAL"} /> Aprovar</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name={`d_${i.id}`} value="RECUSADO" defaultChecked={i.classification === "OPCIONAL"} /> Recusar</label>
                </div>
              </div>
            ))}
            <div className="flex justify-between p-4 font-semibold"><span>Total do orçamento</span><span className="tabular-nums">{money(v.total)}</span></div>
          </section>
          <section className="card card-pad space-y-3">
            <label className="block"><span className="label">Seu nome completo *</span><input name="name" className="input" required /></label>
            <label className="block"><span className="label">Peças substituídas</span>
              <select name="removedParts" className="select"><option value="DEVOLVER">Quero receber as peças substituídas</option><option value="DESCARTAR">Podem descartar</option></select>
            </label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="accept" className="mt-1" required /> Li e autorizo a execução dos itens marcados como “Aprovar”. Entendo que o registro inclui data, hora, IP e navegador como evidência do aceite eletrônico.</label>
            <Submit className="btn btn-primary w-full">Enviar resposta</Submit>
          </section>
        </ActionForm>
      )}
      <p className="mt-6 text-center text-xs text-muted">Link válido até {dateTime(link.expiresAt)}. Dúvidas? Fale com seu consultor.</p>
    </>
  );
}
