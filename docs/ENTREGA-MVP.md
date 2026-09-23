# Entrega do MVP — OneSportcar

Data: 23/09/2026 · Ambiente: **demonstração** · URL: https://onesportcar.vercel.app
Hospedagem: Vercel (time Govertech, região `gru1` São Paulo) · Banco: Neon Postgres (`gru1`, plano Free)

## 1. O que está funcionando (com persistência real, permissões e auditoria)

| Módulo | Entregue |
|---|---|
| Acesso | Login com sessão em cookie HttpOnly (hash do token no banco), expiração de 12 h, bloqueio de 15 min após 5 tentativas, logout, 9 perfis (RBAC) com matriz visível em Administração |
| Dashboard | Agendados hoje, veículos na oficina, OS atrasadas, prontos para entrega, recebido dia/mês, faturado no mês, ticket médio, funil por status, aguardando aprovação, estoque crítico. Valores só para perfis autorizados |
| Clientes | PF/PJ, validação de CPF e **CNPJ alfanumérico**, CEP via ViaCEP, bloqueio de CPF/CNPJ duplicado e alerta de telefone/e-mail repetido, consentimento LGPD com data, histórico de atendimentos. Técnico não vê documentos nem contatos |
| Veículos | Placa antiga/Mercosul normalizada, VIN, RENAVAM, propulsão (inclui híbrido/elétrico), histórico de km (regressão exige justificativa), histórico de proprietários com transferência, timeline de manutenção |
| Agenda | Visões dia/semana, filtros por técnico e box, bloqueio de conflito de box/técnico, reagendamento auditado, confirmação, no-show, cancelamento com motivo, leva-e-traz, check-in a partir do agendamento |
| Check-in | Abre a OS; km, combustível ou **SoC**, luzes do painel, chaves, objetos, estado por item, **mapa de avarias** no desenho do carro, **assinatura eletrônica** na tela; ao assinar, grava hash SHA-256, IP e navegador e fica somente leitura |
| Inspeção e diagnóstico | Checklists (geral e alta tensão) com status OK/Atenção/Recomendado/Urgente/N/A, medição e nota; diagnóstico com testes, códigos de falha, sessão da ferramenta, causa e solução |
| Orçamento | Itens do catálogo de serviços (tabela de tempos × valor/hora), do estoque ou avulsos; classificação obrigatório/recomendado/preventivo/opcional; **limite de desconto por perfil** (consultor 5%, gestor 15%); custo e margem só para perfis autorizados; **versões imutáveis** (bloqueadas no banco) com hash; orçamento **complementar** durante a execução |
| Aprovação | **Link público sem login** (token de uso único, 7 dias, revogável) com aprovação item a item, nome, aceite e destino das peças removidas; registro de IP/navegador. Registro interno presencial/telefone/WhatsApp/e-mail com evidência obrigatória. Aprovações são append-only |
| OS e Kanban | Máquina de estados com 14 status e pré-condições validadas no servidor; Kanban com arrastar-e-soltar e menu "Mover para…" (tablet); histórico de status imutável; cancelamento com motivo e regras; impressão da OS (PDF pelo navegador) |
| Execução | Apontamento iniciar/pausar/aguardando peça/finalizar, um apontamento aberto por técnico, tempo vendido × trabalhado |
| Estoque | Itens com OEM/local/mín/máx, **custo médio ponderado móvel**, reserva na aprovação, "aguardando compra" quando falta, reserva automática quando a entrada chega, baixa ao custo do momento, devolução, ajuste com motivo, **estoque negativo bloqueado**, movimentos imutáveis |
| Qualidade | Checklist de CQ, teste de rodagem com autorização, **segregação** (quem executou não faz o CQ), reprovação reabre serviços escolhidos |
| Pagamento e entrega | Registro de pagamentos (PIX, cartão, dinheiro etc.) com estorno; check-out com km, combustível, recomendações, assinatura e hash; **entrega bloqueada com saldo em aberto**, salvo liberação do gestor com motivo |
| Rastreabilidade | Painel na OS responde às perguntas da spec §24 (quem trouxe, km, avarias, diagnóstico, versões, quem aprovou, quem executou, tempo, peças, CQ, valores, margem, quem retirou) |
| Auditoria | Log append-only (UPDATE/DELETE bloqueados por trigger) de login, cadastros, preços, descontos, estoque, aprovações, status, pagamentos e permissões, com visualizador e filtros |
| Busca global | Placa (com ou sem hífen), cliente, CPF/CNPJ, telefone, nº de OS/orçamento, SKU/OEM, respeitando o perfil |
| Segurança | CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy; server actions com proteção de origem; senhas bcrypt (custo 12); `noindex` |

