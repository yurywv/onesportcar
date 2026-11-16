-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('EMAIL', 'WHATSAPP_API', 'WHATSAPP_MANUAL');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('RASCUNHO', 'ENVIANDO', 'PAUSADA', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'FALHOU', 'PULADO');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "marketingOptOutAt" TIMESTAMP(3),
ADD COLUMN     "marketingToken" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'RASCUNHO',
    "subject" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "waTemplate" TEXT,
    "waLanguage" TEXT NOT NULL DEFAULT 'pt_BR',
    "waParams" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 50,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "windowStart" INTEGER NOT NULL DEFAULT 480,
    "windowEnd" INTEGER NOT NULL DEFAULT 1200,
    "weekdaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "appUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDENTE',
    "error" TEXT,
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_status_nextRunAt_idx" ON "Campaign"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_customerId_key" ON "CampaignRecipient"("campaignId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_marketingToken_key" ON "Customer"("marketingToken");

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

