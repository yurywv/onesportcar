import type { TitleKind, Title } from "@prisma/client";
import type { Tx } from "./db";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { nextNumber } from "./sequence";
import { RuleError } from "./workflow";
import { money } from "./format";

// Tesouraria (spec §6.17): títulos com parcelas, baixas imutáveis, estorno por lançamento inverso,
// saldo de conta = saldo inicial + Σ efeito das baixas + transferências.

export const CATEGORY = {
  RECEITA_OS: "00000000-0000-4000-8000-000000000101",
  COMPRAS: "00000000-0000-4000-8000-000000000201",
} as const;
export const COST_CENTER_OFICINA = "00000000-0000-4000-8000-000000000301";

export const METHOD_LABEL: Record<string, string> = {
  PIX: "PIX", DINHEIRO: "Dinheiro", CREDITO: "Cartão de crédito", DEBITO: "Cartão de débito",
  BOLETO: "Boleto", TRANSFERENCIA: "Transferência", CHEQUE: "Cheque", OUTRO: "Outro",
};

export const openAmount = (t: Pick<Title, "amount" | "settled" | "status">) => (t.status === "CANCELADO" ? 0 : t.amount - t.settled);

/** "30/60/90" → [30, 60, 90]; "0" ou "" → [0] (à vista). */
export function parseTerms(terms: string | null | undefined): number[] {
  const days = String(terms ?? "").split(/[\/,;\s]+/).map((d) => Number(d)).filter((d) => Number.isFinite(d) && d >= 0);
  if (days.length > 24) throw new RuleError("Máximo de 24 parcelas.");
  return days.length ? days : [0];
}

/** Divide o valor em N parcelas; o resto de centavos vai para a primeira. */
export function splitAmount(total: number, n: number) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? total - base * n : 0));
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400_000);

type NewTitles = {
  kind: TitleKind; description: string; amount: number; dueDays?: number[]; dueDates?: Date[]; baseDate?: Date;
  categoryId: string; costCenterId?: string | null; customerId?: string | null; supplierId?: string | null; counterparty?: string | null;
  workOrderId?: string | null; purchaseOrderId?: string | null; goodsReceiptId?: string | null;
  document?: string | null; method?: string | null; competence?: Date; notes?: string | null;
};

export async function createTitles(tx: Tx, user: SessionUser, t: NewTitles) {
  if (!Number.isInteger(t.amount) || t.amount <= 0) throw new RuleError("Valor do título deve ser maior que zero.");
  if (!t.customerId && !t.supplierId && !t.counterparty?.trim()) throw new RuleError("Informe o cliente, o fornecedor ou o favorecido.");
  const cat = await tx.financialCategory.findUniqueOrThrow({ where: { id: t.categoryId } });
  if ((t.kind === "RECEBER") !== (cat.kind === "RECEITA")) throw new RuleError(`A categoria "${cat.name}" não é compatível com ${t.kind === "RECEBER" ? "contas a receber" : "contas a pagar"}.`);
  const base = t.baseDate ?? new Date();
  const dues = t.dueDates ?? (t.dueDays ?? [0]).map((d) => addDays(base, d));
  const parts = splitAmount(t.amount, dues.length);
  const created: Title[] = [];
  for (const [i, due] of dues.entries()) {
    const title = await tx.title.create({
      data: {
        number: await nextNumber(tx, user.branchId, "TIT"), kind: t.kind, description: t.description,
        customerId: t.customerId, supplierId: t.supplierId, counterparty: t.counterparty, workOrderId: t.workOrderId,
        purchaseOrderId: t.purchaseOrderId, goodsReceiptId: t.goodsReceiptId, categoryId: t.categoryId, costCenterId: t.costCenterId,
        document: t.document, method: t.method, installment: i + 1, installments: dues.length, issueDate: base,
        competence: t.competence ?? base, dueDate: due, amount: parts[i], notes: t.notes, createdById: user.id, createdByName: user.name,
      },
    });
    created.push(title);
  }
  await audit({ action: "CREATE", entity: "Title", entityId: created[0].id, userId: user.id, userName: user.name, after: { kind: t.kind, amount: t.amount, installments: dues.length, numbers: created.map((c) => c.number), workOrderId: t.workOrderId, purchaseOrderId: t.purchaseOrderId } }, tx);
  return created;
}

export async function accountBalance(tx: Tx, accountId: string) {
  const [acc, s, tin, tout] = await Promise.all([
    tx.financialAccount.findUniqueOrThrow({ where: { id: accountId } }),
    tx.settlement.aggregate({ where: { accountId }, _sum: { cash: true } }),
    tx.transfer.aggregate({ where: { toAccountId: accountId }, _sum: { amount: true } }),
    tx.transfer.aggregate({ where: { fromAccountId: accountId }, _sum: { amount: true } }),
  ]);
  return acc.openingBalance + (s._sum.cash ?? 0) + (tin._sum.amount ?? 0) - (tout._sum.amount ?? 0);
}

