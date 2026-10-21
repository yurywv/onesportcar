import { describe, it, expect } from "vitest";
import type { FiscalSettings } from "@prisma/client";
import { buildNfePayload, buildNfsePayload, brDateTime, type FiscalCustomer } from "@/lib/fiscal-payload";
import { parseFocusResponse, focusFileUrl } from "@/lib/focus";

const S: FiscalSettings = {
  id: "default", provider: "FOCUS_NFE", environment: "HOMOLOGACAO", cnpj: "67496704000178", legalName: "DBL AUTOMOTIVA LTDA", tradeName: "ONE SPORTCAR",
  ie: "160352386117", im: "011753862", crt: 3, cnae: "4520001", phone: null, email: null, cep: "13090615", street: "AV JOSE DE SOUSA CAMPOS", number: "2612",
  complement: null, district: "CHACARA DA BARRA", city: "Campinas", uf: "SP", ibgeCode: "3509502", issRate: 5, defaultLc116: "14.01", defaultNationalTaxCode: "140101",
  defaultMunicipalTaxCode: null, defaultNbs: null, nfseSeries: "1", nfseNext: 14, nfeSeries: "1", nfeNext: 14, defaultCfop: "5102", defaultNcm: null,
  pisRate: 0.65, cofinsRate: 3, sendIbsCbs: true, cbsRate: 0.9, ibsRate: 0.1, additionalInfo: null, updatedAt: new Date(),
};
const JEAN: FiscalCustomer = {
  type: "PF", document: "00429462980", name: "JEAN FAUSTO PETRI", email: "jeanpetri@msn.com", phone: "(19) 99909-6500", ie: null,
  cep: "13331-000", street: "Rua Angelo Petrilli", number: "675", complement: "CASA 129", district: "Chacara Areal", city: "Indaiatuba", uf: "SP", ibge: "3520509",
};
const NOW = new Date("2026-10-21T17:30:00Z");

describe("NFS-e (layout nacional — Campinas)", () => {
  it("monta o prestador não optante, tomador PF, ISS 5% e IBS/CBS", () => {
    const p = buildNfsePayload(S, JEAN, [{ description: "Alinhamento 3D", total: 51000 }, { description: "Balanceamento roda", total: 40000 }], { reference: "OS OS-000007 (SYSCAR 4891)", dpsNumber: 14, series: "1", now: NOW });
    expect(p).toMatchObject({
      data_emissao: "2026-10-21T14:30:00-0300", data_competencia: "2026-10-21", numero_dps: 14, serie_dps: 1, codigo_municipio_emissora: "3509502",
      cnpj_prestador: "67496704000178", inscricao_municipal_prestador: "011753862", codigo_opcao_simples_nacional: 1, regime_especial_tributacao: 0,
      cpf_tomador: "00429462980", codigo_municipio_tomador: "3520509", cep_tomador: "13331000", codigo_tributacao_nacional_iss: "140101",
      valor_servico: 910, tributacao_iss: 1, tipo_retencao_iss: 1, percentual_aliquota_relativa_municipio: 5, consumidor_final: 1,
      ibs_cbs_situacao_tributaria: "000", ibs_cbs_classificacao_tributaria: "000001", valor_pis: 5.92, valor_cofins: 27.3,
    });
    expect(p).not.toHaveProperty("regime_tributario_simples_nacional");
    expect(p.descricao_servico).toBe("ALINHAMENTO 3D\nBALANCEAMENTO RODA\nOS OS-000007 (SYSCAR 4891)");
  });
});

