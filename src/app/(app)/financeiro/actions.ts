"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AccountType, CategoryKind, TitleKind } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, req, int, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { parseMoney, fromLocalInput, money } from "@/lib/format";
import { createTitles, settleTitle, reverseSettlement, cancelTitle, transferFunds, parseTerms } from "@/lib/finance";

const day = (s: string | null) => (s ? fromLocalInput(`${s}T12:00`) : undefined);
const refreshAll = () => { revalidatePath("/financeiro", "layout"); };

export async function newTitle(_: ActionState, fd: FormData): Promise<ActionState> {
  let firstId = "";
  const r = await run(async () => {
    const user = await assertUser("financeiro:lancar");
    const kind = String(fd.get("kind")) as TitleKind;
    if (kind !== "RECEBER" && kind !== "PAGAR") throw new RuleError("Tipo inválido.");
    const first = day(req(fd, "firstDue", "Primeiro vencimento"))!;
    const terms = parseTerms(str(fd, "terms") ?? "0");
    const dueDates = terms.map((d) => new Date(first.getTime() + (d - terms[0]) * 86400_000));
    const titles = await db.$transaction((tx) => createTitles(tx, user, {
      kind, description: req(fd, "description", "Descrição"), amount: parseMoney(fd.get("amount")), dueDates,
      categoryId: req(fd, "categoryId", "Categoria"), costCenterId: str(fd, "costCenterId"),
      customerId: kind === "RECEBER" ? str(fd, "customerId") : null, supplierId: kind === "PAGAR" ? str(fd, "supplierId") : null,
      counterparty: str(fd, "counterparty"), document: str(fd, "document"), method: str(fd, "method"),
      competence: day(str(fd, "competence")), notes: str(fd, "notes"),
    }));
    firstId = titles.length === 1 ? titles[0].id : "";
    refreshAll();
    return `${titles.length} título(s) lançado(s): ${titles.map((t) => t.number).join(", ")}.`;
  });
  if (firstId) redirect(`/financeiro/titulos/${firstId}`);
  return r;
}

export async function settle(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const titleId = String(fd.get("titleId"));
    const t = await db.title.findUniqueOrThrow({ where: { id: titleId } });
    const user = await assertUser(t.kind === "RECEBER" ? "financeiro:receber" : "financeiro:pagar");
    const st = await db.$transaction((tx) => settleTitle(tx, user, {
      titleId, accountId: req(fd, "accountId", "Conta"), date: day(str(fd, "date")), amount: parseMoney(fd.get("amount")),
      interest: parseMoney(fd.get("interest")), discount: parseMoney(fd.get("discount")), fee: parseMoney(fd.get("fee")),
      method: req(fd, "method", "Forma"), installments: int(fd, "installments") ?? 1, reference: str(fd, "reference"),
    }));
    refreshAll();
    if (t.workOrderId) revalidatePath(`/os/${t.workOrderId}`);
    return `Baixa ${st.number} registrada (${money(Math.abs(st.cash))} ${st.cash >= 0 ? "entrou" : "saiu"} da conta).`;
  });
}

export async function reverse(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("financeiro:estornar");
    const rev = await db.$transaction((tx) => reverseSettlement(tx, user, String(fd.get("settlementId")), str(fd, "reason") ?? ""));
    refreshAll();
    return `Estorno ${rev.number} lançado.`;
  });
}

export async function cancel(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("financeiro:estornar");
    await db.$transaction((tx) => cancelTitle(tx, user, String(fd.get("titleId")), str(fd, "reason") ?? ""));
    refreshAll();
    return "Título cancelado.";
  });
}

export async function updateDue(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("financeiro:lancar");
    const id = String(fd.get("titleId"));
    const t = await db.title.findUniqueOrThrow({ where: { id } });
    if (t.status === "PAGO" || t.status === "CANCELADO") throw new RuleError("Título encerrado.");
    const due = day(req(fd, "dueDate", "Vencimento"))!;
    const reason = req(fd, "reason", "Motivo da prorrogação");
    await db.$transaction(async (tx) => {
      await tx.title.update({ where: { id }, data: { dueDate: due } });
      await audit({ action: "RESCHEDULE", entity: "Title", entityId: id, userId: user.id, userName: user.name, before: { dueDate: t.dueDate }, after: { dueDate: due, reason } }, tx);
    });
    refreshAll();
    return "Vencimento alterado.";
  });
}

export async function saveAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("financeiro:contas");
    const id = str(fd, "id");
    const type = String(fd.get("type")) as AccountType;
    if (!["CAIXA", "BANCO", "ADQUIRENTE"].includes(type)) throw new RuleError("Tipo inválido.");
    const data = { name: req(fd, "name", "Nome"), type, bank: str(fd, "bank"), agency: str(fd, "agency"), accountNumber: str(fd, "accountNumber"), active: id ? bool(fd, "active") : true };
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.financialAccount.findUniqueOrThrow({ where: { id } });
        await tx.financialAccount.update({ where: { id }, data });
        await audit({ action: "UPDATE", entity: "FinancialAccount", entityId: id, userId: user.id, userName: user.name, before, after: data }, tx);
      } else {
        const openingBalance = parseMoney(fd.get("openingBalance"));
        const a = await tx.financialAccount.create({ data: { ...data, openingBalance, openingDate: day(str(fd, "openingDate")) ?? new Date() } });
        await audit({ action: "CREATE", entity: "FinancialAccount", entityId: a.id, userId: user.id, userName: user.name, after: { ...data, openingBalance } }, tx);
      }
    });
    refreshAll();
    return "Conta salva.";
  });
}

export async function transfer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("financeiro:contas");
    const amount = parseMoney(fd.get("amount"));
    await db.$transaction((tx) => transferFunds(tx, user, req(fd, "from", "Conta de origem"), req(fd, "to", "Conta de destino"), amount, day(str(fd, "date")) ?? new Date(), str(fd, "description")));
    refreshAll();
    return `Transferência de ${money(amount)} registrada.`;
  });
}

export async function saveCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("financeiro:contas");
    const what = String(fd.get("what"));
    const id = str(fd, "id");
    const code = req(fd, "code", "Código"), name = req(fd, "name", "Nome"), active = id ? bool(fd, "active") : true;
    await db.$transaction(async (tx) => {
      if (what === "category") {
        const kind = String(fd.get("kind")) as CategoryKind;
        if (kind !== "RECEITA" && kind !== "DESPESA") throw new RuleError("Natureza inválida.");
        const c = id ? await tx.financialCategory.update({ where: { id }, data: { code, name, active } }) : await tx.financialCategory.create({ data: { code, name, kind, active } });
        await audit({ action: id ? "UPDATE" : "CREATE", entity: "FinancialCategory", entityId: c.id, userId: user.id, userName: user.name, after: { code, name, active } }, tx);
      } else {
        const c = id ? await tx.costCenter.update({ where: { id }, data: { code, name, active } }) : await tx.costCenter.create({ data: { code, name, active } });
        await audit({ action: id ? "UPDATE" : "CREATE", entity: "CostCenter", entityId: c.id, userId: user.id, userName: user.name, after: { code, name, active } }, tx);
      }
    });
    refreshAll();
    return "Salvo.";
  });
}
