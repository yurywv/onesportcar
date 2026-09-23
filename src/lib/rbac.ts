import type { Role } from "@prisma/client";

// Permissões no formato modulo:acao (spec §4). Perfis customizáveis ficam para uma fase posterior (ver docs/adr).
export const PERMISSIONS = {
  "dashboard:ver": "Ver dashboard",
  "financeiro:ver_valores": "Ver faturamento, margem e custos",
  "clientes:ver": "Ver clientes",
  "clientes:editar": "Criar/editar clientes",
  "clientes:ver_documentos": "Ver CPF/CNPJ e contatos completos",
  "veiculos:ver": "Ver veículos",
  "veiculos:editar": "Criar/editar veículos",
  "agenda:ver": "Ver agenda",
  "agenda:editar": "Criar/editar agendamentos",
  "os:ver": "Ver ordens de serviço",
  "os:ver_todas": "Ver OS de todos os técnicos",
  "os:criar": "Abrir OS / check-in",
  "os:transicionar": "Mover OS entre status",
  "os:cancelar": "Cancelar OS",
  "os:diagnosticar": "Registrar inspeção e diagnóstico",
  "os:executar": "Apontar horas e concluir serviços",
  "os:cq": "Realizar controle de qualidade",
  "os:checkout": "Realizar check-out / entrega",
  "os:liberar_sem_pagamento": "Liberar entrega sem pagamento",
  "orcamento:editar": "Montar e enviar orçamentos",
  "orcamento:ver_custos": "Ver custo e margem no orçamento",
  "orcamento:registrar_aprovacao": "Registrar aprovação presencial/telefone",
  "pagamentos:registrar": "Receber pagamentos na OS",
  "estoque:ver": "Ver estoque",
  "estoque:movimentar": "Lançar entradas e ajustes",
  "estoque:requisitar": "Requisitar/aplicar peça na OS",
  "catalogo:editar": "Editar catálogo de serviços",
  "compras:ver": "Ver pedidos de compra e fornecedores",
  "compras:editar": "Criar e enviar pedidos de compra",
  "compras:aprovar": "Aprovar pedidos acima da alçada",
  "compras:receber": "Receber mercadorias (entrada por pedido)",
  "fornecedores:editar": "Cadastrar/editar fornecedores",
  "financeiro:ver": "Ver tesouraria, títulos e extratos",
  "financeiro:lancar": "Lançar títulos e faturar OS a prazo",
  "financeiro:receber": "Baixar títulos a receber",
  "financeiro:pagar": "Baixar títulos a pagar",
  "financeiro:estornar": "Estornar baixas e cancelar títulos",
  "financeiro:contas": "Gerenciar contas, categorias e transferências",
  "admin:usuarios": "Gerenciar usuários",
  "auditoria:ver": "Ver log de auditoria",
} as const;

export type Permission = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  CONSULTOR: "Consultor",
  TECNICO: "Técnico",
  ESTOQUISTA: "Estoquista",
  COMPRADOR: "Comprador",
  FINANCEIRO: "Financeiro",
  CAIXA: "Caixa",
  AUDITOR: "Auditor",
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ALL,
  GESTOR: ALL.filter((p) => p !== "admin:usuarios"),
  CONSULTOR: [
    "dashboard:ver", "clientes:ver", "clientes:editar", "clientes:ver_documentos", "veiculos:ver", "veiculos:editar",
    "agenda:ver", "agenda:editar", "os:ver", "os:ver_todas", "os:criar", "os:transicionar", "os:checkout",
    "orcamento:editar", "orcamento:registrar_aprovacao", "pagamentos:registrar", "estoque:ver", "compras:ver",
  ],
  TECNICO: ["os:ver", "os:diagnosticar", "os:executar", "os:cq", "os:transicionar", "estoque:ver", "estoque:requisitar", "veiculos:ver"],
  ESTOQUISTA: ["estoque:ver", "estoque:movimentar", "estoque:requisitar", "os:ver", "os:ver_todas", "compras:ver", "compras:receber"],
  COMPRADOR: ["estoque:ver", "estoque:movimentar", "os:ver", "os:ver_todas", "compras:ver", "compras:editar", "compras:receber", "fornecedores:editar", "orcamento:ver_custos"],
  FINANCEIRO: [
    "dashboard:ver", "financeiro:ver_valores", "clientes:ver", "clientes:ver_documentos", "os:ver", "os:ver_todas",
    "pagamentos:registrar", "orcamento:ver_custos", "estoque:ver", "compras:ver", "fornecedores:editar",
    "financeiro:ver", "financeiro:lancar", "financeiro:receber", "financeiro:pagar", "financeiro:estornar", "financeiro:contas",
  ],
  CAIXA: ["clientes:ver", "os:ver", "os:ver_todas", "pagamentos:registrar", "financeiro:ver", "financeiro:receber"],
  AUDITOR: [
    "dashboard:ver", "financeiro:ver_valores", "clientes:ver", "veiculos:ver", "agenda:ver", "os:ver", "os:ver_todas",
    "orcamento:ver_custos", "estoque:ver", "auditoria:ver", "compras:ver", "financeiro:ver",
  ],
};

export const can = (role: Role, perm: Permission) => ROLE_PERMISSIONS[role].includes(perm);

/** Limite de desconto (% sobre o valor do item) sem aprovação superior — DECISÃO B6 (padrão recomendado). */
const DISCOUNT_LIMIT: Partial<Record<Role, number>> = { ADMIN: 100, GESTOR: 15, CONSULTOR: 5 };
export const discountLimit = (role: Role) => DISCOUNT_LIMIT[role] ?? 0;

/** Alçada de aprovação de pedidos de compra (centavos). Acima disso, exige "compras:aprovar" de outra pessoa. */
const PURCHASE_LIMIT: Partial<Record<Role, number>> = { ADMIN: Number.MAX_SAFE_INTEGER, GESTOR: Number.MAX_SAFE_INTEGER, COMPRADOR: 500_000 };
export const purchaseLimit = (role: Role) => PURCHASE_LIMIT[role] ?? 0;
