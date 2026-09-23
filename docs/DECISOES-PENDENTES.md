# Decisões Pendentes — OneSportcar

Responder antes ou durante a Fase 1. Cada item traz uma **recomendação padrão**: se não houver resposta até a data combinada, o agente segue a recomendação e registra um ADR.

Legenda de quem decide: **DIR** = Direção DBL · **CONT** = Contabilidade · **JUR** = Jurídico/DPO · **OPS** = Gerência da oficina · **TI** = Responsável técnico

## A. Fiscal e tributário (bloqueia faturamento)

| # | Pergunta | Quem | Recomendação padrão |
|---|---|---|---|
| A1 | Qual o regime tributário da DBL Automotiva (Simples, Presumido, Real)? | CONT | — (obrigatório responder) |
| A2 | Em qual município a DBL presta os serviços? O município já está no padrão nacional de NFS-e ou ainda usa um provedor próprio? | CONT | Emissor que atenda os dois (padrão nacional + municipal) |
| A3 | Peças saem em NF-e (modelo 55), NFC-e ou em nota conjugada? | CONT | NF-e para peças + NFS-e para serviços, as duas vinculadas à OS |
| A4 | Qual provedor de emissão fiscal usar? | TI/CONT | Avaliar Focus NFe, PlugNotas e NFE.io (preço por nota, SLA, suporte à NFS-e nacional e à CBS/IBS) |
| A5 | O sistema fiscal atual (o SYSCAR ou outro) continua emitindo durante a transição? | CONT | Não: emitir só pelo sistema novo a partir da data de corte |
| A6 | Como a contabilidade recebe os dados (XML, SPED, exportação contábil)? Qual o sistema contábil? | CONT | Exportação mensal de XMLs + CSV de lançamentos no layout do contador |

## B. Operação da oficina

| # | Pergunta | Quem | Recomendação padrão |
|---|---|---|---|
| B1 | Quantas unidades existem hoje? Há previsão de abrir outras? | DIR | Modelar multiunidade desde já e operar com 1 unidade |
| B2 | Quantos boxes/elevadores, técnicos, consultores? Qual o volume médio de OS por dia/mês? | OPS | — (dimensiona agenda e capacidade) |
| B3 | A OS é aberta no agendamento ou no check-in? | OPS | Pré-OS no agendamento, que vira OS no check-in |
| B4 | Como é cobrada a mão de obra: tabela de tempo por serviço, hora efetivamente trabalhada ou preço fechado? | OPS/DIR | Tabela de tempo (hora vendida) com valor/hora por nível técnico; preço fechado permitido por serviço |
| B5 | Há valores/hora diferentes por marca, por tipo de serviço (elétrica, motor, diagnóstico) ou por nível do técnico? | OPS | Sim: tabela de preço por categoria de serviço, com override por marca |
| B6 | Quem pode dar desconto e até quanto (%) sem aprovação? | DIR | Consultor até 5%, Gestor até 15%, acima disso Administrador. Tudo auditado |
| B7 | Quando a peça sai do estoque: na requisição para a OS, na aplicação ou no faturamento? | OPS | Reserva na aprovação e baixa na requisição |
| B8 | A oficina aceita peça trazida pelo cliente? Com qual política de garantia? | DIR | Aceita, sem garantia sobre a peça, com termo assinado |
| B9 | O que acontece com as peças removidas? | OPS | O cliente escolhe na aprovação: devolver ou descartar |
| B10 | Existe teste de rodagem? Quem autoriza e há limite de km? | OPS | Autorização do cliente registrada, com km e horário de saída e retorno |
| B11 | Existe serviço de leva-e-traz? Motorista próprio ou terceiro? | OPS | Processo próprio com checklist na coleta e na entrega |
| B12 | A oficina guarda pneus/rodas de clientes? | OPS | Módulo simples de guarda, com localização e fotos |
| B13 | Atende híbridos/elétricos? Há técnico com NR-10/habilitação para alta tensão? | OPS | Sim: campo de SoC e flag "alta tensão" exigindo técnico habilitado |
| B14 | Quais ferramentas de diagnóstico de montadora a oficina usa? | OPS | Registrar a sessão de diagnóstico e anexar o relatório exportado |
| B15 | Qual a política de garantia própria (prazo e km) para serviço e para peça? | DIR/JUR | 90 dias (mínimo legal do CDC) ou o prazo da montadora/fornecedor, o que for maior |
| B16 | O CQ é feito por pessoa diferente de quem executou? | OPS | Sim, obrigatório (segregação) |

