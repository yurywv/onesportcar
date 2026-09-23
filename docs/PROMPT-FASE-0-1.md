# Prompt para o agente — OneSportcar, Fases 0 e 1

> Entregue este texto ao agente de desenvolvimento. Antes, copie para o repositório os arquivos `ESPECIFICACAO-MESTRE-v2.md` e `DECISOES-PENDENTES.md` (já respondido, se possível) em `docs/`.

---

Você vai planejar a **OneSportcar Workshop Management Platform**, sistema de gestão da oficina de veículos premium da DBL Automotiva Ltda., que substituirá o SYSCAR.

## Contexto obrigatório
- `docs/ESPECIFICACAO-MESTRE-v2.md` é a especificação do produto. Leia inteira antes de começar. Ela prevalece sobre qualquer suposição sua.
- `docs/DECISOES-PENDENTES.md` lista as decisões do negócio. Para as que estiverem sem resposta, use a **recomendação padrão** e registre um ADR marcado como "provisório — aguardando confirmação".
- Idioma dos documentos e da interface: português do Brasil. Código, nomes de tabelas e identificadores em inglês.

## Escopo desta tarefa: SOMENTE Fases 0 e 1
**Não escreva código de produto.** Não crie telas, APIs nem migrations. O único código permitido é o do diagrama (Mermaid/DBML) e o esqueleto do repositório descrito no item 12.

## Entregáveis (em `docs/`, um arquivo por item quando fizer sentido)

**Fase 0 — Descoberta** (você não tem acesso à oficina: produza hipóteses e perguntas, não "fatos")
1. `fase0/processos-to-be.md`: mapa do processo alvo, do agendamento ao pós-venda, com raias por perfil. Marque cada passo como **[HIPÓTESE]** até ser validado.
2. `fase0/questionario.md`: roteiro de entrevista para consultor, técnico, estoquista, financeiro e direção, com as perguntas que ainda faltam além das de `DECISOES-PENDENTES.md`.
3. `fase0/syscar.md`: checklist do que precisa ser levantado sobre o SYSCAR (exportações, campos, volumes, qualidade dos dados) e o formato em que as amostras anonimizadas devem ser entregues.

**Fase 1 — Arquitetura**
4. `ARCHITECTURE.md`: resumo executivo, visão de contexto e de containers (C4 níveis 1–2, em Mermaid), módulos e suas fronteiras, fluxo de eventos/outbox, hospedagem com dados no Brasil, ambientes, estimativa de custo mensal de infraestrutura em faixas.
5. `DATABASE.md`: ERD completo (Mermaid `erDiagram` ou DBML) com todas as entidades da seção 10 da especificação; dicionário de dados das tabelas centrais (OS, orçamento/versão/item/aprovação, movimentos de estoque, títulos, auditoria); índices, constraints, tabelas imutáveis e política de RLS.
6. `rbac-matriz.md`: matriz perfil × permissão (`módulo:recurso:ação`) com escopo; regras de segregação de funções.
7. `os-workflow.md`: máquina de estados da OS (diagrama `stateDiagram` + tabela de transições com pré-condições, efeitos em estoque/financeiro/fiscal, eventos emitidos e quem pode disparar), incluindo orçamento complementar, reprovação no CQ, cancelamento e retorno/garantia.
8. `ux/`: princípios do design system (tokens de cor, tipografia, espaçamento, modo claro/escuro), mapa de navegação e **lista de telas por perfil**. Para as 6 telas críticas (Kanban, check-in no tablet, orçamento, aprovação do cliente no celular, apontamento do técnico, tela da OS), faça wireframes em texto/ASCII ou Mermaid.
9. `api-convencoes.md`: padrões de rota, autenticação, erros (RFC 9457), paginação, idempotência e a lista de recursos do MVP.
10. `backlog.md`: épicos → histórias com critério de aceite no formato Dado/Quando/Então, prioridade (MoSCoW), estimativa relativa e dependências. Cubra a Fase 2 em detalhe e as Fases 3–7 em nível de épico.
11. `sprints.md`: plano de sprints de 2 semanas para a Fase 2, com o incremento demonstrável ao fim de cada sprint. A importação de cadastros do SYSCAR entra no MVP.
12. `riscos-e-decisoes.md`: riscos técnicos com mitigação; dependências externas (provedor fiscal, WhatsApp Cloud API, banco/PIX, storage, e-mail/SMS) com o que cada uma exige da DBL (contrato, credencial, custo); lista final de decisões ainda abertas.
13. `adr/`: um ADR por decisão relevante (stack, monólito modular, auth, hospedagem, estratégia de estoque/custo, assinatura eletrônica, fiscal via provedor, etc.).
14. `mvp-criterios.md`: critérios objetivos de "MVP pronto", partindo da seção 21 da especificação, cada um verificável.
15. **Esqueleto do repositório** (apenas estrutura): monorepo com `apps/web`, `apps/api`, `apps/worker`, `packages/*`, README com a estrutura, `AGENTS.md` com as convenções para agentes (padrões de código, commits, testes, DoD) e `docs/`. Nenhuma funcionalidade.

## Regras de trabalho
- Onde a especificação for ambígua ou contraditória, **não invente em silêncio**: aponte em `riscos-e-decisoes.md`, proponha uma recomendação e siga com ela marcada como provisória.
- Se discordar de algo na especificação (ex.: stack, fase de um módulo), argumente em ADR. Não altere a especificação.
- Não cite leis, alíquotas ou regras fiscais como definitivas: marque como "validar com a contabilidade/jurídico".
- Prefira diagramas em texto (Mermaid/DBML) versionáveis.
- Seja específico: nomes reais de tabelas, campos, status e permissões, não descrições genéricas.

## Ponto de parada obrigatório
Ao terminar, **pare** e apresente:
1. um resumo de uma página com os links para cada entregável;
2. as **10 decisões mais importantes** que precisam de aprovação humana;
3. o que você recomenda que a OneSportcar valide primeiro.

**Não inicie a Fase 2** até receber aprovação explícita. A Fase 2 terá um prompt próprio.
