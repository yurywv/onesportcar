import { db } from "./db";
import { audit } from "./audit";

/** Descadastra o cliente de todas as campanhas (e-mail e WhatsApp). Idempotente. */
export async function unsubscribeByToken(token: string, source: string) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) return null;
  const c = await db.customer.findUnique({ where: { marketingToken: token }, select: { id: true, name: true, marketingOptOutAt: true } });
  if (!c) return null;
  if (!c.marketingOptOutAt) {
    await db.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: c.id }, data: { marketingOptOutAt: new Date(), consentMarketing: false } });
      await tx.campaignRecipient.updateMany({ where: { customerId: c.id, status: "PENDENTE" }, data: { status: "PULADO", error: "Cliente descadastrado" } });
      await audit({ action: "UPDATE", entity: "Customer", entityId: c.id, userName: `descadastro (${source})`, after: { marketingOptOut: true } }, tx);
    });
  }
  return c;
}