describe("NF-e de produtos", () => {
  it("calcula ICMS (CST 00), PIS/COFINS, IBS/CBS e não envia número (numeração automática)", () => {
    const p = buildNfePayload(S, JEAN, [
      { code: "9432", description: "ADITIVO RADIADOR 1 LT (ROSA)", quantity: 1, unit: "UN", total: 3123, ncm: "38200000", cest: null, gtin: null, origin: 0, cfop: "5102", cst: null, icmsRate: null },
      { code: "PNEU", description: "PNEU PIRELLI P ZERO", quantity: 2, unit: "UN", total: 1480000, ncm: "40111000", cest: "1600100", gtin: null, origin: 1, cfop: "5405", cst: null, icmsRate: null },
    ], { reference: "OS OS-000007", now: NOW });
    expect(p).not.toHaveProperty("numero");
    expect(p).toMatchObject({ local_destino: 1, consumidor_final: 1, indicador_inscricao_estadual_destinatario: 9, cpf_destinatario: "00429462980", modalidade_frete: 9 });
    expect(p.items[0]).toMatchObject({ cfop: "5102", icms_situacao_tributaria: "00", icms_base_calculo: 31.23, icms_aliquota: 18, icms_valor: 5.62, pis_valor: 0.2, cofins_valor: 0.94, cbs_valor: 0.28, ibs_uf_valor: 0.03 });
    expect(p.items[1]).toMatchObject({ cfop: "5405", icms_situacao_tributaria: "60", valor_unitario_comercial: 7400, valor_bruto: 14800, cest: "1600100", icms_origem: 1 });
    expect(p.items[1]).not.toHaveProperty("icms_valor");
    expect(p.formas_pagamento[0].valor_pagamento).toBe(14831.23);
  });
  it("vira interestadual (CFOP 6xxx) quando o cliente é de outro estado", () => {
    const p = buildNfePayload(S, { ...JEAN, uf: "RJ" }, [{ code: "X", description: "X", quantity: 3, unit: "PC", total: 1000, ncm: "87089990", cest: null, gtin: null, origin: 0, cfop: "5102", cst: null, icmsRate: 12 }], { reference: "", now: NOW });
    expect(p.local_destino).toBe(2);
    expect(p.items[0].cfop).toBe("6102");
    expect(p.items[0].valor_unitario_comercial).toBe(3.3333333333);
  });
  it("formata a data no fuso de Brasília", () => expect(brDateTime(new Date("2026-01-01T02:00:00Z"))).toBe("2025-12-31T23:00:00-0300"));
});

describe("respostas do provedor", () => {
  it("traduz status, chave e arquivos", () => {
    const ok = parseFocusResponse("NFE", { httpStatus: 200, body: { status: "autorizado", numero: "14", chave_nfe: "NFe35261067496704000178550010000000141234567890", caminho_xml_nota_fiscal: "/arquivos/x.xml", caminho_danfe: "/arquivos/x.pdf" } });
    expect(ok).toMatchObject({ status: "AUTORIZADA", number: "14", accessKey: "35261067496704000178550010000000141234567890" });
    expect(focusFileUrl("HOMOLOGACAO", ok.pdfPath)).toBe("https://homologacao.focusnfe.com.br/arquivos/x.pdf");
    const ns = parseFocusResponse("NFSE", { httpStatus: 200, body: { status: "autorizado", numero: "120", codigo_verificacao: "4zG4", url: "https://www.nfse.gov.br/consulta?chave=ABC123", url_danfse: "https://s3/x.pdf" } });
    expect(ns).toMatchObject({ status: "AUTORIZADA", accessKey: "ABC123", verificationCode: "4zG4", pdfPath: "https://s3/x.pdf" });
    expect(parseFocusResponse("NFE", { httpStatus: 202, body: { status: "processando_autorizacao" } }).status).toBe("PROCESSANDO");
    const rej = parseFocusResponse("NFE", { httpStatus: 200, body: { status: "erro_autorizacao", mensagem_sefaz: "Rejeição: NCM inexistente" } });
    expect(rej).toMatchObject({ status: "REJEITADA", message: "Rejeição: NCM inexistente" });
    expect(parseFocusResponse("NFSE", { httpStatus: 422, body: { codigo: "erro_validacao", mensagem: "CPF inválido" } })).toMatchObject({ status: "REJEITADA", message: "CPF inválido" });
    expect(parseFocusResponse("NFE", { httpStatus: 401, body: {} }).status).toBe("ERRO");
    expect(parseFocusResponse("NFE", { httpStatus: 0, body: { mensagem: "timeout" } }).status).toBe("ERRO");
  });
});