**Testes automatizados:** 9 testes (validadores, RBAC e o fluxo crítico completo de ponta a ponta com banco real, incluindo aprovação parcial, falta de peça, orçamento complementar, reprovação de CQ, imutabilidade, estoque negativo e numeração concorrente). Todos passando.

## 2. Desvios em relação à especificação (decisões tomadas para o MVP)

| Spec | No MVP | Motivo |
|---|---|---|
| NestJS + API REST com OpenAPI | Next.js full-stack com Server Actions | Um deploy só na Vercel; as regras estão isoladas em `src/lib`, prontas para ganhar uma API REST depois |
| Pré-OS criada no agendamento | O agendamento aparece na coluna "Agendado" do Kanban e vira OS no check-in | Evita OS vazias de no-shows (decisão B3) |
| `company_id` em todas as tabelas + RLS | Empresa/unidade modeladas; OS, agenda e usuários têm unidade | Operação com uma unidade; multiempresa completa fica para depois |
| Perfis customizáveis | 9 perfis fixos em código | A matriz já está visível e testável |
| MFA | Não implementado | Próxima entrega de segurança (obrigatório para admin/gestor/financeiro) |
| OTP na aprovação por link | Token forte + aceite + IP | Depende do canal de SMS/WhatsApp (D1/D2) |

## 3. Ainda não implementado (não simulado)

- **Fotos e vídeos** no check-in/checklist: precisa de storage (Vercel Blob ou S3 em região BR). Hoje há o aviso "não configurado" na tela.
- **Fiscal** (NFS-e/NF-e, CBS/IBS): Fase 4, depende das decisões A1–A6 da contabilidade.
- **Financeiro completo** (contas a pagar/receber, caixa, conciliação, DRE, comissões, taxas de cartão).
- **Compras e fornecedores**, **ferramentas**, **garantias/retornos** (o modelo já tem campos para OS de retorno).
- **WhatsApp/e-mail/SMS e automações**: as telas avisam "canal não configurado"; nada é enviado.
- **Portal do cliente com conta/PWA**, NPS e pós-venda.
- **Relatórios/BI** com exportação CSV/XLSX/PDF.
- **Importação do SYSCAR**.
- **Modo offline** e upload retomável.

## 4. Pontos de atenção para uso real

1. **Plano Hobby da Vercel é só para uso não comercial.** Para uso da OneSportcar em produção, o time Govertech precisa migrar para o plano **Pro**.
2. **Neon Free** tem limites de armazenamento e computação, e o banco entra em pausa quando ocioso (o primeiro acesso fica mais lento). Para produção, avaliar o plano Launch e ativar backups/PITR conforme a spec §15.
3. O ambiente atual é de **demonstração**, com dados fictícios. Antes do uso real, criar um projeto/banco de produção separado e inicializá-lo com `npm run db:create-admin`.
4. Trocar a senha dos usuários demo, ou desativá-los, se o link for compartilhado fora da equipe.
5. O código ainda não está em um repositório Git. Recomendo versionar no GitHub e conectar à Vercel para ter deploy automático e histórico.
