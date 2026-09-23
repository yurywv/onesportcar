# Revisão do Prompt Mestre — OneSportcar

Data: 23/09/2026
Arquivos gerados nesta revisão:

| Arquivo | Para que serve |
|---|---|
| `REVISAO-DO-PROMPT.md` | Este documento: problemas encontrados, o que mudou e por quê |
| `ESPECIFICACAO-MESTRE-v2.md` | Especificação completa revisada. É a referência permanente do produto; o agente consulta, não executa de uma vez |
| `PROMPT-FASE-0-1.md` | Prompt curto a ser entregue ao agente agora. Aponta para a especificação e define entregáveis e pontos de parada |
| `DECISOES-PENDENTES.md` | Perguntas que só a OneSportcar pode responder. Devem ser respondidas antes ou durante a Fase 1 |

---

## 1. Avaliação geral

O prompt original é bom como **visão de produto**: cobre o ciclo inteiro da oficina, insiste em rastreabilidade, proíbe exclusão de registros críticos e exige critérios de aceite reais. A seção 56 (perguntas de rastreabilidade) é a parte mais valiosa e virou o teste de aceite central da v2.

Os problemas estão em quatro áreas:

1. **Lacunas de negócio brasileiras.** Faltam o módulo fiscal (NF-e/NFS-e, reforma tributária), comissões, adiantamentos, taxas de cartão e a virada do SYSCAR. É onde mora o risco real.
2. **Contradições no modelo da OS.** A OS é chamada de "entidade central", mas o fluxo a cria só depois da aprovação do orçamento. Com isso, check-in, inspeção e diagnóstico ficam sem OS.
3. **Regras deixadas "configuráveis" sem padrão.** Baixa de estoque, custo, numeração, KPIs e aprovação são citados sem uma regra padrão. O agente vai inventar uma e, pela própria seção 52, não pode "alterar regras silenciosamente". Isso gera travamento ou decisões ocultas.
4. **O formato como prompt para agente.** São 58 seções entregues de uma vez, com o papel de "equipe de 12 pessoas" que não muda nada no resultado. A Fase 0 pede "mapear processos atuais" a um agente que não tem acesso à oficina. E a instrução final manda seguir direto para a implementação, sem uma aprovação humana entre planejamento e código.

---

## 2. Os 12 ajustes críticos

### 2.1 Módulo fiscal inexistente (maior risco)
O original fala em "impostos" dentro do orçamento e nada mais. Uma oficina emite:
- **NFS-e** para mão de obra. Desde 01/2026 vale o padrão nacional (ADN/Sefin Nacional), mas cada município tem sua regra de transição.
- **NF-e** para peças (modelo 55) ou **NFC-e** para venda ao consumidor, conforme o caso.
- A **reforma tributária** (EC 132/2023, LC 214/2025) exige o destaque de **CBS e IBS** nos documentos a partir de 2026, em fase de teste, com transição até 2033.
- O **regime tributário** da DBL (Simples, Presumido ou Real) muda o cálculo inteiro.

**Na v2:** um módulo Fiscal dedicado, com emissão feita por um provedor homologado (Focus NFe, PlugNotas, NFE.io etc.) em vez de integração direta com a SEFAZ. Os impostos são calculados por regra fiscal parametrizada e não digitados no orçamento. Regime, município e CFOP/NBS entram como decisões pendentes, a validar com a contabilidade.

### 2.2 A OS precisa nascer no check-in
Na v2, a **OS é aberta no check-in**, ou no agendamento como "pré-OS". Inspeção, diagnóstico, orçamentos (com versões), aprovações, execução, CQ e check-out passam a ser filhos da OS. Isso resolve três pontos:
- as fotos do check-in já têm a OS a que pertencem, como a seção 11 exige;
- o Kanban deixa de ter uma coluna "AGENDADO" sem OS;
- a rastreabilidade da seção 56 vira uma consulta simples a partir de uma OS.

### 2.3 Orçamento complementar durante a execução
É a situação mais comum numa oficina: o técnico desmonta e encontra outro problema. O original não trata. Na v2, uma OS pode ter **vários orçamentos**, cada um com suas versões. O orçamento complementar passa pelo mesmo fluxo de aprovação e a OS volta para "Aguardando aprovação" sem perder o que já foi executado.

### 2.4 Regras de estoque definidas
- Reserva na aprovação do item, baixa na requisição para a OS e estorno na devolução.
- Custo pelo **custo médio ponderado móvel**. A margem da OS usa o custo do momento da baixa, gravado na linha, e não o custo atual.
- Estoque negativo bloqueado por padrão, com liberação por permissão e auditoria.
- Múltiplos locais de estoque e **peças fornecidas pelo cliente**, sem custo e fora da garantia.
- **Peças removidas**: devolução ao cliente ou descarte registrado. Óleo usado tem destinação obrigatória (Resolução CONAMA 362/2005).

