import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireUser, assertUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { run, req, str, int, num, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { isValidCNPJ, normalizeCNPJ, onlyDigits } from "@/lib/validators";
import { CFOP_LABEL, CRT_LABEL, LC116_LABEL } from "@/lib/fiscal-codes";
import { providerStatus } from "@/lib/fiscal";
import { PageHeader, Field, Section } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Emitente fiscal" };

async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return run(async () => {
    const user = await assertUser("fiscal:configurar");
    const cnpj = normalizeCNPJ(req(fd, "cnpj", "CNPJ"));
    if (!isValidCNPJ(cnpj)) throw new RuleError("CNPJ inválido.");
    const environment = String(fd.get("environment"));
    if (!["HOMOLOGACAO", "PRODUCAO"].includes(environment)) throw new RuleError("Ambiente inválido.");
    const crt = int(fd, "crt") ?? 3;
    if (![1, 2, 3].includes(crt)) throw new RuleError("Regime tributário inválido.");
    const rate = (k: string, def: number) => {
      const v = num(fd, k) ?? def;
      if (v < 0 || v > 100) throw new RuleError("Alíquotas devem estar entre 0 e 100%.");
      return v;
    };
    const next = (k: string) => {
      const v = int(fd, k);
      if (!v || v < 1) throw new RuleError("Próximo número deve ser maior que zero.");
      return v;
    };
    const data = {
      environment, cnpj, legalName: req(fd, "legalName", "Razão social").toUpperCase(), tradeName: str(fd, "tradeName"),
      ie: str(fd, "ie") ? onlyDigits(str(fd, "ie")!) : null, im: str(fd, "im") ? onlyDigits(str(fd, "im")!) : null, crt,
      cnae: str(fd, "cnae") ? onlyDigits(str(fd, "cnae")!) : null, phone: str(fd, "phone"), email: str(fd, "email"),
      cep: str(fd, "cep") ? onlyDigits(str(fd, "cep")!) : null, street: str(fd, "street"), number: str(fd, "number"), complement: str(fd, "complement"),
      district: str(fd, "district"), city: req(fd, "city", "Cidade"), uf: req(fd, "uf", "UF").toUpperCase(), ibgeCode: onlyDigits(req(fd, "ibgeCode", "Código IBGE")),
      issRate: rate("issRate", 5), defaultLc116: req(fd, "defaultLc116", "Item LC 116"), defaultNationalTaxCode: onlyDigits(req(fd, "defaultNationalTaxCode", "Código de tributação nacional")),
      defaultMunicipalTaxCode: str(fd, "defaultMunicipalTaxCode"), defaultNbs: str(fd, "defaultNbs") ? onlyDigits(str(fd, "defaultNbs")!) : null,
      nfseSeries: req(fd, "nfseSeries", "Série da NFS-e"), nfseNext: next("nfseNext"), nfeSeries: req(fd, "nfeSeries", "Série da NF-e"), nfeNext: next("nfeNext"),
      defaultCfop: req(fd, "defaultCfop", "CFOP padrão"), defaultNcm: str(fd, "defaultNcm") ? onlyDigits(str(fd, "defaultNcm")!) : null,
      pisRate: rate("pisRate", 0.65), cofinsRate: rate("cofinsRate", 3), sendIbsCbs: bool(fd, "sendIbsCbs"), cbsRate: rate("cbsRate", 0.9), ibsRate: rate("ibsRate", 0.1),
      additionalInfo: str(fd, "additionalInfo"),
    };
    if (data.defaultNationalTaxCode.length !== 6) throw new RuleError("Código de tributação nacional deve ter 6 dígitos.");
    await db.$transaction(async (tx) => {
      const before = await tx.fiscalSettings.findUnique({ where: { id: "default" } });
      await tx.fiscalSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
      await audit({ action: before ? "UPDATE" : "CREATE", entity: "FiscalSettings", entityId: "default", userId: user.id, userName: user.name, before, after: data }, tx);
    });
    revalidatePath("/fiscal");
    return environment === "PRODUCAO" ? "Salvo. Atenção: ambiente de PRODUÇÃO — as notas emitidas terão validade fiscal." : "Salvo (homologação: notas de teste, sem validade fiscal).";
  });
}

