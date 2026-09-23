# OneSportcar — Workshop Management Platform (MVP)

Sistema de gestão da oficina OneSportcar (DBL Automotiva). A especificação completa fica em [`docs/ESPECIFICACAO-MESTRE-v2.md`](docs/ESPECIFICACAO-MESTRE-v2.md). Para ver o que já foi entregue e o que falta, consulte [`docs/ENTREGA-MVP.md`](docs/ENTREGA-MVP.md).

## Stack
- **Next.js 15** (App Router, Server Actions) + TypeScript + Tailwind CSS 4
- **PostgreSQL 16** + **Prisma 6**
- Monólito modular: as regras de negócio ficam em `src/lib` e as telas em `src/app`
- Deploy: Vercel (região `gru1`, São Paulo) + Neon Postgres (`aws-sa-east-1`)

## Estrutura
```
prisma/
  schema.prisma          modelo de dados (valores em centavos, tempos em minutos)
  migrations/            inclui triggers de imutabilidade (auditoria, histórico, aprovações, versões, estoque)
  seed.ts                dados FICTÍCIOS de demonstração (percorre o fluxo real via regras de domínio)
  create-admin.ts        inicializa produção vazia com 1 administrador
src/lib/
  workflow.ts            máquina de estados da OS + pré-condições (validadas no servidor)
  estimate.ts            orçamento: snapshot imutável, versões, link de aprovação, decisões, materialização na OS
  inventory.ts           estoque: custo médio ponderado, reserva, baixa, devolução, bloqueio de negativo
  wo.ts                  apontamento de horas e totais/margem da OS
  auth.ts / rbac.ts      sessão (cookie HttpOnly, hash no banco), bloqueio por tentativas, permissões por perfil
  audit.ts               log de auditoria append-only
  validators.ts          CPF, CNPJ alfanumérico, placa antiga/Mercosul, VIN, RENAVAM
src/app/(app)/           telas autenticadas
src/app/aprovar/[token]  aprovação pública do orçamento pelo cliente
tests/                   testes de integração do fluxo crítico (banco real)
```

## Rodar localmente
```bash
cp .env.example .env            # apontar para um Postgres local
npm install
npx prisma migrate deploy
SEED_PASSWORD='SuaSenhaDemo123' npm run db:seed-demo
npm run dev
```
Os usuários de demonstração são `admin@`, `gestor@`, `consultor@`, `tecnico@`, `tecnico2@`, `estoque@`, `financeiro@` e `auditor@onesportcar.demo`. A senha é a definida em `SEED_PASSWORD`.

## Testes
```bash
createdb onesportcar_test
DATABASE_URL=postgresql://localhost/onesportcar_test DATABASE_URL_UNPOOLED=postgresql://localhost/onesportcar_test npx prisma migrate deploy
npm test
```

## Deploy (Vercel)
1. Criar o projeto na Vercel e conectar um banco Neon (Storage → Neon, região São Paulo). A integração cria `DATABASE_URL` e `DATABASE_URL_UNPOOLED` (usada pelas migrations).
2. `vercel deploy --prod`. O build roda `prisma migrate deploy` automaticamente.
3. Inicializar os dados uma única vez, a partir da máquina local, com a URL do banco de produção:
   - demonstração: `SEED_PASSWORD=... NODE_ENV=production ALLOW_DEMO_SEED=1 npm run db:seed-demo`
   - produção vazia: `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run db:create-admin`
