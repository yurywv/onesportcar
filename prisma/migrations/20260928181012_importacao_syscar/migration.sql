-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "legacyCode" TEXT;

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "legacyCode" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "legacyCode" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "legacyCode" TEXT;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "legacy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legacyNumber" TEXT,
ADD COLUMN     "legacyTotal" INTEGER;

-- CreateTable
CREATE TABLE "PasswordToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT,
    "mapping" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALIDANDO',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "key" TEXT,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "messages" TEXT[],
    "targetId" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordToken_tokenHash_key" ON "PasswordToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt");

-- CreateIndex
CREATE INDEX "ImportRow_jobId_status_idx" ON "ImportRow"("jobId", "status");

-- CreateIndex
CREATE INDEX "ImportRow_jobId_key_idx" ON "ImportRow"("jobId", "key");

-- CreateIndex
CREATE INDEX "Vehicle_legacyCode_idx" ON "Vehicle"("legacyCode");

-- AddForeignKey
ALTER TABLE "PasswordToken" ADD CONSTRAINT "PasswordToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