## C. Financeiro

| # | Pergunta | Quem | Recomendação padrão |
|---|---|---|---|
| C1 | Existe cobrança de sinal/adiantamento (ex.: peças importadas)? | DIR | Sim, configurável por OS, abatido no faturamento |
| C2 | Quais adquirentes/maquininhas e bancos são usados? Há taxas por bandeira e parcelas? | CONT | Cadastrar taxas por forma, bandeira e parcela; o recebível fica pelo valor líquido previsto |
| C3 | O PIX e o boleto serão gerados pelo sistema (API bancária) ou fora dele? | CONT/TI | PIX dinâmico via API do banco com conciliação automática, na Fase 4 |
| C4 | Existem comissões? De quem, sobre qual base (bruto, líquido, margem) e quando são pagas (faturamento ou recebimento)? | DIR | Comissão sobre o valor recebido, por item, com regra por perfil |
| C5 | Existe plano de contas e centros de custo já definidos pela contabilidade? | CONT | Importar o plano da contabilidade; não inventar |
| C6 | Qual a política de inadimplência? O veículo pode ser entregue sem pagamento? | DIR | Entrega exige pagamento, ou liberação por Gestor com motivo registrado |
| C7 | Faturamento a prazo para PJ/frotas? | DIR | Permitido com limite de crédito por cliente |

## D. Cliente, portal e comunicação

| # | Pergunta | Quem | Recomendação padrão |
|---|---|---|---|
| D1 | A aprovação de orçamento por link sem login é aceitável para a direção? | DIR/JUR | Sim, com token de uso único + OTP por WhatsApp/SMS + registro de evidências |
| D2 | Já existe número de WhatsApp Business? Usa algum BSP ou atendente humano pelo app? | OPS/TI | WhatsApp Cloud API oficial; mensagens automáticas por template e atendimento humano em inbox compartilhada |
| D3 | Quem assina a entrega quando o veículo é retirado por terceiro (motorista, assistente)? | DIR/JUR | Autorização prévia do titular registrada no sistema |
| D4 | Há pesquisa de NPS hoje? Em qual canal e quantos dias após a entrega? | OPS | WhatsApp, 3 dias após a entrega |

## E. LGPD, segurança e infraestrutura

| # | Pergunta | Quem | Recomendação padrão |
|---|---|---|---|
| E1 | Quem é o Encarregado (DPO) da DBL? | JUR | — (obrigatório indicar) |
| E2 | Prazos de retenção por tipo de dado (fotos, vídeos, documentos fiscais, logs)? | JUR/CONT | Fiscal/contábil: prazo legal definido pela contabilidade (mín. 5 anos); fotos de check-in: 5 anos; logs de acesso: 6 meses (Marco Civil) + auditoria de negócio: indefinido |
| E3 | Os dados podem ficar fora do Brasil? | JUR | Banco e arquivos em região Brasil (ex.: AWS sa-east-1) |
| E4 | Provedor de autenticação? | TI | Auth própria na aplicação (ex.: Better Auth ou equivalente) com MFA TOTP; evitar SaaS de identidade com dados fora do BR |
| E5 | Quais perfis terão MFA obrigatório? | DIR/TI | Administrador, Gestor, Financeiro e Auditor |
| E6 | Orçamento de infraestrutura mensal aceitável? | DIR | — (define entre PaaS e AWS gerenciado) |
| E7 | É produto interno da DBL ou há intenção de vender como SaaS para outras oficinas? | DIR | Interno, mas com `company_id` em todas as tabelas para não fechar a porta |

## F. Migração SYSCAR

| # | Pergunta | Quem | Recomendação padrão |
|---|---|---|---|
| F1 | O que o SYSCAR exporta? Há acesso ao banco de dados (qual SGBD) ou só a relatórios XLS/CSV? O contrato permite a extração? | TI | Levantar na Fase 0 com amostras anonimizadas |
| F2 | Quanto histórico de OS migrar (tudo, 5 anos, 2 anos)? | DIR | 5 anos de OS como histórico somente leitura |
| F3 | Data de corte desejada e período de operação em paralelo? | DIR | Virada no início de um mês, com 2 semanas em paralelo |
| F4 | Até quando o contrato do SYSCAR precisa ser mantido (consulta, obrigações fiscais)? | DIR/CONT | Manter acesso de consulta por 6–12 meses após a virada |
