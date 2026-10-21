// Definição dos campos de cada cadastro importável (compartilhado entre navegador e servidor).
// Os sinônimos servem para sugerir automaticamente qual coluna do SYSCAR corresponde a cada campo.

export type ImportEntity = "CLIENTES" | "VEICULOS" | "FORNECEDORES" | "ITENS" | "SERVICOS" | "OS" | "OS_ITENS";
export type FieldDef = { key: string; label: string; required?: boolean; synonyms: string[]; hint?: string };

export const ENTITY_LABEL: Record<ImportEntity, string> = {
  CLIENTES: "Clientes", VEICULOS: "Veículos", FORNECEDORES: "Fornecedores", ITENS: "Peças e estoque", SERVICOS: "Serviços (catálogo)", OS: "Histórico de OS", OS_ITENS: "Itens das OS (histórico)",
};
export const ENTITY_ORDER: ImportEntity[] = ["CLIENTES", "VEICULOS", "FORNECEDORES", "ITENS", "SERVICOS", "OS", "OS_ITENS"];
export const ENTITY_HELP: Record<ImportEntity, string> = {
  CLIENTES: "Chave: CPF/CNPJ. Clientes sem documento válido ficam como inválidos para correção no SYSCAR.",
  VEICULOS: "Chave: placa. O proprietário é localizado pelo CPF/CNPJ ou pelo código do cliente no SYSCAR — importe os clientes antes.",
  FORNECEDORES: "Chave: CNPJ/CPF.",
  ITENS: "Chave: código da peça (SKU). Saldo informado entra como inventário inicial ao custo informado.",
  SERVICOS: "Chave: código do serviço. O valor vira o preço/valor-hora do catálogo.",
  OS: "Histórico somente leitura (sem efeito em estoque ou financeiro). O veículo é localizado pela placa — importe os veículos antes.",
  OS_ITENS: "Produtos e serviços de cada OS do histórico (monta o histórico de manutenção do veículo). A OS é localizada pelo número no SYSCAR — importe o histórico de OS antes. Sem efeito em estoque ou financeiro.",
};

const f = (key: string, label: string, synonyms: string[], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, synonyms, ...extra });

const ADDRESS: FieldDef[] = [
  f("cep", "CEP", ["cep"]),
  f("street", "Logradouro", ["endereco", "logradouro", "rua", "end"]),
  f("number", "Número", ["numero", "num", "nro", "n"]),
  f("complement", "Complemento", ["complemento", "compl"]),
  f("district", "Bairro", ["bairro"]),
  f("city", "Cidade", ["cidade", "municipio"]),
  f("uf", "UF", ["uf", "estado"]),
];

const SERVICOS_FIELDS: FieldDef[] = [
  f("code", "Código do serviço", ["codigo", "cod", "codigo servico", "cod servico", "id"], { required: true }),
  f("name", "Descrição", ["descricao", "servico", "nome", "descricao servico"], { required: true }),
  f("category", "Grupo / categoria", ["grupo", "categoria", "tipo"]),
  f("price", "Valor (R$)", ["valor", "preco", "valor venda", "preco venda", "valor unitario"]),
  f("minutes", "Tempo padrão (min)", ["tempo", "minutos", "tempo padrao", "duracao"]),
];
const OS_ITENS_FIELDS: FieldDef[] = [
  f("legacyNumber", "Número da OS no SYSCAR", ["os", "o s", "numero os", "n os", "ordem"], { required: true }),
  f("kind", "Tipo (produto/serviço)", ["tipo", "tipo item", "natureza"], { hint: "P/PRODUTO ou S/SERVIÇO; vazio = produto" }),
  f("seq", "Sequência do item na OS", ["seq", "sequencia", "item"]),
  f("code", "Código", ["codigo", "cod", "codigo produto", "codigo servico"]),
  f("description", "Descrição", ["descricao", "produto", "servico", "item descricao"], { required: true }),
  f("quantity", "Quantidade", ["quantidade", "qtd", "qtde"]),
  f("unitPrice", "Valor unitário", ["valor unitario", "unitario", "vlr unit", "preco unitario"]),
  f("total", "Valor total", ["valor total", "total", "vlr total"]),
  f("cost", "Custo (CMV)", ["cmv", "custo", "custo total"]),
  f("technician", "Responsável pelo item", ["responsavel pelo item", "mecanico", "tecnico", "responsavel"]),
];

