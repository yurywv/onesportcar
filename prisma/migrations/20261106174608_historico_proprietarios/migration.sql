-- AlterTable
ALTER TABLE "VehicleOwnership" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'SISTEMA';

-- CreateIndex
CREATE INDEX "VehicleOwnership_vehicleId_idx" ON "VehicleOwnership"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleOwnership_customerId_idx" ON "VehicleOwnership"("customerId");

-- Vínculos criados por lotes de importação de veículos passam a ser identificados como IMPORTACAO
UPDATE "VehicleOwnership" o SET "source" = 'IMPORTACAO'
FROM "ImportRow" r JOIN "ImportJob" j ON j."id" = r."jobId"
WHERE j."entity" = 'VEICULOS' AND r."status" IN ('IMPORTADO', 'MANTIDO') AND r."targetId" = o."vehicleId";
