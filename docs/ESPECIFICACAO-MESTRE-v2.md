# OneSportcar — Especificação Mestre v2

Produto: **OneSportcar Workshop Management Platform**
Empresa: DBL Automotiva Ltda. — oficina de veículos premium e super premium
Substitui: SYSCAR (substituição progressiva)
Versão: 2.0 — 23/09/2026 (revisão da v1; mudanças explicadas em `REVISAO-DO-PROMPT.md`)

> **Como usar este documento.** Esta é a referência permanente do produto. Não é uma ordem para implementar tudo. Cada fase recebe um prompt próprio (ex.: `PROMPT-FASE-0-1.md`) que aponta para as seções relevantes. Itens marcados **[DECISÃO X#]** dependem de `DECISOES-PENDENTES.md`. Enquanto a decisão não chega, vale a recomendação padrão, registrada em ADR.

---

## 1. Objetivo

Plataforma única de gestão de oficina que integra CRM, clientes, veículos, agenda, check-in, inspeção, diagnóstico, orçamento, aprovação, OS, oficina, técnicos, estoque, compras, fornecedores, ferramentas, fiscal, financeiro, qualidade, check-out, garantias, relatórios e portal do cliente.

Objetivos:
- eliminar controles paralelos (planilhas, WhatsApp pessoal, cadernos);
- **cada fato registrado uma única vez**, com os reflexos de estoque, financeiro e fiscal gerados automaticamente;
- responder a qualquer pergunta de rastreabilidade da seção 24 a partir do número de uma OS.

---

## 2. Princípios e requisitos não funcionais

1. **Tablet-first na oficina, mobile-first no portal, desktop para back-office.** Nenhuma tela pode ficar inutilizável em 360 px de largura.
2. **Poucos cliques.** Check-in completo (sem fotos) em até 5 minutos; aprovação do cliente em até 3 toques.
3. **Rastreabilidade e auditoria** em toda operação que altere valor, estoque, status, permissão ou documento.
4. **Nada crítico é apagado fisicamente.** Usar cancelamento, inativação, estorno ou nova versão.
5. **Sem redigitação.** Um dado lançado num módulo é consumido pelos outros.
6. **Monólito modular.** Um deploy, módulos com fronteiras explícitas (sem acesso direto às tabelas de outro módulo) e eventos de domínio internos via outbox.
7. **APIs documentadas** (OpenAPI), prontas para integrações e para o assistente de IA.
8. **Metas mensuráveis:**
   - p95 < 500 ms nas leituras operacionais e < 1 s nas gravações com efeitos;
   - disponibilidade de 99,5% das 7h às 20h, de segunda a sábado;
   - RPO ≤ 15 min e RTO ≤ 4 h;
   - acessibilidade WCAG 2.1 AA;
   - navegadores: Chrome, Safari e Edge, nas duas últimas versões; iPadOS e Android em tablets.
9. **Offline parcial.** Check-in, checklist, fotos e apontamento de horas funcionam sem rede e sincronizam depois, com fila e resolução de conflitos.
10. **Localização:** pt-BR, BRL e fuso `America/Sao_Paulo`. Datas gravadas em UTC.
11. **Dinheiro** sempre em `NUMERIC(14,2)` ou centavos inteiros, com arredondamento definido (half-even no cálculo de impostos, conforme a regra fiscal). Nunca ponto flutuante.
12. **Multiempresa/multiunidade:** toda tabela de negócio tem `company_id` e, quando aplicável, `branch_id`.

---

## 3. Glossário

| Termo | Definição |
|---|---|
| OS | Ordem de Serviço: agregado central. Aberta no check-in, encerrada no check-out/faturamento |
| Pré-OS | Registro criado pelo agendamento; vira OS no check-in |
| Orçamento | Proposta vinculada a uma OS. Uma OS pode ter vários (inicial + complementares) |
| Versão de orçamento | Snapshot imutável de um orçamento enviado ao cliente |
| Hora vendida | Tempo cobrado do cliente (tabela de tempo ou preço fechado convertido) |
| Hora trabalhada | Tempo apontado pelo técnico (iniciar/pausar/finalizar) |
| Hora disponível | Jornada do técnico menos ausências |
| Retorno | Volta do veículo por queixa relacionada a serviço anterior |
| Retrabalho | Retorno cuja causa é falha de execução da oficina |
| Custo médio | Custo médio ponderado móvel do item no local de estoque |

---

## 4. Perfis e permissões (RBAC)

Permissão = `módulo:recurso:ação` (ex.: `os:orcamento:aprovar_desconto`), com escopo opcional (`propria`, `unidade`, `empresa`).

| Perfil | Escopo principal |
|---|---|
| Administrador | Tudo, inclusive usuários, perfis e parâmetros. MFA obrigatório |
| Gestor | Operação, gerencial e financeiro da unidade. Aprova descontos acima do limite e liberações excepcionais. MFA obrigatório |
| Consultor | Clientes, veículos, agenda, check-in, orçamento, OS, check-out. Desconto até o limite **[DECISÃO B6]** |
| Técnico | Somente OS atribuídas: checklist, diagnóstico, fotos, apontamento, requisição de peças. Não vê preço de venda nem margem |
| Estoquista | Estoque, movimentações, reservas, inventário, recebimento físico |
| Comprador | Solicitações, cotações, pedidos, fornecedores |
| Financeiro | Pagar, receber, caixa, conciliação, fiscal, relatórios financeiros. MFA obrigatório |
| Caixa | Recebimentos e fechamento de caixa da unidade |
| Auditor | Leitura das áreas autorizadas e dos logs. MFA obrigatório |
| Cliente | Somente os próprios veículos, OS, orçamentos, aprovações, documentos e pagamentos |

Regras:
- perfis customizáveis;
- **segregação de funções**: quem executa não faz o CQ da mesma OS **[B16]**; quem lança pagamento não aprova o próprio lançamento acima de um valor configurável;
- toda alteração de perfil ou permissão é auditada.

A matriz completa perfil × permissão é um entregável da Fase 1.

---

## 5. Ordem de Serviço — modelo central

### 5.1 Estrutura
```
Cliente ─┬─ Veículo
         └─ OS ─┬─ CheckIn (1)          ── Fotos/Vídeos, Avarias, Assinatura
                ├─ Inspeções (N)        ── Itens de checklist
                ├─ Diagnósticos (N)
                ├─ Orçamentos (N) ── Versões (N, imutáveis) ── Itens ── Aprovações (N, imutáveis)
                ├─ Itens da OS (serviços, peças, consumíveis, terceiros) ← gerados de itens aprovados
                ├─ Apontamentos de tempo (N)
                ├─ Requisições/Movimentos de estoque (N)
                ├─ Controle de Qualidade (N tentativas)
                ├─ Documentos fiscais (N)
                ├─ Títulos a receber / Pagamentos (N)
                ├─ CheckOut (1)
                └─ Histórico de status (N, append-only)
```

### 5.2 Máquina de estados

| Status | Entra quando | Sai para |
|---|---|---|
| PRE_OS | Agendamento criado | CHECK_IN, CANCELADA |
| CHECK_IN | Check-in iniciado | AGUARDANDO_DIAGNOSTICO |
| AGUARDANDO_DIAGNOSTICO | Check-in assinado | EM_DIAGNOSTICO |
| EM_DIAGNOSTICO | Técnico iniciou | ORCAMENTO |
| ORCAMENTO | Diagnóstico concluído | AGUARDANDO_APROVACAO |
| AGUARDANDO_APROVACAO | Versão enviada ao cliente | AGUARDANDO_PECAS, EM_EXECUCAO, ENCERRADA_SEM_SERVICO |
| AGUARDANDO_PECAS | Item aprovado sem estoque disponível | EM_EXECUCAO |
| EM_EXECUCAO | Peças disponíveis + técnico iniciou | AGUARDANDO_APROVACAO (complementar), CONTROLE_QUALIDADE |
| CONTROLE_QUALIDADE | Todos os itens aprovados concluídos | EM_EXECUCAO (reprovado), PREPARACAO |
| PREPARACAO | CQ aprovado | PRONTO_ENTREGA |
| PRONTO_ENTREGA | Lavagem/preparação concluída | ENTREGUE |
| ENTREGUE | Check-out assinado + pagamento quitado ou liberação autorizada **[C6]** | — (final) |
| ENCERRADA_SEM_SERVICO | Cliente recusou tudo; cobra diagnóstico se configurado | ENTREGUE (retirada) |
| CANCELADA | Somente antes de haver faturamento; exige motivo e permissão | — (final) |

Regras:
- toda transição valida pré-condições no **backend**. O Kanban só chama a transição e mostra o erro de regra;
- cada transição grava `WorkOrderStatusHistory` (de, para, usuário, data/hora, motivo, origem: tela/API/automação);
- **orçamento complementar** leva a OS a AGUARDANDO_APROVACAO sem perder os itens em execução, que continuam nas próprias linhas;
- reabertura após ENTREGUE é proibida. O caminho é uma nova OS do tipo RETORNO/GARANTIA vinculada à original.

### 5.3 Kanban
As colunas espelham a máquina de estados; a coluna AGENDADO mostra as Pré-OS do dia. Cada card traz: foto/modelo do veículo, placa, cliente, nº da OS, técnico, consultor, previsão, prioridade e indicadores de atraso, peça pendente e aprovação pendente. Drag-and-drop dispara a transição com validação; filtros por técnico, consultor, box e prioridade; atualização em tempo real (SSE/WebSocket).

---

## 6. Módulos funcionais

### 6.1 Dashboard
Painéis por perfil com os indicadores da seção 9 e as filas: agendados hoje, aguardando check-in, na oficina, OS por status, atrasadas, aguardando peças, prontos para entrega, faturamento do dia e do mês, ticket médio, margem, receber/pagar, estoque crítico, compras pendentes, produtividade, ocupação dos boxes, retornos, retrabalhos, garantias e NPS. Filtros: período, unidade, técnico, consultor, tipo de serviço. Cada número abre a lista que o compõe (drill-down).

### 6.2 Clientes (CRM)
- PF/PJ: nome ou razão social, fantasia, CPF/CNPJ, RG/IE, nascimento, telefones, WhatsApp, e-mail, endereços (N), contatos adicionais (N, com papel: assistente, motorista, financeiro), preferências de comunicação, origem, observações, status, primeiro e último atendimento.
- **CNPJ alfanumérico** (IN RFB 2.229/2024): tipo texto, validação do novo DV. CPF validado. CEP via ViaCEP/BrasilAPI, com fallback manual.
- Duplicidade: bloqueio por CPF/CNPJ; alerta (sem bloqueio) por telefone ou e-mail já existentes; ferramenta de **mesclagem** auditada.
- Consentimentos LGPD por finalidade e canal (seção 14).
- Limite de crédito para PJ **[C7]**.
- Timeline: OS, orçamentos, comunicações, pagamentos, oportunidades, NPS.
- Oportunidades: serviços recomendados e não aprovados, revisões previstas, retorno de pneus da guarda.

### 6.3 Veículos
- Placa em **um campo normalizado** (aceita AAA9999 e AAA9A99), RENAVAM (DV), chassi/VIN (17 caracteres, validação), marca/modelo/versão (catálogo próprio, FIPE opcional), anos de fabricação e modelo, cor, combustível/propulsão (combustão, híbrido, PHEV, elétrico), motor, cilindrada, potência, transmissão, tração, número do motor, observações.
- **Componentes com histórico** (não campos fixos): pneus (medida, marca, DOT, conjunto verão/inverno/pista), bateria, bateria de alta tensão.
- **Quilometragem**: histórico de leituras; uma leitura menor que a anterior exige justificativa e fica auditada.
- Proprietários: histórico de vínculo cliente–veículo com datas (o veículo pode trocar de dono dentro da base).
- Fotos, documentos e timeline de manutenção (km × serviço), gerada a partir das OS.

### 6.4 Agenda
Visões diária, semanal e mensal, por consultor, técnico e box. Campos: cliente, veículo, serviços previstos (do catálogo, com tempo estimado), problema relatado, data/hora, duração, técnico, consultor, box, prioridade, **leva-e-traz** (endereço, janela, motorista), observações.
- Capacidade: impede sobreposição de box e técnico; alerta quando as horas agendadas passam da capacidade do dia.
- Reagendamento com histórico; cancelamento com motivo; no-show registrado.
- Confirmação e lembrete automáticos (seção 6.21). O agendamento cria a Pré-OS.

### 6.5 Portal do cliente (PWA)
- **Acesso sem conta** por link com token de uso único + OTP (WhatsApp/SMS) para: ver o status da OS, ver fotos/vídeos, aprovar ou recusar o orçamento item a item, assinar e pagar (PIX).
- **Conta opcional** para: veículos, histórico, documentos, agendar, reagendar ou cancelar (conforme política), relatar problema com fotos, notificações push.
- Timeline: AGENDADO → RECEBIDO → INSPEÇÃO → DIAGNÓSTICO → ORÇAMENTO → APROVAÇÃO → EXECUÇÃO → QUALIDADE → PRONTO → ENTREGUE. O cliente nunca vê notas internas, custo nem margem.

### 6.6 Check-in digital
Na OS: data/hora, responsável, quem trouxe o veículo (titular ou terceiro autorizado), como chegou (rodando, guincho, leva-e-traz), km, combustível **ou % de carga (SoC)**, autonomia, luzes do painel (seleção de ícones + foto), chaves (quantidade, tipo), manual, documentos, objetos pessoais, acessórios, estado interno e externo, pneus, rodas, vidros, faróis, lanternas, para-brisa.
- **Mapa de avarias** sobre um diagrama vetorial do veículo (vistas superior, laterais, frente, traseira, interior): cada marcação tem tipo (risco, amassado, trinca, roda, interno), severidade, foto e nota.
- Fotos/vídeos: captura direta pela câmera, compressão e thumbnail no cliente, upload assíncrono e retomável. Metadados: usuário, data/hora do servidor, OS, veículo, tipo, hash.
- Fotos mínimas obrigatórias configuráveis (ex.: 4 cantos + painel + rodas).
- Finaliza com a **assinatura eletrônica** do cliente (seção 8.3). O PDF é gerado e selado; depois disso o check-in fica somente leitura, e correções viram adendos.

### 6.7 Inspeção e checklists
Templates configuráveis e versionados por tipo de serviço/marca (motor, transmissão, suspensão, freios, pneus, elétrica, bateria, iluminação, fluidos, A/C, segurança, diagnóstico eletrônico, alta tensão). Status por item: OK, ATENÇÃO, RECOMENDADO, URGENTE, N/A. Cada item aceita texto, foto, vídeo, **medição com unidade e faixa de referência** (ex.: espessura de pastilha em mm), observação e recomendação. Itens RECOMENDADO/URGENTE viram sugestão de item de orçamento com um toque.

### 6.8 Diagnóstico
Reclamação do cliente (texto original preservado), testes realizados, códigos de falha (código, sistema, status, snapshot), **sessão de ferramenta de montadora** (ferramenta, relatório anexo, atualizações de software/codificações feitas), diagnóstico, causa provável, solução recomendada, peças e mão de obra sugeridas, mídias e documentos. Técnico e horários registrados. O tempo de diagnóstico pode ser cobrado.

### 6.9 Orçamento
- Criado a partir de inspeção/diagnóstico ou manualmente, sempre dentro de uma OS.
- Tipos de item: SERVIÇO (do catálogo de mão de obra, com tempo padrão e valor/hora da tabela **[B4, B5]**), PEÇA (com disponibilidade e prazo em tempo real), CONSUMÍVEL, TERCEIRO, TAXA (ex.: diagnóstico, descarte).
- Classificação: OBRIGATÓRIO, RECOMENDADO, PREVENTIVO, OPCIONAL. Itens podem ser agrupados em "pacotes" (ex.: "Freios dianteiros" = serviço + pastilhas + sensor).
- Colunas: quantidade, unitário, desconto (% ou valor, por item e no total), subtotal, impostos (calculados pelo motor fiscal, seção 6.16, e **não digitados**), total. Custo e margem aparecem só para perfis autorizados.
- Desconto acima do limite do perfil fica bloqueado até a aprovação do Gestor **[B6]**.
- **Versionamento:** enviar ao cliente congela a versão (snapshot imutável + PDF). Qualquer alteração depois disso cria a versão N+1. Versões anteriores continuam visíveis.
- Validade do orçamento e prazo estimado de entrega.

### 6.10 Aprovação
- Canais: portal/link, presencial (tablet), telefone (registrado pelo consultor, com evidência obrigatória: gravação, print ou e-mail).
- Aprovação total, parcial ou item a item. Cada decisão grava: item, versão, decisão, data/hora do servidor, canal, identificação (usuário/OTP/telefone), IP, user-agent e evidência.
- Registros de aprovação são append-only: uma mudança de ideia gera um novo registro.
- Itens aprovados geram itens da OS e **reservas de estoque**. Itens recusados geram **oportunidades no CRM**.
- Na aprovação, o cliente escolhe o destino das peças removidas (devolver/descartar) **[B9]** e autoriza o test drive **[B10]**.

### 6.11 Execução, técnicos e apontamento
- Cadastro do técnico: especialidades, nível, habilitações (ex.: alta tensão/NR-10), valor/hora de venda, custo/hora, jornada, treinamentos e certificações com validade.
- Apontamento por item da OS: INICIAR, PAUSAR (com motivo: aguardando peça, almoço, outra OS), RETOMAR, FINALIZAR. Um técnico tem no máximo um apontamento ativo; apontamentos esquecidos abertos geram alerta ao fim da jornada.
- Item marcado como "alta tensão" só pode ser iniciado por técnico habilitado.

### 6.12 Boxes
Código, descrição, capacidade, equipamentos, status (LIVRE, OCUPADO, RESERVADO, MANUTENÇÃO, INDISPONÍVEL), OS e técnico atuais. A ocupação é derivada dos apontamentos e da alocação da OS, não digitada.

### 6.13 Ferramentas e equipamentos
Código, patrimônio, descrição, fabricante, modelo, série, localização, responsável, aquisição, valor, garantia, calibração (última, próxima, certificado anexo), manutenção e condição. Retirada e devolução por técnico (com OS opcional). Alertas de calibração e manutenção. Ferramenta com calibração vencida fica bloqueada para retirada quando marcada como "exige calibração".

### 6.14 Estoque
- Item: SKU, código interno, código do fabricante, código OEM, **equivalências/intercambiáveis**, descrição, marca, aplicação (marca/modelo/ano), unidade (com conversão de compra para estoque), NCM, CEST, origem, categoria (PEÇAS, ÓLEOS, FLUIDOS, FILTROS, PNEUS, QUÍMICOS, CONSUMÍVEIS, ACESSÓRIOS), fornecedores, custo médio, preço/markup, mínimo, máximo, ponto de pedido, controle por lote/validade quando aplicável.
- **Locais de estoque** por unidade (almoxarifado, prateleira/posição).
- Movimentos: ENTRADA, SAÍDA_OS, RESERVA, LIBERAÇÃO_RESERVA, DEVOLUÇÃO_OS, TRANSFERÊNCIA, AJUSTE, INVENTÁRIO, DEVOLUÇÃO_FORNECEDOR. Todo movimento grava quantidade, custo unitário no momento, saldo resultante, origem (OS, recebimento, inventário), usuário e motivo. O saldo é consequência dos movimentos e nunca é editado diretamente.
- **Regras padrão** **[B7]**:
  - reserva na aprovação do item;
  - baixa na requisição/entrega ao técnico;
  - devolução estorna ao custo da baixa;
  - estoque negativo bloqueado, com liberação por permissão.
- **Custo médio ponderado móvel** por local. O item da OS grava o custo da baixa, que é o usado na margem.
- Peça do cliente: item da OS sem movimento de estoque e sem garantia **[B8]**.
- Peça removida: registrada na OS com destino (devolvida ou descartada). Óleo e fluidos com destinação ambiental registrada (CONAMA 362/2005).
- Inventário: geral ou rotativo, com contagem cega, divergências e ajuste aprovado pelo Gestor.

### 6.15 Compras e fornecedores
- Fluxo: SOLICITAÇÃO (manual, ponto de pedido ou falta de peça numa OS) → COTAÇÃO (N fornecedores, preço, prazo, frete, condição, disponibilidade) → escolha com justificativa → APROVAÇÃO (alçada por valor) → PEDIDO → RECEBIMENTO (parcial ou total, conferência, **importação do XML da NF-e do fornecedor**) → estoque + título a pagar gerados automaticamente.
- Compra vinculada a uma OS reserva a peça para aquela OS no recebimento e move a OS de AGUARDANDO_PEÇAS quando tudo chega.
- Peças importadas: prazo, rastreio e custo de importação rateado no custo **[C1]**.
- Fornecedor: CNPJ/CPF, razão social, fantasia, endereços, contatos, WhatsApp, e-mail, especialidades, marcas, condições, prazo médio (calculado), avaliação (preço, prazo, qualidade, devoluções) e histórico.

### 6.16 Fiscal **[A1–A6]**
- Emissão por **provedor homologado via API**, não direto na SEFAZ ou na prefeitura.
- **NFS-e** (padrão nacional e/ou municipal) para serviços; **NF-e/NFC-e** para peças, conforme a decisão A3.
- Motor de regras fiscais parametrizado por regime, NCM/NBS, CFOP e município, **incluindo CBS/IBS** da reforma tributária (fase de transição a partir de 2026).
- O documento fiscal é filho da OS e guarda XML, PDF (DANFE/DANFSE), status (autorizada, rejeitada, cancelada), protocolo e eventos. Cancelamento e carta de correção seguem os prazos legais.
- Entrada: importação do XML da NF-e de compra (chave de acesso ou upload).
- Exportação para a contabilidade (XML em lote + layout do contador).
- **Este módulo exige especificação própria**, validada pela contabilidade, antes da implementação.

### 6.17 Financeiro
- **Receber:** gerado automaticamente no faturamento da OS (à vista, parcelado ou a prazo). Cliente, OS, vencimento, valor, forma, parcelas, status. **Adiantamentos/sinais** com abatimento no faturamento **[C1]**.
- **Pagar:** gerado automaticamente no recebimento de compras, ou lançado manualmente para despesas. Fornecedor, documento, categoria, centro de custo, competência, vencimento, parcelas, aprovação por alçada.
- Formas de pagamento configuráveis (PIX, dinheiro, débito, crédito à vista ou parcelado, boleto, transferência) com **taxas por adquirente, bandeira e parcela** e prazo de liquidação. O recebível previsto fica pelo valor **líquido** e a taxa vira despesa **[C2]**.
- PIX dinâmico e boleto via API bancária com baixa automática (Fase 4) **[C3]**. Conciliação bancária por OFX e, depois, Open Finance.
- Caixa diário por unidade: abertura, sangria, suprimento, fechamento cego e diferença justificada.
- Plano de contas e centros de custo **importados da contabilidade** **[C5]**. Regime de competência e de caixa, previsto × realizado, fluxo de caixa, inadimplência, DRE gerencial.
- **Comissões** por regra (perfil, tipo de item, base, gatilho) calculadas no recebimento, com extrato por colaborador **[C4]**.
- Estorno: cancelar faturamento gera os movimentos inversos (financeiro, estoque, fiscal), nunca uma exclusão.

### 6.18 Controle de qualidade
Checklist final configurável: serviços executados conferidos item a item, torque quando aplicável (valor registrado), vazamentos, níveis, painel sem alertas, varredura de códigos de falha, teste funcional, test drive (se autorizado: km e horário de saída e retorno, condutor), limpeza, peças removidas conforme a escolha do cliente, documentação. Responsável diferente do executor **[B16]**. Reprovação volta a OS para EM_EXECUÇÃO com as pendências listadas; cada tentativa fica registrada.

### 6.19 Check-out
Data/hora, quem retirou (titular ou terceiro autorizado **[D3]**), km, combustível/SoC, estado final (fotos comparáveis às do check-in, lado a lado), serviços e peças executados, peças devolvidas, recomendações futuras (que viram oportunidades), situação do pagamento, responsável pela entrega e assinatura. Bloqueado sem pagamento quitado, salvo liberação do Gestor com motivo **[C6]**. Gera o documento final selado.

### 6.20 Garantias e retornos
- Garantia por item de serviço e por peça: início, término, km inicial, limite de km, origem (própria, fornecedor, montadora), condições. O prazo mínimo segue o CDC (art. 26) **[B15]**.
- Retorno = nova OS vinculada à original, classificada como RETORNO NORMAL, GARANTIA, RETRABALHO ou NOVA OCORRÊNCIA. A classificação final é feita pelo Gestor após o diagnóstico.
- Garantia de fornecedor gera o fluxo de devolução/crédito da peça.
- Retrabalho é imputado ao técnico e ao item originais para os indicadores.

### 6.21 Comunicações e automações
- Canais: **WhatsApp Business Platform (Cloud API oficial)**, e-mail transacional, SMS e push (PWA). APIs não oficiais de WhatsApp são proibidas.
- Templates versionados com variáveis; os de WhatsApp precisam de aprovação da Meta. Opt-in e opt-out registrados por canal.
- Eventos: agendamento, lembrete, veículo recebido, diagnóstico pronto, orçamento enviado, aprovação registrada, alteração relevante (prazo, orçamento complementar), serviço concluído, veículo pronto, cobrança, pós-venda.
- **Engine de regras** (gatilho + condição + ação + atraso), com execução idempotente e log. Regras iniciais:
  - orçamento sem resposta em 24 h → lembrar o cliente;
  - estoque abaixo do mínimo → alerta ao comprador;
  - revisão prevista em 30 dias ou por km estimado → oportunidade no CRM;
  - calibração de ferramenta em 15 dias → alerta ao gestor;
  - OS passou da previsão → alerta ao consultor e ao gestor;
  - veículo pronto → notificar o cliente;
  - 3 dias após a entrega → NPS **[D4]**.
- Integrações **não podem ser simuladas como prontas**. Enquanto não houver credencial, o canal fica "não configurado" e as mensagens ficam em fila visível.

### 6.22 Pós-venda
NPS e pesquisa de satisfação; lembretes de revisão, óleo, pneus, freios e inspeções (por data e por km médio estimado); acompanhamento de serviços recomendados e não aprovados; guarda de pneus (localização, fotos, aviso de sazonalidade) **[B12]**.

### 6.23 Relatórios e BI
Comercial, oficina, estoque, compras e financeiro, com os indicadores da seção 9. Exportação em CSV, XLSX e PDF. Relatórios pesados rodam de forma assíncrona e o arquivo fica disponível para download. Toda exportação é auditada.

### 6.24 Pesquisa global
Uma barra só (atalho `/` ou `Ctrl+K`) que busca cliente, CPF, CNPJ, telefone, placa (com ou sem hífen, formato antigo ou Mercosul), chassi (parcial), nº de OS/orçamento/pedido, peça, SKU, código OEM e fornecedor. Resultados respeitam RBAC. Implementação com `pg_trgm` + índices, sem motor externo no MVP.

### 6.25 Documentos (PDF)
Orçamento (por versão), OS, check-in, checklist/inspeção, autorização/aprovação, pedido de compra, recibo, check-out, histórico do veículo e termo de peça do cliente. Documentos selados (seção 8.3) são imutáveis; os demais são regenerados sob demanda a partir de dados congelados.

### 6.26 Administração
Usuários, perfis, permissões, unidades, parâmetros (limites de desconto, regras de estoque, numeração, políticas de cancelamento), templates de checklist e de mensagens, catálogo de serviços e tabelas de preço, importações e visualizador de auditoria.

---

## 7. Menu principal
DASHBOARD · AGENDA · OFICINA (Kanban, Ordens de Serviço, Inspeções, Orçamentos, Controle de Qualidade, Boxes) · CLIENTES · VEÍCULOS · ESTOQUE · COMPRAS · FORNECEDORES · FERRAMENTAS · FISCAL · FINANCEIRO · CRM (Oportunidades, Pós-venda, NPS, Comunicações) · RELATÓRIOS · ADMINISTRAÇÃO

O técnico vê um menu reduzido: Minhas OS · Apontamento · Ferramentas.

---

## 8. Regras transversais

### 8.1 Numeração
Sequências por unidade e tipo, configuráveis (prefixo, tamanho, reinício anual opcional): OS-000001, ORC-000001, PED-000001, REC-000001, CHK-000001. Geradas dentro da transação (tabela `NumberSequence` com lock de linha), sem duplicidade. Lacunas por rollback são aceitas e registradas. Números fiscais vêm do provedor fiscal.

### 8.2 Imutabilidade e versionamento
- Imutáveis depois de criados: versões de orçamento enviadas, aprovações, check-in e check-out assinados, histórico de status, movimentos de estoque, pagamentos baixados, documentos fiscais autorizados e log de auditoria.
- Correção se faz por adendo, estorno ou nova versão, **nunca por UPDATE ou DELETE**. Isso é garantido também no banco: triggers que bloqueiam UPDATE/DELETE nessas tabelas e um papel de aplicação sem permissão de DELETE.
- Exclusão física só em cadastros auxiliares sem movimento. Soft delete (`deleted_at`) em cadastros com histórico.

### 8.3 Assinatura eletrônica
Assinatura eletrônica (Lei 14.063/2020), sem certificado ICP-Brasil. Pacote de evidências gravado: imagem da assinatura, nome e documento do signatário, relação com o cliente (titular/terceiro), data/hora do servidor, IP, user-agent, geolocalização (se consentida), método de autenticação (presencial, OTP), **hash SHA-256 do PDF final**. O PDF selado é gravado em bucket com **Object Lock (WORM)**.

### 8.4 Auditoria
Tabela append-only (idealmente em schema separado com permissão só de INSERT): usuário, perfil, data/hora, IP, user-agent, módulo, entidade, id, operação, valor anterior, valor novo (diff JSON) e correlation-id. Cobertura obrigatória: preços, descontos, custos, estoque, pagamentos, cancelamentos, estornos, aprovações, exclusões/inativações, permissões, login/logout/MFA e exportações. Hash encadeado opcional para evidência de integridade.

### 8.5 Eventos de domínio
Toda operação com reflexo (ex.: `ItemAprovado`, `PecaRequisitada`, `OSFaturada`, `PagamentoRecebido`) grava um evento na **outbox** na mesma transação. Um worker processa as automações, notificações e integrações com idempotência e retry. Isso também alimenta as timelines.

---

## 9. KPIs — definições únicas

| KPI | Fórmula |
|---|---|
| Faturamento | Soma dos valores líquidos de desconto das OS faturadas no período (sem estornos), separado em serviços e peças |
| Ticket médio | Faturamento ÷ nº de OS faturadas |
| Margem bruta (R$) | Faturamento − (custo das peças baixadas + custo/hora × horas trabalhadas + terceiros) |
| Margem por OS (%) | Margem bruta da OS ÷ faturamento da OS |
| Horas vendidas | Soma das horas cobradas nos itens de serviço faturados |
| Horas trabalhadas | Soma dos apontamentos finalizados |
| Eficiência | Horas vendidas ÷ horas trabalhadas |
| Produtividade | Horas trabalhadas ÷ horas disponíveis |
| Ocupação dos boxes | Horas ocupadas ÷ horas disponíveis do box |
| Taxa de aprovação | Valor aprovado ÷ valor orçado (e também em nº de itens) |
| Prazo médio de aprovação | Média de (primeira decisão − envio da versão) |
| Lead time da OS | Check-out − check-in (mediana e p90) |
| Cumprimento de prazo | OS entregues até a previsão ÷ OS entregues |
| Giro de estoque | Custo das saídas no período ÷ estoque médio valorizado |
| Retorno / Retrabalho | OS de retorno (ou retrabalho) em até 90 dias ÷ OS entregues |
| NPS | % promotores (9–10) − % detratores (0–6) |
| Recorrência | Clientes com ≥ 2 OS em 12 meses ÷ clientes atendidos em 12 meses |
| Inadimplência | Valor vencido há mais de 30 dias ÷ total a receber |

Todos os relatórios e dashboards usam **as mesmas views/funções** do banco. Fórmula duplicada no front-end é proibida.

---

## 10. Modelo de dados (entidades mínimas)

**Organização e acesso:** Company, Branch, User, Role, Permission, RolePermission, UserRole, Session, MfaFactor, NumberSequence, Parameter
**Clientes:** Customer, CustomerAddress, CustomerContact, Consent, Opportunity
**Veículos:** VehicleMake, VehicleModel, Vehicle, VehicleOwnership, VehicleComponent, OdometerReading, VehiclePhoto
**Agenda:** Appointment, AppointmentService, DeliveryTrip (leva-e-traz)
**OS:** WorkOrder, WorkOrderStatusHistory, CheckIn, DamageMark, Inspection, InspectionItem, ChecklistTemplate, ChecklistTemplateItem, Diagnostic, DiagnosticCode, Estimate, EstimateVersion, EstimateItem, Approval, WorkOrderService, WorkOrderPart, WorkOrderThirdParty, RemovedPart, TestDrive, TimeEntry, QualityControl, QualityControlItem, CheckOut, Signature, Warranty, ReturnLink
**Catálogo e preço:** ServiceCatalog (operação + tempo padrão), LaborRate, PriceList
**Oficina:** Technician, TechnicianSkill, Certification, WorkshopBay, Tool, ToolMovement, ToolCalibration
**Estoque:** InventoryItem, ItemEquivalence, StockLocation, StockBalance (derivado/materializado), StockLot, InventoryMovement, Reservation, InventoryCount, InventoryCountLine, TireStorage
**Compras:** Supplier, SupplierContact, PurchaseRequest, Quotation, QuotationItem, PurchaseOrder, PurchaseOrderItem, GoodsReceipt, GoodsReceiptItem
**Fiscal:** FiscalDocument, FiscalDocumentItem, FiscalEvent, TaxRule
**Financeiro:** AccountReceivable, AccountPayable, Installment, Payment, PaymentMethod, CardFee, Deposit, CashAccount, CashSession, BankTransaction, Reconciliation, FinancialCategory (plano de contas), CostCenter, CommissionRule, Commission
**Comunicação e CRM:** MessageTemplate, Notification, AutomationRule, AutomationRun, Survey, SurveyResponse
**Transversal:** Attachment (storage key, hash, mime, tamanho, thumbnail, entidade polimórfica), DocumentVersion, AuditLog, OutboxEvent, ImportJob, ImportRow

Padrões:
- PK UUID v7, com número de negócio separado;
- FKs explícitas; `created_at`, `updated_at`, `created_by`, `updated_by`;
- `company_id`/`branch_id`; índices em todas as FKs e chaves de busca;
- constraints de CHECK para status e valores ≥ 0;
- unicidade parcial (ex.: CPF único por empresa entre ativos);
- **Row-Level Security** no PostgreSQL para `company_id` como segunda camada;
- o ERD completo (Mermaid ou dbdiagram) é entregável da Fase 1, com o dicionário de dados em `DATABASE.md`.

---

## 11. Arquitetura

- **Monólito modular em TypeScript**:
  - **Next.js** (App Router) para a interface do back-office e do portal (PWA);
  - **NestJS** para a API REST (módulos por domínio, OpenAPI gerado);
  - **PostgreSQL 16+**, **Prisma** (com SQL puro onde precisar de views, triggers e RLS);
  - worker (BullMQ/Redis ou pg-boss) para outbox, automações, PDFs e importações;
  - **armazenamento S3-compatível** com Object Lock para documentos selados.
- Alternativa aceitável, se justificada em ADR: API dentro do próprio Next.js (route handlers) com camada de domínio isolada. Vale para reduzir a complexidade operacional no MVP.
- Monorepo (pnpm + Turborepo): `apps/web`, `apps/api`, `apps/worker`, `packages/domain`, `packages/db`, `packages/ui`, `packages/config`.
- UI: Tailwind CSS + shadcn/ui (Radix), com design system próprio (tokens de cor/tipografia, modo claro/escuro), sem copiar marcas, logos ou interfaces de montadoras.
- Hospedagem **com dados no Brasil** **[E3]**: banco e arquivos em região BR. Front e API no mesmo domínio-pai (ex.: `app.onesportcar.com.br` e `api.onesportcar.com.br`), com cookies `HttpOnly; Secure; SameSite=Lax`.
- Ambientes: dev, homologação (com dados sintéticos) e produção, separados. Segredos em cofre (nunca no repositório). CI com lint, typecheck, testes, migrations e scan de dependências.
- Observabilidade: logs estruturados com correlation-id, métricas, tracing (OpenTelemetry), rastreio de erros (ex.: Sentry) e alertas.

## 12. API
REST com versionamento (`/v1`); autenticação por sessão/cookie para a web e tokens para integrações; autorização por permissão em todo endpoint; validação com schema (Zod/class-validator); paginação por cursor; filtros e ordenação padronizados; erros no formato **RFC 9457** (problem+json) com mensagens em pt-BR; `Idempotency-Key` em POSTs com efeito financeiro, de estoque ou fiscal; rate limiting; documentação OpenAPI publicada.

## 13. Segurança (OWASP ASVS nível 2 como referência)
- Senhas com Argon2id;
- MFA TOTP, obrigatório para Administrador, Gestor, Financeiro e Auditor **[E5]**;
- bloqueio progressivo e rate limit contra força bruta;
- sessões com expiração e revogação; CSRF em mutações com cookie; CSP e headers de segurança; sanitização de saída;
- queries parametrizadas;
- uploads com validação de tipo real, limite de tamanho e remoção de EXIF de localização quando não necessário;
- URLs de arquivo assinadas com expiração curta;
- least privilege no banco;
- scan de dependências e segredos na CI;
- pentest antes da produção.

## 14. LGPD
- Encarregado nomeado **[E1]**; registro das operações de tratamento (ROPA); base legal por finalidade (execução de contrato para OS, obrigação legal para fiscal, legítimo interesse ou consentimento para marketing/pós-venda); consentimento granular por canal para comunicações de marketing.
- Minimização: o técnico não vê CPF, telefone nem dados financeiros do cliente.
- Tabela de retenção por tipo de dado **[E2]**.
- Direitos do titular: consulta, exportação (JSON/PDF), correção e **anonimização** do que não está sujeito a obrigação legal. Registros fiscais, financeiros e operacionais obrigatórios são mantidos com acesso restrito.
- Fotos de check-in podem conter objetos pessoais e terceiros: acesso restrito e retenção definida.
- Política de privacidade e termos no portal; registro de aceite.
- RIPD/DPIA recomendado para o portal e as fotos.

## 15. Backup e continuidade
- PITR contínuo (RPO ≤ 15 min) + snapshot diário com retenção de 30 dias diários, 12 mensais e 5 anuais;
- versionamento e replicação do bucket de arquivos;
- **restore testado mensalmente** em ambiente isolado, com registro;
- RTO ≤ 4 h com runbook documentado em `BACKUP-RESTORE.md`.

## 16. Migração do SYSCAR
1. **Descoberta** (Fase 0): o que o SYSCAR exporta, como e com qual qualidade; amostras anonimizadas **[F1]**.
2. **Importação de cadastros cedo** (junto com o MVP): clientes, veículos, fornecedores, peças.
3. **Pipeline de importação** (CSV/XLSX): upload → mapeamento de colunas → validação → prévia com **VÁLIDOS / DUPLICADOS / INVÁLIDOS / ERROS** por linha e motivo → confirmação → importação em lote auditada → relatório. Nada é importado silenciosamente; importações podem ser revertidas por lote.
4. **Histórico de OS** como registros somente leitura (tipo "HISTÓRICO SYSCAR"), sem reflexo em estoque ou financeiro **[F2]**.
5. **Virada** **[F3]**: data de corte; saldo inicial de estoque por local, com custo; títulos em aberto a pagar e a receber; saldo de caixa e bancos; OS em andamento (encerrar no SYSCAR e abrir no novo, ou migrar como abertas, a decidir); período em paralelo; **conferência de totais** (estoque valorizado, total a receber e a pagar) com assinatura da gestão; plano de rollback.
6. Documentar tudo em `MIGRATION-SYSCAR.md`.

## 17. Preparação para IA
- O assistente responde perguntas em linguagem natural usando **ferramentas/endpoints da própria API**, que já aplicam RBAC e RLS com a identidade do usuário. **Nunca SQL livre gerado pelo modelo sobre o banco.**
- Camada semântica: views de KPIs (seção 9) e funções de consulta nomeadas (ex.: `veiculos_atrasados`, `estoque_abaixo_minimo`, `ultima_manutencao(veiculo)`, `revisoes_previstas(dias)`).
- Toda consulta do assistente é auditada. O assistente não executa ações de escrita sem confirmação explícita do usuário.

## 18. Qualidade e testes
- Unitários no domínio (regras de estado, preço, estoque, comissão, impostos); integração da API com banco real (Testcontainers); E2E (Playwright) nos fluxos críticos em desktop e tablet; testes de permissão (matriz perfil × endpoint gerada automaticamente); testes de segurança (DAST básico na CI); testes de responsividade e de acessibilidade (axe).
- **Fluxo crítico obrigatório (E2E):** AGENDAMENTO → CHECK-IN → INSPEÇÃO → DIAGNÓSTICO → ORÇAMENTO → APROVAÇÃO PARCIAL → OS → RESERVA/BAIXA DE ESTOQUE → EXECUÇÃO COM APONTAMENTO → ORÇAMENTO COMPLEMENTAR → CQ (reprovar uma vez, depois aprovar) → FATURAMENTO → PAGAMENTO → CHECK-OUT. Ao final, o teste verifica **todas as respostas da seção 24**.
- **Dados de demonstração** só em dev/homologação: sintéticos, gerados (CPF/CNPJ válidos porém fictícios, nomes gerados), veículos premium fictícios, técnicos, peças, fornecedores, OS em todos os status. Um script bloqueia o seed em produção.

## 19. Definition of Done (por funcionalidade)
Uma funcionalidade só está pronta quando tem:
- UI funcionando em desktop e tablet;
- API documentada;
- persistência real com migration;
- permissões testadas;
- validações no front e no back;
- auditoria registrada;
- testes automatizados passando na CI;
- documentação atualizada;
- nenhum TODO crítico;
- **nenhuma integração simulada apresentada como real**;
- demonstrada ao responsável da OneSportcar.

## 20. Documentação mantida
README, ARCHITECTURE, DATABASE (ERD + dicionário), API (link para o OpenAPI + convenções), SECURITY, LGPD, DEPLOYMENT, BACKUP-RESTORE, MIGRATION-SYSCAR, `docs/adr/` (uma decisão por arquivo), `docs/funcional/` (manual por perfil) e `AGENTS.md`/`CLAUDE.md` com as convenções do repositório para agentes.

---

## 21. Fases

| Fase | Conteúdo | Saída |
|---|---|---|
| 0 — Descoberta | Hipóteses de processo, questionário, análise das exportações do SYSCAR, respostas a `DECISOES-PENDENTES.md` | Mapa de processos AS-IS/TO-BE validado |
| 1 — Arquitetura | Arquitetura, ERD, matriz RBAC, máquina de estados da OS, design system, mapa de telas, backlog e sprints | **Aprovação formal antes de qualquer código de produto** |
| 2 — MVP operacional | Auth, usuários/perfis, unidades, clientes, veículos, catálogo de serviços, agenda, check-in, inspeção, diagnóstico, orçamento + versões, aprovação (presencial + link), OS, Kanban, apontamento, CQ, check-out, **importação de cadastros do SYSCAR**, auditoria, PDFs | MVP em homologação |
| 3 — Supply chain | Estoque completo, compras, fornecedores, ferramentas, XML de NF-e de entrada | — |
| 4 — Fiscal e financeiro | Emissão NFS-e/NF-e, receber/pagar, caixa, formas e taxas, PIX/boleto, conciliação, comissões, DRE, fluxo de caixa | — |
| 5 — Experiência do cliente | Portal com conta, PWA/push, WhatsApp oficial, automações, pós-venda, NPS | — |
| 6 — BI | Dashboards, KPIs, relatórios, exportações, base para o assistente de IA | — |
| 7 — Virada | Saldos iniciais, OS abertas, paralelo, conferência, desligamento do SYSCAR | Go-live |

> **Atenção ao MVP:** sem estoque (Fase 3) e sem fiscal/financeiro (Fase 4), o MVP roda em paralelo ao SYSCAR, que continua emitindo notas e controlando o estoque. Essa convivência deve ser acordada com a direção. Como alternativa, antecipe para a Fase 2 um estoque mínimo (saldo + baixa por OS) e o registro de pagamento sem emissão fiscal.

### Critérios objetivos de MVP pronto
1. O fluxo crítico da seção 18 roda de ponta a ponta em homologação por um consultor e um técnico reais, em tablet, sem ajuda do desenvolvedor.
2. As perguntas da seção 24 são respondidas pela tela da OS (exceto as de fiscal e financeiro, que ficam para a Fase 4).
3. A matriz de permissões tem 100% dos endpoints cobertos por teste.
4. O restore de backup foi testado e documentado.
5. Os cadastros do SYSCAR foram importados com o relatório de validação aceito pela gestão.
6. Não há bug crítico ou alto aberto; as metas de p95 foram atingidas com a base importada.

---

## 22. Riscos principais

| Risco | Mitigação |
|---|---|
| Complexidade fiscal (município, reforma tributária) | Provedor homologado, spec fiscal própria, validação da contabilidade |
| Qualidade e acesso aos dados do SYSCAR | Descoberta na Fase 0; importação cedo; pipeline de validação |
| Adoção pelos técnicos (resistência ao tablet) | UX de poucos toques, piloto com 1–2 técnicos, modo offline |
| Escopo excessivo (ERP completo) | Fases com aprovação; MVP estrito; backlog priorizado |
| Wi-Fi fraco na oficina | PWA offline + upload retomável |
| Custo do WhatsApp e reprovação de templates | Templates enxutos; e-mail como fallback |
| Dependência de um único desenvolvedor/agente | Documentação, ADRs, testes e CI obrigatórios |
| Integrações simuladas se passando por prontas | Regra explícita do DoD + status "não configurado" visível |

---

## 23. Identidade visual
Transmite sofisticação, tecnologia, confiança, precisão, performance e exclusividade. Tom escuro opcional (modo escuro de primeira classe), tipografia técnica, uso contido de cor de destaque, fotografia do próprio veículo como elemento principal dos cards. **Nunca** usar logotipos, fontes proprietárias, grafismos ou interfaces de montadoras ou de terceiros.

---

## 24. Teste de rastreabilidade (aceite central)
Para qualquer OS, a tela da OS (e a API) deve responder, com o registro de origem:

QUEM trouxe o veículo? · QUANDO chegou? · COMO chegou? · QUAL a quilometragem e o combustível/carga? · QUAL a condição visual (mapa de avarias + fotos)? · QUAL problema foi relatado (texto original)? · QUEM diagnosticou e QUAL foi o diagnóstico? · QUAIS orçamentos e versões foram enviados? · QUAIS itens foram aprovados ou recusados, POR QUEM, QUANDO e POR QUAL canal/evidência? · QUEM executou cada serviço e QUANTO tempo gastou? · QUAIS peças foram usadas, DE QUAL local de estoque e lote, A QUAL custo, DE QUAL fornecedor e compra? · O QUE foi feito com as peças removidas? · QUAL o resultado de cada tentativa de CQ e QUEM fez? · QUANTO foi cobrado, com QUAIS descontos e QUEM os autorizou? · QUAL a margem? · QUAIS documentos fiscais foram emitidos? · COMO e QUANDO foi pago, e QUAL o valor líquido recebido? · QUANDO saiu, EM QUAL condição e QUEM retirou? · QUEM autorizou a entrega?
