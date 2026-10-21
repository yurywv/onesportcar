// Tabelas fiscais usadas nos cadastros e na emissão (subconjunto relevante para oficina/autopeças em SP).

export const CFOP_LABEL: Record<string, string> = {
  "5102": "Venda de mercadoria adquirida de terceiros",
  "5405": "Venda de mercadoria com ICMS-ST retido anteriormente (substituído)",
  "5656": "Venda de combustível/lubrificante adquirido de terceiros, a consumidor final",
  "5655": "Venda de combustível/lubrificante adquirido de terceiros, para industrialização/comercialização",
  "5933": "Prestação de serviço tributado pelo ISSQN (nota conjugada)",
  "5949": "Outra saída não especificada",
  "6102": "Venda de mercadoria adquirida de terceiros (fora do estado)",
  "6404": "Venda de mercadoria com ICMS-ST já retido (fora do estado)",
};

export const CST_LABEL: Record<string, string> = {
  "00": "Tributada integralmente",
  "10": "Tributada e com cobrança do ICMS por ST",
  "20": "Com redução de base de cálculo",
  "40": "Isenta",
  "41": "Não tributada",
  "60": "ICMS cobrado anteriormente por ST",
  "90": "Outras",
};

export const CSOSN_LABEL: Record<string, string> = {
  "102": "Tributada pelo Simples sem permissão de crédito",
  "103": "Isenção do ICMS no Simples para faixa de receita",
  "500": "ICMS cobrado anteriormente por ST ou antecipação",
  "900": "Outros",
};

export const ORIGIN_LABEL = [
  "Nacional",
  "Estrangeira — importação direta",
  "Estrangeira — adquirida no mercado interno",
  "Nacional, conteúdo de importação > 40% e ≤ 70%",
  "Nacional, processos produtivos básicos",
  "Nacional, conteúdo de importação ≤ 40%",
  "Estrangeira — importação direta, sem similar nacional (CAMEX)",
  "Estrangeira — mercado interno, sem similar nacional (CAMEX)",
  "Nacional, conteúdo de importação > 70%",
];

export const CRT_LABEL: Record<number, string> = { 1: "Simples Nacional", 2: "Simples Nacional — excesso de sublimite", 3: "Regime normal (Lucro Presumido/Real)" };

/** CST padrão a partir do CFOP quando o item não define o seu. */
export function defaultCst(cfop: string) {
  return ["5405", "5656", "5655", "6404"].includes(cfop) ? "60" : "00";
}

/** Itens da LC 116/2003 mais usados pela oficina. */
export const LC116_LABEL: Record<string, string> = {
  "14.01": "Lubrificação, limpeza, revisão, carga e recarga, conserto, restauração, blindagem, manutenção e conservação de veículos",
  "14.02": "Assistência técnica",
  "14.03": "Recondicionamento de motores",
  "14.04": "Recauchutagem ou regeneração de pneus",
  "14.05": "Restauração, recondicionamento, acondicionamento, pintura, beneficiamento, lavagem, secagem, tingimento, galvanoplastia, anodização, corte, recorte, plastificação, costura, acabamento, polimento",
  "14.12": "Funilaria e lanternagem",
  "14.13": "Carpintaria e serralheria",
};
