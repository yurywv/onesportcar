export const JOB_STATUS: Record<string, [string, string]> = {
  VALIDANDO: ["Validação interrompida", "badge badge-warn"], VALIDADO: ["Validado — aguardando confirmação", "badge badge-info"],
  IMPORTANDO: ["Importação interrompida", "badge badge-warn"], IMPORTADO: ["Importado", "badge badge-ok"],
  DESCARTADO: ["Descartado", "badge"], REVERTIDO: ["Revertido", "badge badge-danger"],
};
