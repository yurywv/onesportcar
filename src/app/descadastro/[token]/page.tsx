import { db } from "@/lib/db";
import { ActionForm, Submit } from "@/components/forms";
import { confirmUnsubscribe } from "./actions";

export const metadata = { title: "Descadastro", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Unsubscribe({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = /^[A-Za-z0-9_-]{16,80}$/.test(token)
    ? await db.customer.findUnique({ where: { marketingToken: token }, select: { name: true, marketingOptOutAt: true } })
    : null;
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-accent font-black text-[var(--accent-contrast)]">1S</span>
        <div><div className="font-bold">OneSportcar</div><div className="text-xs text-muted">Preferências de comunicação</div></div>
      </header>
      <div className="card space-y-4 p-5">
        {!c ? (
          <p>Link inválido ou expirado. Se quiser deixar de receber nossas mensagens, responda ao e-mail ou fale com a recepção.</p>
        ) : c.marketingOptOutAt ? (
          <p>Pronto, <b>{c.name.split(" ")[0]}</b>. Você não receberá mais campanhas da One Sportcar. Avisos sobre seus serviços (orçamento, entrega) continuam normalmente.</p>
        ) : (
          <>
            <p>Deseja parar de receber campanhas e novidades da One Sportcar por e-mail e WhatsApp?</p>
            <p className="text-sm text-muted">Você continuará recebendo apenas avisos sobre os serviços do seu veículo.</p>
            <ActionForm action={confirmUnsubscribe}>
              <input type="hidden" name="token" value={token} />
              <Submit>Sim, não quero mais receber</Submit>
            </ActionForm>
          </>
        )}
      </div>
    </main>
  );
}
