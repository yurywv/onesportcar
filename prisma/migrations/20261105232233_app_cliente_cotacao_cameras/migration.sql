-- CreateEnum
CREATE TYPE "ServicePhase" AS ENUM ('AGENDAMENTO', 'CHECK_IN', 'DIAGNOSTICO', 'ORCAMENTO', 'EXECUCAO', 'LAVAGEM', 'CHECK_OUT');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RECEPCAO';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'SERVICO',
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'INTERNO';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "portalActivatedAt" TIMESTAMP(3),
ADD COLUMN     "portalFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "portalLastLoginAt" TIMESTAMP(3),
ADD COLUMN     "portalLockedUntil" TIMESTAMP(3),
ADD COLUMN     "portalPasswordHash" TEXT;

-- AlterTable
ALTER TABLE "Diagnostic" ADD COLUMN     "laborMinutes" INTEGER;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "quoteDoneAt" TIMESTAMP(3),
ADD COLUMN     "quoteDoneBy" TEXT,
ADD COLUMN     "quoteStatus" TEXT;

-- CreateTable
CREATE TABLE "DiagnosticItem" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "diagnosticId" TEXT,
    "type" "ItemType" NOT NULL,
    "classification" "ItemClass" NOT NULL DEFAULT 'OBRIGATORIO',
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "minutes" INTEGER,
    "reference" TEXT,
    "notes" TEXT,
    "inventoryItemId" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "unitCost" INTEGER,
    "leadTimeDays" INTEGER,
    "quoteNotes" TEXT,
    "quotedById" TEXT,
    "quotedByName" TEXT,
    "quotedAt" TIMESTAMP(3),
    "estimateItemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderPhoto" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "phase" "ServicePhase" NOT NULL,
    "caption" TEXT,
    "mime" TEXT NOT NULL DEFAULT 'image/jpeg',
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "visibleToCustomer" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'HLS',
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraPhaseDefault" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "phase" "ServicePhase" NOT NULL,

    CONSTRAINT "CameraPhaseDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderCamera" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "phase" "ServicePhase" NOT NULL,
    "cameraId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderCamera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalToken" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPortalToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagnosticItem_workOrderId_idx" ON "DiagnosticItem"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderPhoto_workOrderId_phase_idx" ON "WorkOrderPhoto"("workOrderId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "CameraPhaseDefault_cameraId_phase_key" ON "CameraPhaseDefault"("cameraId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderCamera_workOrderId_phase_cameraId_key" ON "WorkOrderCamera"("workOrderId", "phase", "cameraId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerSession_customerId_idx" ON "CustomerSession"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalToken_tokenHash_key" ON "CustomerPortalToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "DiagnosticItem" ADD CONSTRAINT "DiagnosticItem_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticItem" ADD CONSTRAINT "DiagnosticItem_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "Diagnostic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderPhoto" ADD CONSTRAINT "WorkOrderPhoto_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraPhaseDefault" ADD CONSTRAINT "CameraPhaseDefault_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderCamera" ADD CONSTRAINT "WorkOrderCamera_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderCamera" ADD CONSTRAINT "WorkOrderCamera_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPortalToken" ADD CONSTRAINT "CustomerPortalToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