async function refreshTitle(tx: Tx, titleId: string) {
  const agg = await tx.settlement.aggregate({ where: { titleId }, _sum: { amount: true, discount: true } });
  const settled = (agg._sum.amount ?? 0) + (agg._sum.discount ?? 0);
  const t = await tx.title.findUniqueOrThrow({ where: { id: titleId } });
  const status = settled <= 0 ? "ABERTO" : settled >= t.amount ? "PAGO" : "PARCIAL";
  return tx.title.update({ where: { id: titleId }, data: { settled, status } });
}

type SettleInput = {
  titleId: string; accountId: string; date?: Date; amount: number; interest?: number; discount?: number; fee?: number;
  method: string; installments?: number; reference?: string | null;
};

export async function settleTitle(tx: Tx, user: SessionUser, s: SettleInput) {
  await tx.$queryRaw`SELECT id FROM "Title" WHERE id = ${s.titleId} FOR UPDATE`;
  const t = await tx.title.findUniqueOrThrow({ where: { id: s.titleId } });
  if (t.status === "CANCELADO") throw new RuleError("Título cancelado.");
  if (t.status === "PAGO") throw new RuleError("Título já quitado.");
  const interest = s.interest ?? 0, discount = s.discount ?? 0, fee = s.fee ?? 0;
  if ([s.amount, interest, discount, fee].some((v) => !Number.isInteger(v) || v < 0)) throw new RuleError("Valores inválidos.");
  if (s.amount + discount <= 0) throw new RuleError("Informe o valor da baixa.");
  const open = t.amount - t.settled;
  if (s.amount + discount > open) throw new RuleError(`Valor + desconto (${money(s.amount + discount)}) maior que o saldo do título (${money(open)}).`);
  if (!METHOD_LABEL[s.method]) throw new RuleError("Forma de pagamento inválida.");
  const acc = await tx.financialAccount.findUniqueOrThrow({ where: { id: s.accountId } });
  if (!acc.active) throw new RuleError("Conta inativa.");
  const date = s.date ?? new Date();
  if (date.getTime() > Date.now() + 86400_000) throw new RuleError("Data da baixa não pode ser futura.");
  const cash = t.kind === "RECEBER" ? s.amount + interest - fee : -(s.amount + interest + fee);
  if (t.kind === "RECEBER" && cash < 0) throw new RuleError("Taxa maior que o valor recebido.");
  if (cash < 0 && acc.type === "CAIXA") {
    const bal = await accountBalance(tx, acc.id);
    if (bal + cash < 0) throw new RuleError(`Saldo insuficiente no ${acc.name} (${money(bal)}).`);
  }
  const st = await tx.settlement.create({
    data: {
      number: await nextNumber(tx, user.branchId, t.kind === "RECEBER" ? "REC" : "PAG"), titleId: t.id, accountId: acc.id, date,
      amount: s.amount, interest, discount, fee, cash, method: s.method, installments: s.installments ?? 1, reference: s.reference,
      userId: user.id, userName: user.name,
    },
  });
  const updated = await refreshTitle(tx, t.id);
  await audit({ action: "SETTLE", entity: "Title", entityId: t.id, userId: user.id, userName: user.name, before: { settled: t.settled, status: t.status }, after: { settlement: st.number, amount: s.amount, interest, discount, fee, cash, account: acc.name, status: updated.status } }, tx);
  return st;
}

export async function reverseSettlement(tx: Tx, user: SessionUser, settlementId: string, reason: string) {
  if (!reason.trim()) throw new RuleError("Informe o motivo do estorno.");
  const s = await tx.settlement.findUniqueOrThrow({ where: { id: settlementId }, include: { title: true } });
  if (s.reversalOfId) throw new RuleError("Este lançamento já é um estorno.");
  if (await tx.settlement.findUnique({ where: { reversalOfId: s.id } })) throw new RuleError("Baixa já estornada.");
  const rev = await tx.settlement.create({
    data: {
      number: await nextNumber(tx, user.branchId, s.title.kind === "RECEBER" ? "REC" : "PAG"), titleId: s.titleId, accountId: s.accountId, date: new Date(),
      amount: -s.amount, interest: -s.interest, discount: -s.discount, fee: -s.fee, cash: -s.cash, method: s.method,
      reversalOfId: s.id, reason, userId: user.id, userName: user.name,
    },
  });
  await refreshTitle(tx, s.titleId);
  await audit({ action: "REVERSE", entity: "Title", entityId: s.titleId, userId: user.id, userName: user.name, before: { settlement: s.number, cash: s.cash }, after: { reversal: rev.number, reason } }, tx);
  return rev;
}

export async function cancelTitle(tx: Tx, user: SessionUser, titleId: string, reason: string) {
  if (!reason.trim()) throw new RuleError("Informe o motivo do cancelamento.");
  const t = await tx.title.findUniqueOrThrow({ where: { id: titleId } });
  if (t.status === "CANCELADO") throw new RuleError("Título já cancelado.");
  if (t.settled !== 0) throw new RuleError("Título com baixas não pode ser cancelado. Estorne as baixas primeiro.");
  if (t.goodsReceiptId) throw new RuleError("Título gerado por recebimento de mercadoria: trate a devolução ao fornecedor antes de cancelar.");
  await tx.title.update({ where: { id: titleId }, data: { status: "CANCELADO", cancelReason: reason } });
  await audit({ action: "CANCEL", entity: "Title", entityId: titleId, userId: user.id, userName: user.name, before: { status: t.status }, after: { status: "CANCELADO", reason } }, tx);
}