### 2.5 Dinheiro e financeiro reais
- Adiantamento/sinal, muito comum para peças importadas em veículos premium.
- Taxas de cartão (MDR), parcelamento, antecipação e a diferença entre valor bruto e líquido recebido.
- PIX com cobrança dinâmica e conciliação automática; boleto via API bancária; importação de extrato OFX.
- **Comissões** de consultor e técnico, ausentes no original e quase sempre existentes.
- Cancelamento e estorno de OS faturada, com os reflexos em estoque, financeiro e fiscal.
- Valores sempre em `NUMERIC`/centavos. Nunca `float`.

### 2.6 Multiempresa/multiunidade
O dashboard filtra por "unidade", mas não existe uma entidade Unidade. Na v2, `Company` → `Branch` estão no ERD desde o início, com numeração, estoque, caixa e boxes por unidade. Isso custa quase nada agora e sai caro para adicionar depois.

### 2.7 Especificidades de veículos premium
- Híbridos e elétricos: **% de carga/SoC** em vez de só combustível, cuidados com alta tensão e técnico habilitado.
- Ferramentas de diagnóstico de montadora (PIWIS, ISTA, XENTRY/DAS, ODIS etc.): registro de sessão, atualização de software e codificação.
- Chaves keyless ou múltiplas; conjuntos de pneus (verão/inverno/pista) e **guarda de pneus/rodas** do cliente.
- **Test drive** com autorização do cliente e km/horário de saída e retorno.
- **Leva-e-traz** como processo com motorista, checklist na coleta, responsabilidade e horário, e não apenas um campo sim/não.
- Peças importadas: prazo, câmbio e rastreio.

### 2.8 Validações brasileiras concretas
- **CNPJ alfanumérico** a partir de julho/2026 (IN RFB 2.229/2024). O campo tem que ser texto, com o novo dígito verificador.
- Placa: um campo só, normalizado, aceitando o formato antigo (AAA9999) e o Mercosul (AAA9A99). O original tinha dois campos.
- Chassi/VIN com 17 caracteres; RENAVAM com dígito verificador.
- Quilometragem **não pode regredir** sem justificativa e auditoria.
- Dados que mudam com o tempo (pneus, bateria) ficam no histórico de componentes, não como campo fixo do veículo.
- Fuso `America/Sao_Paulo`, moeda BRL e formatos pt-BR.

### 2.9 Assinatura e imutabilidade bem definidas
"Assinatura digital" em sentido jurídico é ICP-Brasil, o que não é necessário aqui. A v2 especifica **assinatura eletrônica** (Lei 14.063/2020) desenhada na tela, com um pacote de evidências: hash SHA-256 do PDF, timestamp do servidor, IP, user-agent, geolocalização opcional e identificação do signatário. O PDF assinado vai para um armazenamento com **Object Lock (WORM)**. A aprovação por link carrega um token de uso único.

### 2.10 Portal do cliente com menos atrito
Um cliente de carro super premium dificilmente vai "criar conta" para aprovar um orçamento. Na v2, **a aprovação é feita por link seguro** (WhatsApp/e-mail) sem login, com token de uso único, validade curta e confirmação por OTP. A conta no portal é opcional e serve para histórico e agendamentos.

### 2.11 WhatsApp realista
Só a **WhatsApp Business Platform (Cloud API)**, direta ou via BSP, é aceitável, com templates aprovados pela Meta, janela de 24h, opt-in registrado e custo por conversa. APIs não oficiais estão proibidas, por risco de banimento e por LGPD.

### 2.12 Migração do SYSCAR como projeto de virada
O original fala em importar CSV. A v2 acrescenta:
- descoberta do que o SYSCAR exporta (CSV, acesso ao banco ou relatórios);
- **data de corte**;
- **saldos iniciais** de estoque (com custo), contas a pagar/receber em aberto e caixa;
- tratamento das **OS em andamento** no dia da virada;
- operação em paralelo por um período definido;
- conferência de totais (estoque valorizado e títulos em aberto batendo com o SYSCAR);
- plano de rollback.

A Fase 7 também sai do fim: a **importação de cadastros** (clientes, veículos, fornecedores, peças) passa a acontecer junto com o MVP, porque ninguém testa um sistema de oficina com a base vazia.

---

## 3. Contradições e ambiguidades corrigidas

