-- AlterEnum
ALTER TYPE "SalesStatus" ADD VALUE 'APPROVAL_PENDING';

-- AlterTable
ALTER TABLE "SalesDocument" ADD COLUMN     "billingAddressId" TEXT,
ADD COLUMN     "revisedFromId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesDocumentLine" ADD COLUMN     "isPriceOverridden" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SalesDocument_revisedFromId_idx" ON "SalesDocument"("revisedFromId");

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "PartnerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_revisedFromId_fkey" FOREIGN KEY ("revisedFromId") REFERENCES "SalesDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

