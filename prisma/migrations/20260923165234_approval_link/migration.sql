/*
  Warnings:

  - You are about to drop the column `tokenExpiresAt` on the `EstimateVersion` table. All the data in the column will be lost.
  - You are about to drop the column `tokenHash` on the `EstimateVersion` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "EstimateVersion_tokenHash_key";

-- AlterTable
ALTER TABLE "EstimateVersion" DROP COLUMN "tokenExpiresAt",
DROP COLUMN "tokenHash";

-- CreateTable
CREATE TABLE "ApprovalLink" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalLink_tokenHash_key" ON "ApprovalLink"("tokenHash");

-- AddForeignKey
ALTER TABLE "ApprovalLink" ADD CONSTRAINT "ApprovalLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EstimateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