export async function transferFunds(tx: Tx, user: SessionUser, fromAccountId: string, toAccountId: string, amount: number, date: Date, description?: string | null) {
  if (fromAccountId === toAccountId) throw new RuleError("Contas de origem e destino devem ser diferentes.");
  if (!Number.isInteger(amount) || amount <= 0) throw new RuleError("Valor inválido.");
  const from = await tx.financialAccount.findUniqueOrThrow({ where: { id: fromAccountId } });
  if (from.type === "CAIXA" && (await accountBalance(tx, from.id)) < amount) throw new RuleError(`Saldo insuficiente no ${from.name}.`);
  const tr = await tx.transfer.create({ data: { fromAccountId, toAccountId, amount, date, description, userId: user.id, userName: user.name } });
  await audit({ action: "TRANSFER", entity: "FinancialAccount", entityId: fromAccountId, userId: user.id, userName: user.name, after: { to: toAccountId, amount } }, tx);
  return tr;
}

// ───────────── Integração com a OS ─────────────

/** Situação financeira da OS: faturado (títulos), recebido (baixas) e o que ainda não virou título. */
export function woFinance(total: number, titles: Pick<Title, "amount" | "settled" | "status">[]) {
  const active = titles.filter((t) => t.status !== "CANCELADO");
  const billed = active.reduce((s, t) => s + t.amount, 0);
  const paid = active.reduce((s, t) => s + t.settled, 0);
  return { billed, paid, openTitles: billed - paid, unbilled: Math.max(0, total - billed), due: total - paid };
}

async function woContext(tx: Tx, woId: string) {
  const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { services: true, parts: true, titles: true } });
  const total = wo.services.filter((s) => s.status !== "CANCELADO").reduce((a, s) => a + s.price, 0)
    + wo.parts.filter((p) => ["RESERVADA", "AGUARDANDO_COMPRA", "APLICADA"].includes(p.status)).reduce((a, p) => a + p.price, 0);
  return { wo, total, fin: woFinance(total, wo.titles) };
}

/** Recebimento no balcão: baixa títulos em aberto da OS (mais antigos primeiro) e, se sobrar, cria título à vista para o restante. */
export async function receiveOnWorkOrder(tx: Tx, user: SessionUser, i: { workOrderId: string; amount: number; accountId: string; method: string; installments?: number; fee?: number; reference?: string | null }) {
  const { wo, fin } = await woContext(tx, i.workOrderId);
  if (wo.status === "CANCELADA") throw new RuleError("OS cancelada.");
  if (i.amount <= 0) throw new RuleError("Valor inválido.");
  if (i.amount > fin.due) throw new RuleError(`Valor maior que o saldo da OS (${money(fin.due)}).`);
  let remaining = i.amount;
  let fee = i.fee ?? 0;
  const numbers: string[] = [];
  const open = wo.titles.filter((t) => t.status === "ABERTO" || t.status === "PARCIAL").sort((a, b) => +a.dueDate - +b.dueDate);
  for (const t of open) {
    if (!remaining) break;
    const part = Math.min(remaining, t.amount - t.settled);
    const st = await settleTitle(tx, user, { titleId: t.id, accountId: i.accountId, amount: part, fee, method: i.method, installments: i.installments, reference: i.reference });
    numbers.push(st.number); remaining -= part; fee = 0;
  }
  if (remaining > 0) {
    const [t] = await createTitles(tx, user, {
      kind: "RECEBER", description: `Recebimento ${wo.number}`, amount: remaining, categoryId: CATEGORY.RECEITA_OS, costCenterId: COST_CENTER_OFICINA,
      customerId: wo.customerId, workOrderId: wo.id, method: i.method,
    });
    const st = await settleTitle(tx, user, { titleId: t.id, accountId: i.accountId, amount: remaining, fee, method: i.method, installments: i.installments, reference: i.reference });
    numbers.push(st.number);
  }
  return numbers;
}

/** Fatura a prazo o valor ainda não faturado da OS (boleto/PIX com vencimento), em parcelas. */
export async function billWorkOrder(tx: Tx, user: SessionUser, i: { workOrderId: string; dueDays: number[]; method: string; document?: string | null }) {
  const { wo, fin } = await woContext(tx, i.workOrderId);
  if (wo.status === "CANCELADA") throw new RuleError("OS cancelada.");
  if (fin.unbilled <= 0) throw new RuleError("Não há valor a faturar nesta OS.");
  return createTitles(tx, user, {
    kind: "RECEBER", description: `Faturamento ${wo.number}`, amount: fin.unbilled, dueDays: i.dueDays, categoryId: CATEGORY.RECEITA_OS,
    costCenterId: COST_CENTER_OFICINA, customerId: wo.customerId, workOrderId: wo.id, method: i.method, document: i.document,
  });
}
