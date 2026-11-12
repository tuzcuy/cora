-- CreateEnum
CREATE TYPE "EDocumentStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "EDocumentKind" AS ENUM ('E_INVOICE', 'E_ARCHIVE', 'E_DESPATCH');

-- CreateTable
CREATE TABLE "EDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "EDocumentKind" NOT NULL,
    "status" "EDocumentStatus" NOT NULL DEFAULT 'QUEUED',
    "shipmentId" TEXT,
    "documentId" TEXT,
    "partnerId" TEXT,
    "ettn" TEXT NOT NULL,
    "providerId" TEXT,
    "providerName" TEXT NOT NULL DEFAULT 'null',
    "responseCode" TEXT,
    "responseText" TEXT,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastTriedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EDocument_ettn_key" ON "EDocument"("ettn");

-- CreateIndex
CREATE INDEX "EDocument_tenantId_status_idx" ON "EDocument"("tenantId", "status");

-- CreateIndex
CREATE INDEX "EDocument_tenantId_kind_idx" ON "EDocument"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "EDocument_shipmentId_idx" ON "EDocument"("shipmentId");

-- CreateIndex
CREATE INDEX "EDocument_documentId_idx" ON "EDocument"("documentId");

-- AddForeignKey
ALTER TABLE "EDocument" ADD CONSTRAINT "EDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EDocument" ADD CONSTRAINT "EDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EDocument" ADD CONSTRAINT "EDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SalesDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EDocument" ADD CONSTRAINT "EDocument_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

