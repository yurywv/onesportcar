-- CreateEnum
CREATE TYPE "FiscalKind" AS ENUM ('NFSE', 'NFE');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('RASCUNHO', 'PROCESSANDO', 'AUTORIZADA', 'REJEITADA', 'CANCELADA', 'ERRO');

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "cest" TEXT,
ADD COLUMN     "cfop" TEXT,
ADD COLUMN     "csosn" TEXT,
ADD COLUMN     "cstIcms" TEXT,
ADD COLUMN     "gtin" TEXT,
ADD COLUMN     "icmsRate" DOUBLE PRECISION,
ADD COLUMN     "ncm" TEXT,
ADD COLUMN     "origin" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ServiceCatalog" ADD COLUMN     "cnae" TEXT,
ADD COLUMN     "issRate" DOUBLE PRECISION,
ADD COLUMN     "lc116" TEXT,
ADD COLUMN     "municipalTaxCode" TEXT,
ADD COLUMN     "nationalTaxCode" TEXT,
ADD COLUMN     "nbs" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brands" TEXT,
ADD COLUMN     "certifications" TEXT,
ADD COLUMN     "commissionPartPct" DOUBLE PRECISION,
ADD COLUMN     "commissionServicePct" DOUBLE PRECISION,
ADD COLUMN     "document" TEXT,
ADD COLUMN     "isSeller" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "kmIn" INTEGER,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'CHECKIN',
ADD COLUMN     "publicNotes" TEXT,
ADD COLUMN     "sellerId" TEXT;

-- CreateTable
CREATE TABLE "FiscalSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'FOCUS_NFE',
    "environment" TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
    "cnpj" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "ie" TEXT,
    "im" TEXT,
    "crt" INTEGER NOT NULL DEFAULT 3,
    "cnae" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "cep" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Campinas',
    "uf" TEXT NOT NULL DEFAULT 'SP',
    "ibgeCode" TEXT NOT NULL DEFAULT '3509502',
    "issRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "defaultLc116" TEXT NOT NULL DEFAULT '14.01',
    "defaultNationalTaxCode" TEXT NOT NULL DEFAULT '140101',
    "defaultMunicipalTaxCode" TEXT,
    "defaultNbs" TEXT,
    "nfseSeries" TEXT NOT NULL DEFAULT '1',
    "nfseNext" INTEGER NOT NULL DEFAULT 1,
    "nfeSeries" TEXT NOT NULL DEFAULT '1',
    "nfeNext" INTEGER NOT NULL DEFAULT 1,
    "defaultCfop" TEXT NOT NULL DEFAULT '5102',
    "defaultNcm" TEXT,
    "pisRate" DOUBLE PRECISION NOT NULL DEFAULT 0.65,
    "cofinsRate" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "sendIbsCbs" BOOLEAN NOT NULL DEFAULT false,
    "cbsRate" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "ibsRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "additionalInfo" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "kind" "FiscalKind" NOT NULL,
    "environment" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" "FiscalStatus" NOT NULL DEFAULT 'RASCUNHO',
    "workOrderId" TEXT,
    "customerId" TEXT,
    "series" TEXT,
    "number" TEXT,
    "rpsNumber" INTEGER,
    "accessKey" TEXT,
    "verificationCode" TEXT,
    "protocol" TEXT,
    "total" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "message" TEXT,
    "xmlUrl" TEXT,
    "pdfUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_ref_key" ON "FiscalDocument"("ref");

-- CreateIndex
CREATE INDEX "FiscalDocument_workOrderId_idx" ON "FiscalDocument"("workOrderId");

-- CreateIndex
CREATE INDEX "FiscalDocument_kind_status_createdAt_idx" ON "FiscalDocument"("kind", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Emitente inicial: DBL Automotiva (dados da NF-e 13 e da NFS-e 13/E emitidas em 24/08/2026).
-- Numeração começa depois das notas já emitidas pelo SYSCAR; conferir antes de ir para produção.
INSERT INTO "FiscalSettings" ("id", "cnpj", "legalName", "tradeName", "ie", "im", "crt", "cnae", "email", "cep", "street", "number", "district", "nfseNext", "nfeNext", "defaultNcm", "updatedAt")
VALUES ('default', '67496704000178', 'DBL AUTOMOTIVA LTDA', 'ONE SPORTCAR', '160352386117', '011753862', 3, '4520001', 'gestao@onesportcar.com.br', '13090615', 'AV JOSE DE SOUSA CAMPOS', '2612', 'CHACARA DA BARRA', 14, 14, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Itens do orçamento com código, referência e unidade (impressão no padrão do SYSCAR)
ALTER TABLE "EstimateItem" ADD COLUMN "code" TEXT, ADD COLUMN "reference" TEXT, ADD COLUMN "unit" TEXT;
