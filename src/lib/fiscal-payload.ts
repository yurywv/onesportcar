import type { FiscalSettings } from "@prisma/client";
import { defaultCst } from "./fiscal-codes";

// Montagem dos JSONs da API Focus NFe v2 (nomes de campo conforme doc.focusnfe.com.br, out/2026).
// Funções puras: recebem os dados já carregados e devolvem o payload — testadas em tests/fiscal.test.ts.

export type FiscalCustomer = {
  type: "PF" | "PJ"; document: string; name: string; email: string | null; phone: string | null; ie: string | null;
  cep: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; uf: string | null; ibge: string | null;
};
export type NfseLine = { description: string; total: number };
export type NfeLine = {
  code: string; description: string; quantity: number; unit: string; total: number;
  ncm: string | null; cest: string | null; gtin: string | null; origin: number; cfop: string; cst: string | null; icmsRate: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const reais = (cents: number) => r2(cents / 100);
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Data/hora de Brasília no formato AAAA-MM-DDThh:mm:ss-0300. */
export function brDateTime(d: Date) {
  const local = new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 19);
  return `${local}-0300`;
}
const brDate = (d: Date) => brDateTime(d).slice(0, 10);

function tomador(c: FiscalCustomer) {
  const doc = c.type === "PJ" ? { cnpj_tomador: c.document } : { cpf_tomador: digits(c.document) };
  return {
    ...doc, razao_social_tomador: c.name.slice(0, 150), logradouro_tomador: c.street ?? undefined, numero_tomador: c.number ?? undefined,
    complemento_tomador: c.complement ?? undefined, bairro_tomador: c.district ?? undefined, cep_tomador: digits(c.cep) || undefined,
    codigo_municipio_tomador: c.ibge ?? undefined, telefone_tomador: digits(c.phone) || undefined, email_tomador: c.email ?? undefined,
  };
}

/** NFS-e no layout nacional (/v2/nfsen). Campinas usa este layout, transmitido pela prefeitura. */
export function buildNfsePayload(s: FiscalSettings, c: FiscalCustomer, lines: NfseLine[], o: { reference: string; dpsNumber: number; series: string; now: Date }) {
  const total = lines.reduce((a, l) => a + l.total, 0);
  const body = lines.map((l) => l.description.toUpperCase()).join("\n");
  const descricao = `${body}\n${o.reference}`.slice(0, 1000);
  const simples = s.crt !== 3;
  const pisCofins = !simples && (s.pisRate > 0 || s.cofinsRate > 0)
    ? {
      situacao_tributaria_pis_cofins: "01", base_calculo_pis_cofins: reais(total), aliquota_pis: s.pisRate, aliquota_cofins: s.cofinsRate,
      valor_pis: r2((total / 100) * (s.pisRate / 100)), valor_cofins: r2((total / 100) * (s.cofinsRate / 100)), tipo_retencao_pis_cofins: 0,
    }
    : {};
  return {
    data_emissao: brDateTime(o.now),
    data_competencia: brDate(o.now),
    serie_dps: Number(o.series) || 1,
    numero_dps: o.dpsNumber,
    emitente_dps: 1,
    codigo_municipio_emissora: s.ibgeCode,
    cnpj_prestador: s.cnpj,
    inscricao_municipal_prestador: s.im ?? undefined,
    codigo_opcao_simples_nacional: simples ? 3 : 1, // 1 = não optante; 3 = ME/EPP
    ...(simples ? { regime_tributario_simples_nacional: 1 } : {}),
    regime_especial_tributacao: 0,
    ...tomador(c),
    codigo_municipio_prestacao: s.ibgeCode,
    codigo_tributacao_nacional_iss: s.defaultNationalTaxCode,
    ...(s.defaultMunicipalTaxCode ? { codigo_tributacao_municipal_iss: s.defaultMunicipalTaxCode } : {}),
    ...(s.defaultNbs ? { codigo_nbs: s.defaultNbs } : {}),
    descricao_servico: descricao,
    valor_servico: reais(total),
    tributacao_iss: 1, // tributável
    tipo_retencao_iss: 1, // não retido
    percentual_aliquota_relativa_municipio: s.issRate,
    ...pisCofins,
    indicador_total_tributacao: "0",
    ...(s.additionalInfo ? { informacoes_complementares: s.additionalInfo.slice(0, 2000) } : {}),
    // Reforma tributária (obrigatórios no layout nacional; 2026 sem recolhimento)
    finalidade_emissao: 0,
    consumidor_final: c.type === "PF" ? 1 : 0,
    indicador_destinatario: 0,
    codigo_indicador_operacao: "050101",
    ibs_cbs_situacao_tributaria: "000",
    ibs_cbs_classificacao_tributaria: "000001",
  };
}

