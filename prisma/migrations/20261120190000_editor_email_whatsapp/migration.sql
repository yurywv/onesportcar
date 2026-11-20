-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "artAlt" TEXT,
ADD COLUMN     "artId" TEXT,
ADD COLUMN     "artLink" TEXT,
ADD COLUMN     "emailMode" TEXT NOT NULL DEFAULT 'TEXTO',
ADD COLUMN     "htmlBody" TEXT,
ADD COLUMN     "preheader" TEXT;

-- CreateTable
CREATE TABLE "CampaignAsset" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "data" BYTEA NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "customerId" TEXT,
    "body" TEXT NOT NULL,
    "template" TEXT,
    "fromNumber" TEXT,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignAsset_campaignId_idx" ON "CampaignAsset"("campaignId");

-- CreateIndex
CREATE INDEX "MessageLog_createdAt_idx" ON "MessageLog"("createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_customerId_idx" ON "MessageLog"("customerId");

-- AddForeignKey
ALTER TABLE "CampaignAsset" ADD CONSTRAINT "CampaignAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