export default async function FiscalSettingsPage() {
  await requireUser("fiscal:configurar");
  const s = await db.fiscalSettings.findUnique({ where: { id: "default" } });
  const st = providerStatus();
  return (
    <>
      <PageHeader title="Emitente fiscal" subtitle="Dados da empresa que emite as notas (NFS-e da Prefeitura de Campinas e NF-e de produtos)." back={<Link href="/fiscal" className="link text-xs">← Notas fiscais</Link>} />
      <div className={`alert mb-5 ${st.HOMOLOGACAO || st.PRODUCAO ? "alert-info" : "alert-warn"}`}>
        Provedor de emissão: <b>Focus NFe</b> · token de homologação {st.HOMOLOGACAO ? "configurado" : <b>não configurado</b>} · token de produção {st.PRODUCAO ? "configurado" : <b>não configurado</b>}.
        <span className="block text-xs">Os tokens ficam nas variáveis de ambiente <code>FISCAL_TOKEN_HOMOLOGACAO</code> e <code>FISCAL_TOKEN_PRODUCAO</code> da Vercel, nunca no banco. O certificado digital A1 da empresa é enviado no painel do provedor.</span>
      </div>
      <ActionForm action={saveSettings} className="space-y-5">
        <Section title="Ambiente">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ambiente de emissão"><select name="environment" className="select" defaultValue={s?.environment ?? "HOMOLOGACAO"}><option value="HOMOLOGACAO">Homologação (testes)</option><option value="PRODUCAO">Produção (validade fiscal)</option></select></Field>
            <Field label="Regime tributário (CRT)"><select name="crt" className="select" defaultValue={s?.crt ?? 3}>{Object.entries(CRT_LABEL).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select></Field>
          </div>
        </Section>
        <Section title="Empresa">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="CNPJ *"><input name="cnpj" className="input" required defaultValue={s?.cnpj} /></Field>
            <Field label="Razão social *" className="lg:col-span-2"><input name="legalName" className="input" required defaultValue={s?.legalName} /></Field>
            <Field label="Nome fantasia"><input name="tradeName" className="input" defaultValue={s?.tradeName ?? ""} /></Field>
            <Field label="Inscrição estadual"><input name="ie" className="input" defaultValue={s?.ie ?? ""} /></Field>
            <Field label="Inscrição municipal"><input name="im" className="input" defaultValue={s?.im ?? ""} /></Field>
            <Field label="CNAE principal"><input name="cnae" className="input" defaultValue={s?.cnae ?? ""} /></Field>
            <Field label="Telefone"><input name="phone" className="input" defaultValue={s?.phone ?? ""} /></Field>
            <Field label="E-mail"><input name="email" className="input" defaultValue={s?.email ?? ""} /></Field>
            <Field label="CEP"><input name="cep" className="input" defaultValue={s?.cep ?? ""} /></Field>
            <Field label="Logradouro" className="lg:col-span-2"><input name="street" className="input" defaultValue={s?.street ?? ""} /></Field>
            <Field label="Número"><input name="number" className="input" defaultValue={s?.number ?? ""} /></Field>
            <Field label="Complemento"><input name="complement" className="input" defaultValue={s?.complement ?? ""} /></Field>
            <Field label="Bairro"><input name="district" className="input" defaultValue={s?.district ?? ""} /></Field>
            <Field label="Cidade *"><input name="city" className="input" required defaultValue={s?.city ?? "Campinas"} /></Field>
            <Field label="UF *"><input name="uf" className="input" required maxLength={2} defaultValue={s?.uf ?? "SP"} /></Field>
            <Field label="Código IBGE do município *"><input name="ibgeCode" className="input" required defaultValue={s?.ibgeCode ?? "3509502"} /></Field>
          </div>
        </Section>
        <Section title="NFS-e (serviços — Prefeitura de Campinas, layout nacional)">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Alíquota de ISS (%)"><input name="issRate" className="input" inputMode="decimal" defaultValue={s?.issRate ?? 5} /></Field>
            <Field label="Item LC 116 padrão"><select name="defaultLc116" className="select" defaultValue={s?.defaultLc116 ?? "14.01"}>{Object.entries(LC116_LABEL).map(([k, l]) => <option key={k} value={k}>{k} — {l.slice(0, 50)}</option>)}</select></Field>
            <Field label="Cód. tributação nacional padrão"><input name="defaultNationalTaxCode" className="input font-mono" defaultValue={s?.defaultNationalTaxCode ?? "140101"} /></Field>
            <Field label="Cód. tributação municipal padrão"><input name="defaultMunicipalTaxCode" className="input font-mono" defaultValue={s?.defaultMunicipalTaxCode ?? ""} /></Field>
            <Field label="NBS padrão"><input name="defaultNbs" className="input font-mono" defaultValue={s?.defaultNbs ?? ""} /></Field>
            <Field label="Série da DPS"><input name="nfseSeries" className="input" defaultValue={s?.nfseSeries ?? "1"} /></Field>
            <Field label="Próximo número da DPS" hint="Continue depois da última nota emitida no SYSCAR"><input name="nfseNext" className="input" inputMode="numeric" defaultValue={s?.nfseNext ?? 1} /></Field>
          </div>
        </Section>
        <Section title="NF-e (produtos)">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Série (referência)"><input name="nfeSeries" className="input" defaultValue={s?.nfeSeries ?? "1"} /></Field>
            <Field label="Próximo número (referência)" hint="A numeração da NF-e é controlada pelo provedor: no painel da Focus, configure série 1 e próximo nº 14 (a última do SYSCAR foi a 13)."><input name="nfeNext" className="input" inputMode="numeric" defaultValue={s?.nfeNext ?? 1} /></Field>
            <Field label="CFOP padrão"><select name="defaultCfop" className="select" defaultValue={s?.defaultCfop ?? "5102"}>{Object.entries(CFOP_LABEL).map(([k, l]) => <option key={k} value={k}>{k} — {l.slice(0, 45)}</option>)}</select></Field>
            <Field label="NCM padrão (itens sem NCM)"><input name="defaultNcm" className="input font-mono" defaultValue={s?.defaultNcm ?? ""} /></Field>
            <Field label="PIS (%)"><input name="pisRate" className="input" inputMode="decimal" defaultValue={s?.pisRate ?? 0.65} /></Field>
            <Field label="COFINS (%)"><input name="cofinsRate" className="input" inputMode="decimal" defaultValue={s?.cofinsRate ?? 3} /></Field>
          </div>
        </Section>
        <Section title="Reforma tributária (IBS/CBS)">
          <p className="mb-3 text-sm text-muted">Em 2026 IBS e CBS são destacados com alíquotas de teste (CBS 0,9% e IBS 0,1%), sem recolhimento. Ative quando a contabilidade confirmar a exigência para a DBL.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sendIbsCbs" defaultChecked={s?.sendIbsCbs} /> Informar IBS/CBS nas notas</label>
            <Field label="CBS (%)"><input name="cbsRate" className="input" inputMode="decimal" defaultValue={s?.cbsRate ?? 0.9} /></Field>
            <Field label="IBS (%)"><input name="ibsRate" className="input" inputMode="decimal" defaultValue={s?.ibsRate ?? 0.1} /></Field>
          </div>
        </Section>
        <Section title="Informações complementares padrão">
          <textarea name="additionalInfo" className="textarea" defaultValue={s?.additionalInfo ?? ""} placeholder="Texto que sai em todas as notas" />
        </Section>
        <Submit>Salvar emitente</Submit>
      </ActionForm>
    </>
  );
}
