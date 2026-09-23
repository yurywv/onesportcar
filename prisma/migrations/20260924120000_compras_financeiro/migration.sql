-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'ENVIADO', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CAIXA', 'BANCO', 'ADQUIRENTE');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "TitleKind" AS ENUM ('RECEBER', 'PAGAR');

-- CreateEnum
CREATE TYPE "TitleStatus" AS ENUM ('ABERTO', 'PARCIAL', 'PAGO', 'CANCELADO');


-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "supplierId" TEXT;


-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "type" "PersonType" NOT NULL DEFAULT 'PJ',
    "document" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "ie" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "cep" TEXT,
    "street" TEXT,
    "number" TEXT,
    "district" TEXT,
    "city" TEXT,
    "uf" TEXT,
    "specialties" TEXT,
    "brands" TEXT,
    "paymentTerms" TEXT,
    "leadTimeDays" INTEGER,
    "rating" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'RASCUNHO',
    "expectedAt" TIMESTAMP(3),
    "paymentTerms" TEXT NOT NULL DEFAULT '30',
    "freight" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "freight" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" INTEGER NOT NULL,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "bank" TEXT,
    "agency" TEXT,
    "accountNumber" TEXT,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "openingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Title" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "TitleKind" NOT NULL,
    "status" "TitleStatus" NOT NULL DEFAULT 'ABERTO',
    "description" TEXT NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "counterparty" TEXT,
    "workOrderId" TEXT,
    "purchaseOrderId" TEXT,
    "goodsReceiptId" TEXT,
    "categoryId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "document" TEXT,
    "method" TEXT,
    "installment" INTEGER NOT NULL DEFAULT 1,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competence" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "settled" INTEGER NOT NULL DEFAULT 0,
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "interest" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "cash" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "reference" TEXT,
    "reversalOfId" TEXT,
    "reason" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_document_key" ON "Supplier"("document");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCategory_code_key" ON "FinancialCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_code_key" ON "CostCenter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Title_number_key" ON "Title"("number");

-- CreateIndex
CREATE INDEX "Title_kind_status_dueDate_idx" ON "Title"("kind", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Title_workOrderId_idx" ON "Title"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_number_key" ON "Settlement"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_reversalOfId_key" ON "Settlement"("reversalOfId");

-- CreateIndex
CREATE INDEX "Settlement_accountId_date_idx" ON "Settlement"("accountId", "date");

-- CreateIndex
CREATE INDEX "Settlement_titleId_idx" ON "Settlement"("titleId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────── Dados padrão da tesouraria ───────────────
INSERT INTO "FinancialAccount" (id, name, type, "openingBalance", "openingDate", active, "createdAt") VALUES
  ('00000000-0000-4000-8000-000000000001', 'Caixa da loja', 'CAIXA', 0, now(), true, now()),
  ('00000000-0000-4000-8000-000000000002', 'Conta bancária principal', 'BANCO', 0, now(), true, now()),
  ('00000000-0000-4000-8000-000000000003', 'Adquirente de cartões', 'ADQUIRENTE', 0, now(), true, now());

INSERT INTO "FinancialCategory" (id, code, name, kind, active) VALUES
  ('00000000-0000-4000-8000-000000000101', '1.01', 'Receita de OS (serviços e peças)', 'RECEITA', true),
  ('00000000-0000-4000-8000-000000000102', '1.02', 'Venda avulsa de peças e produtos', 'RECEITA', true),
  ('00000000-0000-4000-8000-000000000103', '1.03', 'Juros e multas recebidos', 'RECEITA', true),
  ('00000000-0000-4000-8000-000000000109', '1.09', 'Outras receitas', 'RECEITA', true),
  ('00000000-0000-4000-8000-000000000201', '2.01', 'Compras de peças e consumíveis', 'DESPESA', true),
  ('00000000-0000-4000-8000-000000000202', '2.02', 'Serviços de terceiros', 'DESPESA', true),
  ('00000000-0000-4000-8000-000000000203', '2.03', 'Folha e encargos', 'DESPESA', true),
  ('00000000-0000-4000-8000-000000000204', '2.04', 'Aluguel e condomínio', 'DESPESA', true),
  ('00000000-0000-4000-8000-000000000205', '2.05', 'Energia, água e telecom', 'DESPESA', true),
  ('00000000-0000-4000-8000-000000000206', '2.06', 'Taxas bancárias e de cartão', 'DESPESA', true),
  ('00000000-0000-4000-8000-000000000207', '2.07', 'Impostos e tributos', 'DESPESA', true),
  ('00000000-0000-4000-8000-000000000299', '2.99', 'Outras despesas', 'DESPESA', true);

INSERT INTO "CostCenter" (id, code, name, active) VALUES
  ('00000000-0000-4000-8000-000000000301', 'OFI', 'Oficina', true),
  ('00000000-0000-4000-8000-000000000302', 'ADM', 'Administrativo', true),
  ('00000000-0000-4000-8000-000000000303', 'COM', 'Comercial', true);

-- ─────────────── Conversão dos pagamentos de OS em títulos + baixas ───────────────
INSERT INTO "Title" (id, number, kind, status, description, "customerId", "workOrderId", "categoryId", method, installment, installments,
                     "issueDate", competence, "dueDate", amount, settled, "cancelReason", "createdById", "createdByName", "createdAt", "updatedAt")
SELECT p.id,
       'TIT-' || lpad((row_number() OVER (ORDER BY p."createdAt"))::text, 6, '0'),
       'RECEBER',
       (CASE WHEN p.status = 'ESTORNADO' THEN 'CANCELADO' ELSE 'PAGO' END)::"TitleStatus",
       'Recebimento ' || w.number, w."customerId", w.id, '00000000-0000-4000-8000-000000000101', p.method, 1, 1,
       p."createdAt", p."createdAt", p."createdAt", p.amount,
       CASE WHEN p.status = 'ESTORNADO' THEN 0 ELSE p.amount END,
       CASE WHEN p.status = 'ESTORNADO' THEN coalesce(p."reversedReason", 'Estornado') END,
       p."userId", p."userName", p."createdAt", now()
FROM "Payment" p JOIN "WorkOrder" w ON w.id = p."workOrderId";

INSERT INTO "Settlement" (id, number, "titleId", "accountId", date, amount, interest, discount, fee, cash, method, installments, reference, "userId", "userName", "createdAt")
SELECT gen_random_uuid(), p.number, p.id,
       CASE WHEN p.method = 'DINHEIRO' THEN '00000000-0000-4000-8000-000000000001'
            WHEN p.method IN ('CREDITO', 'DEBITO') THEN '00000000-0000-4000-8000-000000000003'
            ELSE '00000000-0000-4000-8000-000000000002' END,
       p."createdAt", p.amount, 0, 0, 0, p.amount, p.method, p.installments, p.reference, p."userId", p."userName", p."createdAt"
FROM "Payment" p WHERE p.status = 'CONFIRMADO';

INSERT INTO "NumberSequence" (id, "branchId", key, prefix, next, padding)
SELECT gen_random_uuid(), b.id, 'TIT', 'TIT', (SELECT count(*) FROM "Title") + 1, 6 FROM "Branch" b
ON CONFLICT ("branchId", key) DO NOTHING;

-- DropForeignKey / DropTable (após a conversão)
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_workOrderId_fkey";
DROP TABLE "Payment";

-- ─────────────── Tabelas append-only ───────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Settlement','Transfer','GoodsReceipt','GoodsReceiptItem']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION osc_block_mutation()', t || '_immutable', t);
  END LOOP;
END $$;
