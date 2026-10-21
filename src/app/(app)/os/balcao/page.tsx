import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toLocalInput } from "@/lib/format";
import { formatPlate } from "@/lib/validators";
import { PageHeader, Field, Section } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { openCounterOS } from "../actions";

export const metadata = { title: "Nova OS (balcão)" };

const PRODUCTS_HELP = "2 ; PNEU PIRELLI P ZERO 275/40R21 ; 7.400,00\n1 ; ADITIVO RADIADOR 1 LT (ROSA) ; 31,23 ; 9432 ; 175010 ; UN";
const SERVICES_HELP = "2 ; MAO DE OBRA MECANICA - PNEU ; 100,00 ; 256\n1:00 ; MAO DE OBRA - TROCA PASTILHA DE FREIO ; 510,00 ; 201";

export default async function CounterWorkOrder({ searchParams }: { searchParams: Promise<{ veiculo?: string }> }) {
  const user = await requireUser("os:criar");
  const sp = await searchParams;
  const [vehicles, techs, sellers] = await Promise.all([
    db.vehicle.findMany({ where: { active: true }, select: { id: true, plate: true, make: true, model: true, customer: { select: { name: true } } }, orderBy: { plate: "asc" } }),
    db.user.findMany({ where: { role: "TECNICO", active: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true, OR: [{ isSeller: true }, { role: { in: ["CONSULTOR", "GESTOR"] } }] }, orderBy: { name: "asc" } }),
  ]);
  const pre = sp.veiculo ? vehicles.find((v) => v.id === sp.veiculo) : undefined;
  return (
    <>
      <PageHeader
        title="Nova OS de balcão"
        subtitle="Abre a OS já como orçamento (como no SYSCAR). O check-in com assinatura pode ser feito quando o carro chegar."
        back={<Link href="/os" className="link text-xs">← Ordens de serviço</Link>}
      />
      <ActionForm action={openCounterOS} className="space-y-5">
        <Section title="Cliente e veículo">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Placa *" className="sm:col-span-2" hint="Digite a placa; o cliente vem do cadastro do veículo.">
              <input name="plate" className="input uppercase" list="placas" required defaultValue={pre ? pre.plate : ""} autoComplete="off" />
              <datalist id="placas">{vehicles.map((v) => <option key={v.id} value={v.plate}>{formatPlate(v.plate)} — {v.make} {v.model} — {v.customer.name}</option>)}</datalist>
            </Field>
            <Field label="Km de entrada"><input name="kmIn" className="input" inputMode="numeric" /></Field>
            <Field label="Nº da OS no SYSCAR" hint="Opcional, durante a operação em paralelo"><input name="legacyNumber" className="input" inputMode="numeric" /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">Carro ou cliente novo? <Link href="/clientes/novo" className="link">Cadastrar cliente</Link> · <Link href="/veiculos/novo" className="link">Cadastrar veículo</Link></p>
        </Section>
        <Section title="Atendimento">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Vendedor"><select name="sellerId" className="select" defaultValue={user.id}>{sellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Mecânico"><select name="technicianId" className="select" defaultValue=""><option value="">A definir</option>{techs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Previsão de entrega"><input type="datetime-local" name="promisedAt" className="input" defaultValue={toLocalInput(new Date(Date.now() + 2 * 86400_000))} /></Field>
            <div />
            <Field label="Problemas / avarias relatados * (um por linha)" className="sm:col-span-2"><textarea name="complaint" className="textarea" required placeholder="CLIENTE RELATA VAZAMENTO DE AGUA E BARULHO" /></Field>
            <Field label="OBS (sai impressa na OS)" className="sm:col-span-2"><textarea name="publicNotes" className="textarea" placeholder="Ex.: prazo de chegada das peças" /></Field>
          </div>
        </Section>
        <Section title="Itens do orçamento">
          <p className="mb-3 text-sm text-muted">
            Uma linha por item: <b>quantidade ; descrição ; valor unitário</b> e, se quiser, <b>; código ; referência ; unidade</b>.
            Também aceita colunas coladas de planilha (TAB). Serviço por hora: quantidade <b>1:30</b>. Valor vazio = item a cotar (R$ 0,00).
            Códigos iguais aos do estoque ou do catálogo de serviços são vinculados automaticamente.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Produtos"><textarea name="products" className="textarea min-h-48 font-mono text-xs" placeholder={PRODUCTS_HELP} /></Field>
            <Field label="Serviços"><textarea name="services" className="textarea min-h-48 font-mono text-xs" placeholder={SERVICES_HELP} /></Field>
          </div>
        </Section>
        <Submit className="btn btn-primary w-full sm:w-auto">Abrir OS e montar orçamento</Submit>
      </ActionForm>
    </>
  );
}
