export const CHANNEL_LABEL = { EMAIL: "E-mail", WHATSAPP_API: "WhatsApp (API oficial)", WHATSAPP_MANUAL: "WhatsApp assistido" } as const;
export const STATUS_LABEL = { RASCUNHO: "Rascunho", ENVIANDO: "Enviando", PAUSADA: "Pausada", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" } as const;
export const STATUS_TONE = { RASCUNHO: "badge", ENVIANDO: "badge badge-info", PAUSADA: "badge badge-warn", CONCLUIDA: "badge badge-ok", CANCELADA: "badge badge-danger" } as const;
export const RSTATUS_LABEL = { PENDENTE: "Pendente", ENVIADO: "Enviado", FALHOU: "Falhou", PULADO: "Pulado" } as const;
