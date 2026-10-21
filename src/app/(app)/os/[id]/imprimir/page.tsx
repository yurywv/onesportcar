import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime, km, money } from "@/lib/format";
import { formatDocument, formatPlate } from "@/lib/validators";
import { STATUS_LABEL } from "@/lib/workflow";
import { printData, qtyLabel } from "@/lib/os-print";
import { DamageMap } from "@/components/damage-map";
import { PrintButton } from "@/components/print-button";
import { loadWorkOrder } from "../data";

export const metadata = { title: "Impressão da OS" };

const cep = (s?: string | null) => (s && s.length === 8 ? `${s.slice(0, 5)}-${s.slice(5)}` : s ?? "");
const cnpj = (s: string) => s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

export default async function PrintWO({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ via?: string }> }) {
  const user = await requireUser("os:ver");
  const { id } = await params;
  const wo = await loadWorkOrder(id);
  if (!wo) notFound();
  if (!can(user.role, "os:ver_todas") && wo.technicianId !== user.id) redirect("/sem-permissao");

  const allowedMoney = can(user.role, "orcamento:editar") || can(user.role, "financeiro:ver_valores") || can(user.role, "pagamentos:registrar");
  const { via } = await searchParams;
  const comercial = allowedMoney && via !== "oficina"; // técnico e demais perfis sem acesso a valores: sempre via oficina
  const showContacts = comercial && can(user.role, "clientes:ver_documentos");

  const [company, people] = await Promise.all([
    db.fiscalSettings.findUnique({ where: { id: "default" } }),
    db.user.findMany({ where: { id: { in: [wo.sellerId, wo.technicianId, wo.consultantId, wo.createdById].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ]);
  const name = (uid?: string | null) => (uid ? people.find((p) => p.id === uid)?.name ?? "" : "");
  const d = printData(wo);
  const c = wo.customer, v = wo.vehicle, ci = wo.checkIn;
  const title = d.stage === "ORCAMENTO" ? "ORÇAMENTO DE O.S." : "ORDEM DE SERVIÇO";
  const problems = (wo.complaint ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const kmIn = ci?.km ?? wo.kmIn;

  const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-3 border-b-2 border-black bg-neutral-100 px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase">{children}</h2>;
  const KV = ({ k, v, className = "" }: { k: string; v?: React.ReactNode; className?: string }) => (
    <div className={className}><div className="text-[9px] font-semibold uppercase text-neutral-500">{k}</div><div className="min-h-4 font-medium">{v || "—"}</div></div>
  );

  return (
    <div className="print-sheet">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2">
        <Link href={`/os/${wo.id}`} className="link text-xs">← Voltar para a {wo.number}</Link>
        <div className="flex flex-wrap gap-2">
          {allowedMoney && (
            <>
              <Link href="?via=cliente" className={`btn btn-sm ${comercial ? "btn-primary" : ""}`}>Com valores (cliente)</Link>
              <Link href="?via=oficina" className={`btn btn-sm ${!comercial ? "btn-primary" : ""}`}>Sem valores (oficina)</Link>
            </>
          )}
          <PrintButton />
        </div>
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-[10mm] text-[11px] leading-snug text-black shadow print:max-w-none print:p-0 print:shadow-none">
        <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-4 border-b-4 border-[#ffda6d] pb-3">
          <div>
            <img src="/logo-one-dark.svg" alt="OneSportCar" className="h-9" />
            <div className="mt-1 text-[9px] font-semibold tracking-[.25em] text-neutral-500">SPORTCAR</div>
          </div>
          <div className="text-center">
            <div className="text-[13px] font-bold">{title}</div>
            <div className="text-2xl font-black tracking-tight">{wo.number}</div>
            {wo.legacyNumber && !wo.legacy && <div className="text-[10px]">Ref. SYSCAR {wo.legacyNumber}</div>}
            <div className="mt-1 inline-block border border-black px-2 text-[10px] font-bold uppercase">{STATUS_LABEL[wo.status]}</div>
            <div className="mt-1 text-[10px]">{dateTime(wo.openedAt)}</div>
            {!comercial && <div className="mt-1 bg-black px-2 text-[10px] font-bold text-white">VIA OFICINA · SEM VALORES</div>}
          </div>
          <div className="text-right text-[10px]">
            <div className="font-bold">{company?.legalName ?? "DBL AUTOMOTIVA LTDA"}</div>
            {company?.tradeName && <div>{company.tradeName}</div>}
            {company && <div>CNPJ: {cnpj(company.cnpj)}</div>}
            {company?.street && <div>{company.street}, {company.number}</div>}
            {company?.district && <div>{company.district}</div>}
            {company && <div>{company.city}/{company.uf} · {cep(company.cep)}</div>}
            {company?.phone && <div>Fone: {company.phone}</div>}
          </div>
        </header>

        <H>Cliente</H>
        <div className="grid grid-cols-4 gap-x-3 gap-y-1.5 px-2 pt-1.5">
          <KV k="Nome" v={c.name} className="col-span-2" />
          <KV k="Código" v={c.legacyCode} />
          {showContacts ? <KV k="CPF/CNPJ" v={formatDocument(c.document)} /> : <KV k="Telefone" v={comercial ? c.phone : undefined} />}
          {showContacts && (
            <>
              <KV k="Endereço" v={[c.street, c.number, c.complement].filter(Boolean).join(", ")} className="col-span-2" />
              <KV k="CEP" v={cep(c.cep)} />
              <KV k="RG/IE" v={c.rgIe} />
              <KV k="Cidade" v={c.city} />
              <KV k="Bairro" v={c.district} />
              <KV k="Telefone / celular" v={[c.phone, c.whatsapp].filter(Boolean).join(" · ")} />
              <KV k="E-mail" v={c.email} />
            </>
          )}
        </div>

        <H>Veículo</H>
        <div className="grid grid-cols-6 gap-x-3 gap-y-1.5 px-2 pt-1.5">
          <KV k="Código" v={v.legacyCode} />
          <KV k="Placa / chassi" v={<>{formatPlate(v.plate)} <span className="font-normal">{v.vin}</span></>} className="col-span-2" />
          <KV k="Ano fab./mod." v={[v.yearMfg, v.yearModel].filter(Boolean).join("/")} />
          <KV k="Marca" v={v.make} />
          <KV k="Modelo" v={[v.model, v.version].filter(Boolean).join(" ")} />
          <KV k="Cor" v={v.color} />
          <KV k="Km entrada" v={kmIn != null ? km(kmIn) : undefined} />
          <KV k="Km saída" v={wo.checkOut ? km(wo.checkOut.km) : undefined} />
          <KV k="Combustível/carga" v={ci ? `${ci.fuelLevel}%` : undefined} />
          <KV k="Mecânico" v={name(wo.technicianId)} className="col-span-2" />
        </div>

        <H>Problemas / avarias</H>
        <ol className="px-2 pt-1">
          {problems.length ? problems.map((p, i) => <li key={i} className="grid grid-cols-[24px_1fr]"><span className="text-right pr-2">{i + 1}</span><span className="uppercase">{p}</span></li>) : <li>—</li>}
        </ol>

        {!comercial && wo.diagnostics.length > 0 && (
          <>
            <H>Diagnóstico</H>
            <div className="px-2 pt-1">{wo.diagnostics.map((x) => <p key={x.id}>{x.diagnosis}{x.solution && ` — ${x.solution}`} <span className="text-neutral-500">({x.technicianName})</span></p>)}</div>
          </>
        )}

        <H>Produtos</H>
        <table className="w-full border-collapse">
          <thead className="text-[9px] uppercase text-neutral-500">
            <tr className="border-b border-neutral-300">
              <th className="px-2 py-1 text-left">Cód.</th><th className="py-1 text-left">Ref.</th><th className="py-1 text-right">Qtd</th><th className="px-2 py-1 text-left">Un.</th><th className="py-1 text-left">Descrição</th>
              {comercial ? <><th className="py-1 text-right">R$ unit.</th><th className="px-2 py-1 text-right">R$ total</th></> : <th className="px-2 py-1 text-center">Aplicado</th>}
            </tr>
          </thead>
          <tbody>
            {d.products.length ? d.products.map((l, i) => (
              <tr key={i} className="border-b border-neutral-200 align-top">
                <td className="px-2 py-1">{l.code ?? "Manual"}</td><td className="py-1">{l.reference}</td>
                <td className="py-1 text-right tabular-nums">{qtyLabel(l)}</td><td className="px-2 py-1">{l.unit}</td><td className="py-1 uppercase">{l.description}</td>
                {comercial ? <><td className="py-1 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice)}</td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(l.total)}</td></> : <td className="px-2 py-1 text-center">☐</td>}
              </tr>
            )) : <tr><td colSpan={7} className="px-2 py-1 text-neutral-500">Nenhum produto.</td></tr>}
          </tbody>
          {comercial && d.products.length > 0 && <tfoot><tr><td colSpan={7} className="px-2 pt-1 text-right font-bold">TOTAL PRODUTOS (líquido): {money(d.productsTotal)}</td></tr></tfoot>}
        </table>

        <H>Serviços</H>
        <table className="w-full border-collapse">
          <thead className="text-[9px] uppercase text-neutral-500">
            <tr className="border-b border-neutral-300">
              <th className="px-2 py-1 text-left">Cód.</th><th className="py-1 text-right">Qtd</th><th className="px-2 py-1 text-left">Descrição</th>
              {comercial ? <><th className="py-1 text-right">R$ unit.</th><th className="px-2 py-1 text-right">R$ total</th></> : <th className="px-2 py-1 text-center">Executado</th>}
            </tr>
          </thead>
          <tbody>
            {d.services.length ? d.services.map((l, i) => (
              <tr key={i} className="border-b border-neutral-200 align-top">
                <td className="px-2 py-1">{l.code}</td><td className="py-1 text-right tabular-nums">{qtyLabel(l)}</td><td className="px-2 py-1 uppercase">{l.description}</td>
                {comercial ? <><td className="py-1 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice)}</td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(l.total)}</td></> : <td className="px-2 py-1 text-center">☐</td>}
              </tr>
            )) : <tr><td colSpan={5} className="px-2 py-1 text-neutral-500">Nenhum serviço.</td></tr>}
          </tbody>
          {comercial && d.services.length > 0 && <tfoot><tr><td colSpan={5} className="px-2 pt-1 text-right font-bold">TOTAL SERVIÇOS (líquido): {money(d.servicesTotal)}</td></tr></tfoot>}
        </table>

        {comercial && (
          <>
            <H>Total</H>
            <div className="grid grid-cols-4 gap-3 px-2 pt-1.5 text-center">
              <KV k="Total de produtos (bruto)" v={money(d.productsGross)} />
              <KV k="Total de serviços (bruto)" v={money(d.servicesGross)} />
              <KV k="Descontos" v={d.discount ? `− ${money(d.discount)}` : money(0)} />
              <div className="bg-black px-2 py-1 text-white"><div className="text-[9px] font-semibold uppercase">Total geral</div><div className="text-base font-black">{money(d.total)}</div></div>
            </div>
          </>
        )}
        <div className="mt-2 px-2 text-right"><span className="text-[9px] uppercase text-neutral-500">Vendedor: </span><b>{name(wo.sellerId) || name(wo.consultantId) || "—"}</b></div>

        {wo.publicNotes && <div className="mt-3 border border-neutral-300 px-2 py-1.5 whitespace-pre-line uppercase"><b>OBS:</b> {wo.publicNotes}</div>}

        {ci && (
          <>
            <H>Check-in {ci.number}</H>
            <div className="grid grid-cols-[1fr_200px] gap-3 px-2 pt-1">
              <div className="space-y-0.5">
                <div>Trazido por {ci.broughtBy} · {ci.keysCount} chave(s) · luzes no painel: {ci.dashLights.join(", ") || "nenhuma"}</div>
                {ci.personalItems && <div>Objetos pessoais: {ci.personalItems}</div>}
                {[ci.exteriorNotes, ci.interiorNotes].filter(Boolean).length > 0 && <div>Observações: {[ci.exteriorNotes, ci.interiorNotes].filter(Boolean).join(" / ")}</div>}
                {ci.locked && <div className="text-[9px] text-neutral-500">Assinado eletronicamente por {ci.signedName} em {dateTime(ci.signedAt)} · SHA-256 {ci.contentHash?.slice(0, 24)}…</div>}
              </div>
              {ci.damages.length > 0 && <DamageMap readOnly initial={ci.damages.map((x) => ({ x: x.x, y: x.y, type: x.type, severity: x.severity, note: x.note ?? undefined }))} />}
            </div>
          </>
        )}

        {comercial ? (
          <div className="mt-8 grid grid-cols-2 items-end gap-8 px-2">
            <div className="text-[11px]">Autorizo a execução dos serviços acima mencionados.</div>
            <div className="text-center"><div className="border-t border-black pt-1 font-semibold uppercase">{c.name}</div><div className="text-[9px]">Assinatura do cliente ou pessoa por ele autorizada</div></div>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-3 gap-6 px-2 text-center text-[9px]">
            <div className="border-t border-black pt-1">Mecânico</div>
            <div className="border-t border-black pt-1">Controle de qualidade</div>
            <div className="border-t border-black pt-1">Data de conclusão</div>
          </div>
        )}

        <footer className="mt-6 flex justify-between border-t border-neutral-300 pt-1 text-[9px] text-neutral-500">
          <span>Aberto por {name(wo.createdById) || "—"} em {dateTime(wo.createdAt)}</span>
          <span>Impresso em {dateTime(new Date())} por {user.name} · Documento sem valor fiscal</span>
        </footer>
      </article>
    </div>
  );
}
