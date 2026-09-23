// Templates de checklist (spec §6.7, §6.18). Versão 1 em código; templates configuráveis ficam para a Fase de administração.

export const CHECKIN_CONDITIONS = ["Pintura", "Pneus", "Rodas", "Vidros", "Faróis", "Lanternas", "Para-brisa", "Retrovisores", "Bancos", "Painel/acabamento interno", "Tapetes"];
export const CONDITION_OPTIONS = ["OK", "Desgaste", "Riscos", "Danificado", "N/A"];

export const DASH_LIGHTS = ["Motor (check engine)", "Freio/ABS", "Airbag", "Pressão dos pneus", "Óleo", "Bateria/carga", "Temperatura", "Estabilidade (ESP)", "Revisão", "Alta tensão"];

export const INSPECTION_TEMPLATES: Record<string, { group: string; items: string[] }[]> = {
  "Inspeção geral": [
    { group: "Motor", items: ["Vazamentos", "Correias", "Coxins", "Ruídos anormais"] },
    { group: "Fluidos", items: ["Óleo do motor", "Arrefecimento", "Fluido de freio", "Direção", "Lavador"] },
    { group: "Freios", items: ["Pastilhas dianteiras (mm)", "Pastilhas traseiras (mm)", "Discos dianteiros", "Discos traseiros", "Flexíveis"] },
    { group: "Suspensão e direção", items: ["Amortecedores", "Buchas e pivôs", "Terminais", "Folgas"] },
    { group: "Pneus", items: ["Dianteiro esquerdo (mm)", "Dianteiro direito (mm)", "Traseiro esquerdo (mm)", "Traseiro direito (mm)", "Pressões"] },
    { group: "Elétrica", items: ["Bateria 12V", "Iluminação externa", "Iluminação interna", "Varredura de códigos de falha"] },
    { group: "Ar-condicionado", items: ["Temperatura de saída", "Filtro de cabine"] },
  ],
  "Alta tensão (híbrido/elétrico)": [
    { group: "Segurança", items: ["EPI e área isolada", "Desenergização conforme procedimento"] },
    { group: "Bateria HV", items: ["Estado de saúde (SoH %)", "Isolamento", "Arrefecimento da bateria", "Conectores e cabos laranja"] },
    { group: "Carregamento", items: ["Carregador de bordo", "Porta de carga", "Atualização de software"] },
  ],
};

export const QC_ITEMS = [
  "Serviços executados conferidos item a item", "Torques aplicados e registrados (quando aplicável)", "Sem vazamentos", "Níveis corretos",
  "Painel sem alertas", "Varredura de códigos de falha sem pendências", "Teste funcional", "Limpeza interna/externa",
  "Peças removidas conforme escolha do cliente", "Documentação da OS completa",
];