export const FIELDS: Record<ImportEntity, FieldDef[]> = {
  SERVICOS: SERVICOS_FIELDS,
  OS_ITENS: OS_ITENS_FIELDS,
  CLIENTES: [
    f("legacyCode", "Código no SYSCAR", ["codigo", "cod", "cod cliente", "codigo cliente", "id"]),
    f("document", "CPF / CNPJ", ["cpf/cnpj", "cpf cnpj", "cnpj/cpf", "cpf", "cnpj", "documento", "doc"], { required: true }),
    f("name", "Nome / razão social", ["nome", "razao social", "cliente", "nome/razao social", "nome cliente"], { required: true }),
    f("tradeName", "Nome fantasia", ["fantasia", "nome fantasia", "apelido"]),
    f("rgIe", "RG / IE", ["rg", "ie", "inscricao estadual", "rg/ie", "insc estadual"]),
    f("birthDate", "Nascimento", ["nascimento", "data nascimento", "dt nasc", "aniversario"]),
    f("phone", "Telefone", ["telefone", "fone", "tel", "telefone 1", "fone residencial", "fone comercial"]),
    f("whatsapp", "Celular / WhatsApp", ["celular", "whatsapp", "cel", "telefone 2", "fone celular"]),
    f("email", "E-mail", ["email", "e-mail", "e mail"]),
    ...ADDRESS,
    f("notes", "Observações", ["obs", "observacao", "observacoes"]),
  ],
  VEICULOS: [
    f("legacyCode", "Código do veículo no SYSCAR", ["codigo veiculo", "cod veiculo", "id veiculo"]),
    f("plate", "Placa", ["placa"], { required: true }),
    f("ownerDocument", "CPF/CNPJ do proprietário", ["cpf/cnpj", "cpf", "cnpj", "documento", "cpf cliente", "cnpj cliente"], { hint: "Informe este ou o código do cliente" }),
    f("ownerCode", "Código do cliente no SYSCAR", ["codigo cliente", "cod cliente", "cliente codigo", "codigo"]),
    f("ownerName", "Nome do proprietário", ["cliente", "proprietario", "nome cliente"], { hint: "Usado quando não há CPF/CNPJ nem código" }),
    f("ownerPhone", "Telefone do proprietário", ["telefone", "celular"], { hint: "Desempata nomes iguais" }),
    f("make", "Marca", ["marca", "fabricante", "montadora"]),
    f("model", "Modelo", ["modelo", "veiculo", "descricao veiculo"], { required: true }),
    f("version", "Versão", ["versao", "complemento modelo"]),
    f("yearMfg", "Ano de fabricação", ["ano fabricacao", "ano fab", "ano", "ano/modelo", "ano fab/mod"]),
    f("yearModel", "Ano modelo", ["ano modelo", "ano mod"]),
    f("color", "Cor", ["cor"]),
    f("fuel", "Combustível", ["combustivel", "comb"]),
    f("vin", "Chassi", ["chassi", "chassis", "vin"]),
    f("renavam", "RENAVAM", ["renavam"]),
    f("engine", "Motor", ["motor", "numero motor", "motorizacao"]),
    f("mileage", "Quilometragem", ["km", "quilometragem", "km atual", "hodometro"]),
    f("notes", "Observações", ["obs", "observacao", "observacoes"]),
  ],
  FORNECEDORES: [
    f("legacyCode", "Código no SYSCAR", ["codigo", "cod", "cod fornecedor", "id"]),
    f("document", "CNPJ / CPF", ["cnpj", "cnpj/cpf", "cpf/cnpj", "cpf", "documento"], { required: true }),
    f("name", "Razão social", ["razao social", "nome", "fornecedor", "nome/razao social"], { required: true }),
    f("tradeName", "Nome fantasia", ["fantasia", "nome fantasia"]),
    f("ie", "Inscrição estadual", ["ie", "inscricao estadual", "insc estadual"]),
    f("contactName", "Contato", ["contato", "vendedor", "representante"]),
    f("phone", "Telefone", ["telefone", "fone", "tel"]),
    f("whatsapp", "Celular / WhatsApp", ["celular", "whatsapp", "cel"]),
    f("email", "E-mail", ["email", "e-mail"]),
    ...ADDRESS.filter((a) => a.key !== "complement"),
    f("paymentTerms", "Condição de pagamento", ["condicao pagamento", "cond pagto", "prazo pagamento", "condicao"]),
    f("specialties", "Especialidades / ramo", ["ramo", "especialidade", "atividade", "segmento"]),
    f("notes", "Observações", ["obs", "observacao", "observacoes"]),
  ],
  ITENS: [
    f("sku", "Código da peça (SKU)", ["codigo", "cod", "codigo interno", "cod produto", "codigo produto", "referencia"], { required: true }),
    f("name", "Descrição", ["descricao", "produto", "nome", "descricao produto"], { required: true }),
    f("mfrCode", "Código do fabricante", ["codigo fabricante", "cod fabricante", "ref fabricante", "part number"]),
    f("oemCode", "Código OEM / original", ["oem", "codigo original", "cod original", "original"]),
    f("brand", "Marca", ["marca", "fabricante"]),
    f("category", "Categoria / grupo", ["grupo", "categoria", "familia", "subgrupo"]),
    f("unit", "Unidade", ["unidade", "und", "un", "unid"]),
    f("location", "Localização", ["localizacao", "local", "prateleira", "endereco"]),
    f("cost", "Custo unitário", ["custo", "preco custo", "custo medio", "vlr custo", "valor custo", "custo unitario"]),
    f("price", "Preço de venda", ["preco venda", "venda", "preco", "vlr venda", "valor venda"]),
    f("onHand", "Saldo em estoque", ["estoque", "saldo", "qtd", "quantidade", "estoque atual", "saldo atual"]),
    f("minQty", "Estoque mínimo", ["minimo", "estoque minimo", "est min"]),
    f("maxQty", "Estoque máximo", ["maximo", "estoque maximo", "est max"]),
    f("supplierDocument", "CNPJ do fornecedor", ["cnpj fornecedor", "fornecedor cnpj"]),
    f("supplierCode", "Código do fornecedor no SYSCAR", ["cod fornecedor", "codigo fornecedor", "fornecedor"]),
  ],
  OS: [
    f("legacyNumber", "Número da OS no SYSCAR", ["os", "numero", "numero os", "n os", "nº os", "ordem", "codigo"], { required: true }),
    f("openedAt", "Data de abertura", ["data", "abertura", "data abertura", "dt abertura", "emissao", "data entrada"], { required: true }),
    f("closedAt", "Data de encerramento", ["encerramento", "data saida", "fechamento", "data fechamento", "dt saida", "entrega"]),
    f("plate", "Placa", ["placa"], { required: true }),
    f("vin", "Chassi", ["chassi", "chassis", "vin"]),
    f("customerDocument", "CPF/CNPJ do cliente", ["cpf/cnpj", "cpf", "cnpj", "documento"]),
    f("km", "Quilometragem", ["km", "quilometragem", "hodometro"]),
    f("complaint", "Reclamação / defeito", ["reclamacao", "defeito", "problema", "queixa", "solicitacao"]),
    f("services", "Serviços executados", ["servicos", "servico", "descricao", "servicos executados", "mao de obra"]),
    f("parts", "Peças aplicadas", ["pecas", "produtos", "materiais", "pecas aplicadas"]),
    f("total", "Valor total", ["total", "valor total", "valor", "vlr total", "total os", "total geral"]),
    f("technician", "Técnico / mecânico", ["tecnico", "mecanico", "executor"]),
    f("situation", "Situação", ["situacao", "status"]),
    f("notes", "Observações", ["obs", "observacao", "observacoes"]),
  ],
};

export const normHeader = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[º°.]/g, "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();

/** Sugere, para cada campo, o índice da coluna cujo cabeçalho mais se parece com um sinônimo. */
export function suggestMapping(entity: ImportEntity, headers: string[]): Record<string, number | null> {
  const hs = headers.map(normHeader);
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  // Primeiro correspondências exatas, depois parciais
  for (const pass of ["exact", "partial"] as const) {
    for (const field of FIELDS[entity]) {
      if (out[field.key] != null) continue;
      const idx = hs.findIndex((h, i) => !used.has(i) && h && field.synonyms.some((syn) => (pass === "exact" ? h === syn : h.includes(syn) && syn.length >= 3)));
      if (idx >= 0) { out[field.key] = idx; used.add(idx); }
    }
  }
  for (const field of FIELDS[entity]) if (!(field.key in out)) out[field.key] = null;
  return out;
}
