import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { money, date } from "@/lib/format";
import { accountBalance } from "@/lib/finance";
import { PageHeader, Section, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveAccount, transfer } from "../actions";

export const metadata = { title: "Contas" };
const TYPE: Record<string, string> = { CAIXA: "Caixa", BANCO: "Banco", ADQUIRENTE: "Adquirente (cartões)" };

export default async function Accounts() {
  const user = await requireUser("financeiro:ver");
  const accounts = await db.financialAccount.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  const balances = await Promise.all(accounts.map((a) => accountBalance(db, a.id)));
  const [transfers] = await Promise.all([db.transfer.findMany({ include: { fromAccount: true, toAccount: true }, orderBy: { createdAt: "desc" }, take: 10 })]);
  const manage = can(user.role, "financeiro:contas");
  const active = accounts.filter((a) => a.active);
  return (
    <>
      <PageHeader title="Contas e extratos" subtitle="Saldo = saldo inicial + baixas + transferências" back={<Link href="/financeiro" className="link text-xs">← Tesouraria</Link>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {accounts.map((a, i) => (
            <details key={a.id} className="card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span><Link href={`/financeiro/contas/${a.id}`} className="link">{a.name}</Link> <span className="text-xs text-muted">{TYPE[a.type]}{a.bank && ` · ${a.bank} ag. ${a.agency ?? "—"} cc ${a.accountNumber ?? "—"}`}{!a.active && " · inativa"}</span></span>
                <span className={`text-lg font-semibold tabular-nums ${balances[i] < 0 ? "text-danger" : ""}`}>{money(balances[i])}</span>
              </summary>
              {manage && (
                <ActionForm action={saveAccount} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3">
                  <input type="hidden" name="id" value={a.id} />
                  <Field label="Nome"><input name="name" className="input" defaultValue={a.name} required /></Field>
                  <Field label="Tipo"><select name="type" className="select" defaultValue={a.type}>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                  <Field label="Banco"><input name="bank" className="input" defaultValue={a.bank ?? ""} /></Field>
                  <Field label="Agência"><input name="agency" className="input" defaultValue={a.agency ?? ""} /></Field>
                  <Field label="Conta"><input name="accountNumber" className="input" defaultValue={a.accountNumber ?? ""} /></Field>
                  <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={a.active} /> Ativa</label>
                  <p className="text-xs text-muted sm:col-span-2">Saldo inicial {money(a.openingBalance)} em {date(a.openingDate)} (não editável — use lançamentos para correções).</p>
                  <Submit className="btn">Salvar</Submit>
                </ActionForm>
              )}
            </details>
          ))}
          {manage && (
            <Section title="Nova conta">
              <ActionForm action={saveAccount} className="grid gap-3 sm:grid-cols-3" reset>
                <Field label="Nome *"><input name="name" className="input" required /></Field>
                <Field label="Tipo"><select name="type" className="select">{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Banco"><input name="bank" className="input" /></Field>
                <Field label="Agência"><input name="agency" className="input" /></Field>
                <Field label="Conta"><input name="accountNumber" className="input" /></Field>
                <Field label="Saldo inicial (R$)"><input name="openingBalance" className="input" inputMode="decimal" placeholder="0,00" /></Field>
                <Field label="Data do saldo inicial"><input name="openingDate" type="date" className="input" /></Field>
                <div className="flex items-end"><Submit>Criar conta</Submit></div>
              </ActionForm>
            </Section>
          )}
        </div>
        <div className="space-y-5">
          {manage && (
            <Section title="Transferência entre contas">
              <ActionForm action={transfer} className="space-y-2" reset confirm="Confirmar transferência?">
                <Field label="De"><select name="from" className="select" required>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field label="Para"><select name="to" className="select" required defaultValue={active[1]?.id}>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field label="Valor (R$)"><input name="amount" className="input" inputMode="decimal" required /></Field>
                <Field label="Data"><input name="date" type="date" className="input" /></Field>
                <Field label="Descrição"><input name="description" className="input" placeholder="Ex.: depósito do caixa" /></Field>
                <Submit className="btn w-full">Transferir</Submit>
              </ActionForm>
            </Section>
          )}
          <Section title="Últimas transferências">
            <ul className="space-y-1.5 text-sm">
              {transfers.map((t) => <li key={t.id}>{date(t.date)} · {t.fromAccount.name} → {t.toAccount.name} · <b className="tabular-nums">{money(t.amount)}</b>{t.description && <span className="text-muted"> · {t.description}</span>}</li>)}
              {!transfers.length && <li className="text-muted">Nenhuma.</li>}
            </ul>
          </Section>
          <Link href="/financeiro/cadastros" className="btn w-full">Categorias e centros de custo</Link>
        </div>
      </div>
    </>
  );
}