| Original | Problema | Na v2 |
|---|---|---|
| Fluxo: Orçamento → Aprovação → OS | Contradiz "OS central" e a seção 11 | OS aberta no check-in (2.2) |
| Kanban com coluna AGENDADO | Não existe OS no agendamento | Pré-OS ou coluna alimentada pela agenda |
| "Não use dados mockados" x "Crie seed data" | Parecem conflitar | Seed só em dev/homologação, nunca em produção, com dados sintéticos gerados (sem CPF real) |
| "Arquitetura desacoplada e preparada para escala" | Convida a microserviços desnecessários para 1–3 unidades | **Monólito modular** com fronteiras claras por módulo; eventos internos via outbox |
| Vercel (front) + Railway/AWS (back) | Cookies cross-domain, latência BR, residência de dados | Front e API no mesmo domínio-pai; banco e arquivos em região Brasil (ex.: AWS sa-east-1) |
| "Autenticação robusta" | Nenhuma escolha feita | Decisão pendente com recomendação (ver DECISOES) |
| "Estoque baixa conforme regra configurada" | Sem padrão | Regra padrão definida (2.4), configurável depois |
| KPIs listados sem fórmula | Cada relatório calcularia de um jeito | Glossário de KPIs com fórmula única (seção 30 da v2) |
| "Assinatura digital" | Termo jurídico ambíguo | Assinatura eletrônica com evidências (2.9) |
| Numeração "OS-000001" | Concorrência e unidade não tratadas | Sequência por unidade e tipo, gerada em transação; números fiscais vêm do provedor |
| "Backup — documentar RPO/RTO" | Sem metas | RPO ≤ 15 min (PITR), RTO ≤ 4 h, teste de restore mensal |
| Fase 0 "mapear processos da OneSportcar" | O agente não tem acesso à oficina | Fase 0 vira: hipóteses + questionário + validação humana |
| "Após o planejamento, prossiga para implementação" | Sem aprovação humana | **Ponto de parada obrigatório** após a Fase 1 |
| IA: "respeitar RBAC" | Text-to-SQL livre vaza dados | A IA consulta via ferramentas/endpoints que já aplicam RBAC; nunca SQL livre |

---

## 4. Lacunas acrescentadas (resumo)

- **Entidades novas no ERD:** Company, Branch, ServiceCatalog (tabela de tempos/mão de obra), PriceList, VehicleMake/Model, VehicleComponent, VehicleOwnership, ChecklistTemplate, WorkOrderStatusHistory, StockLocation, StockLot, InventoryCount, QuotationItem, FiscalDocument, Installment, BankTransaction, Commission, Deposit (adiantamento), Signature, DocumentVersion, NumberSequence, Consent, MessageTemplate, AutomationRule, Opportunity, Survey, TireStorage, DeliveryTrip (leva-e-traz), TestDrive, OutboxEvent.
- **Não funcionais com números:** p95 < 500 ms nas telas operacionais, disponibilidade de 99,5% em horário comercial, WCAG 2.1 AA, suporte a Chrome/Safari/Edge nas duas últimas versões, tablet como dispositivo principal da oficina.
- **Modo offline** no check-in e no checklist (PWA com fila de sincronização), porque o Wi-Fi costuma ser fraco na área dos boxes.
- **LGPD operacional:** encarregado (DPO), registro das operações (ROPA), tabela de retenção por tipo de dado, fotos do interior (objetos pessoais, terceiros), atendimento a titular com prazo e exportação.
- **Garantia legal:** o CDC (art. 26) dá 90 dias para reclamar de vício em serviço/produto durável. A garantia contratual é somada a esse prazo, não o substitui.
- **Governança do agente:** ADRs (registro de decisões), `CLAUDE.md`/`AGENTS.md` com as convenções do repositório, CI obrigatória e Definition of Done por história.

---

## 5. Recomendação de uso

1. **Responder `DECISOES-PENDENTES.md`** com a direção e a contabilidade da DBL. É o que mais reduz retrabalho.
2. Entregar ao agente **apenas `PROMPT-FASE-0-1.md`**, com a especificação v2 no repositório (`docs/`).
3. Revisar os entregáveis da Fase 1 (ERD, RBAC, workflow da OS, backlog) antes de liberar código.
4. Para cada fase seguinte, escrever um prompt curto nos mesmos moldes: objetivo, escopo, fora de escopo, critérios de aceite e ponto de parada.
5. Os módulos que merecem especificação própria antes de serem implementados, em ordem de risco: **Fiscal → Financeiro → Estoque/Compras → OS/Orçamento → Check-in → WhatsApp/Portal**.

> Observação: as referências legais (reforma tributária, NFS-e nacional, CNPJ alfanumérico, CDC, CONAMA) foram citadas para orientar a especificação. A aplicação ao caso concreto da DBL deve ser confirmada com a contabilidade e o jurídico.
