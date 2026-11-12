-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "SalesDocumentType" ADD VALUE 'RETURN';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN_IN';

-- AlterTable
ALTER TABLE "SalesDocumentLine" ADD COLUMN     "pickedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQty" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "actualDespatchDate" TIMESTAMP(3),
ADD COLUMN     "carrierTitle" TEXT,
ADD COLUMN     "carrierVkn" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryTermsCode" TEXT,
ADD COLUMN     "driverTckn" TEXT,
ADD COLUMN     "gibStatus" TEXT,
ADD COLUMN     "gibUuid" TEXT,
ADD COLUMN     "grossWeightKg" DECIMAL(18,3),
ADD COLUMN     "issueTime" TIMESTAMP(3),
ADD COLUMN     "packageTypeCode" TEXT,
ADD COLUMN     "sentToGibAt" TIMESTAMP(3),
ADD COLUMN     "trailerPlate" TEXT,
ADD COLUMN     "ublProfileId" TEXT NOT NULL DEFAULT 'TEMELIRSALIYE',
ADD COLUMN     "ublTypeCode" TEXT NOT NULL DEFAULT 'SEVK',
ADD COLUMN     "ublUuid" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ShipmentLine" ADD COLUMN     "lineNo" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "StockReceipt" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'TRY',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedById" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "totalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockReceiptLine" ADD COLUMN     "lineNo" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "unitFactor" DECIMAL(18,3) NOT NULL DEFAULT 1,
ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 1,
    "productId" TEXT NOT NULL,
    "systemQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "countedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCount_tenantId_status_idx" ON "StockCount"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenantId_number_key" ON "StockCount"("tenantId", "number");

-- CreateIndex
CREATE INDEX "StockCountLine_countId_idx" ON "StockCountLine"("countId");

-- CreateIndex
CREATE INDEX "StockCountLine_productId_idx" ON "StockCountLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_productId_key" ON "StockCountLine"("countId", "productId");

-- CreateIndex
CREATE INDEX "StockReceipt_tenantId_date_idx" ON "StockReceipt"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