/** NF-e de venda de peças/produtos (/v2/nfe). Número e série ficam a cargo do provedor (numeração automática). */
export function buildNfePayload(s: FiscalSettings, c: FiscalCustomer, lines: NfeLine[], o: { reference: string; now: Date }) {
  const interstate = !!c.uf && c.uf.toUpperCase() !== s.uf.toUpperCase();
  const total = lines.reduce((a, l) => a + l.total, 0);
  const items = lines.map((l, i) => {
    const value = reais(l.total);
    const cfop = interstate && l.cfop.startsWith("5") ? `6${l.cfop.slice(1)}` : l.cfop;
    const cst = l.cst ?? defaultCst(l.cfop);
    const icmsRate = l.icmsRate ?? 18;
    const icms = cst === "00"
      ? { icms_modalidade_base_calculo: 3, icms_base_calculo: value, icms_aliquota: icmsRate, icms_valor: r2(value * (icmsRate / 100)) }
      : {};
    const ibsCbs = s.sendIbsCbs
      ? {
        ibs_cbs_base_calculo: value, cbs_aliquota: s.cbsRate, cbs_valor: r2(value * (s.cbsRate / 100)),
        ibs_uf_aliquota: s.ibsRate, ibs_uf_valor: r2(value * (s.ibsRate / 100)), ibs_mun_aliquota: 0, ibs_mun_valor: 0, ibs_valor_total: r2(value * (s.ibsRate / 100)),
      }
      : {};
    const unit = Number((value / l.quantity).toFixed(10));
    return {
      numero_item: i + 1,
      codigo_produto: l.code.slice(0, 60),
      descricao: l.description.slice(0, 120),
      cfop,
      codigo_ncm: l.ncm,
      ...(l.cest ? { cest: l.cest } : {}),
      ...(l.gtin ? { codigo_barras_comercial: l.gtin, codigo_barras_tributavel: l.gtin } : {}),
      unidade_comercial: l.unit.slice(0, 6),
      quantidade_comercial: l.quantity,
      valor_unitario_comercial: unit,
      valor_bruto: value,
      unidade_tributavel: l.unit.slice(0, 6),
      quantidade_tributavel: l.quantity,
      valor_unitario_tributavel: unit,
      inclui_no_total: 1,
      icms_origem: l.origin,
      icms_situacao_tributaria: cst,
      ...icms,
      pis_situacao_tributaria: "01",
      pis_base_calculo: value,
      pis_aliquota_porcentual: s.pisRate,
      pis_valor: r2(value * (s.pisRate / 100)),
      cofins_situacao_tributaria: "01",
      cofins_base_calculo: value,
      cofins_aliquota_porcentual: s.cofinsRate,
      cofins_valor: r2(value * (s.cofinsRate / 100)),
      ibs_cbs_situacao_tributaria: "000",
      ibs_cbs_classificacao_tributaria: "000001",
      ...ibsCbs,
    };
  });
  const dest = c.type === "PJ" ? { cnpj_destinatario: c.document } : { cpf_destinatario: digits(c.document) };
  const contribuinte = c.type === "PJ" && !!c.ie && !/isent/i.test(c.ie);
  return {
    natureza_operacao: "VENDA DE MERCADORIA",
    data_emissao: brDateTime(o.now),
    data_entrada_saida: brDateTime(o.now),
    tipo_documento: 1,
    finalidade_emissao: 1,
    local_destino: interstate ? 2 : 1,
    consumidor_final: contribuinte ? 0 : 1,
    presenca_comprador: 1,
    cnpj_emitente: s.cnpj,
    inscricao_estadual_emitente: s.ie ?? undefined,
    regime_tributario_emitente: s.crt,
    ...dest,
    nome_destinatario: c.name.slice(0, 60),
    logradouro_destinatario: c.street ?? undefined,
    numero_destinatario: c.number || "S/N",
    ...(c.complement ? { complemento_destinatario: c.complement } : {}),
    bairro_destinatario: c.district ?? undefined,
    municipio_destinatario: c.city ?? undefined,
    uf_destinatario: c.uf?.toUpperCase() ?? undefined,
    cep_destinatario: digits(c.cep) || undefined,
    ...(c.ibge ? { codigo_municipio_destinatario: c.ibge } : {}),
    ...(c.phone ? { telefone_destinatario: digits(c.phone) } : {}),
    ...(c.email ? { email_destinatario: c.email } : {}),
    indicador_inscricao_estadual_destinatario: contribuinte ? 1 : 9,
    ...(contribuinte ? { inscricao_estadual_destinatario: digits(c.ie) } : {}),
    modalidade_frete: 9,
    informacoes_adicionais_contribuinte: [o.reference, s.additionalInfo].filter(Boolean).join(" · ").slice(0, 5000),
    formas_pagamento: [{ indicador_pagamento: 0, forma_pagamento: "99", descricao_pagamento: "Conforme OS", valor_pagamento: reais(total) }],
    items,
  };
}
