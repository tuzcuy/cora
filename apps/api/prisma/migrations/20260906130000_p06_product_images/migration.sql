-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "byteSize" INTEGER,
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "data" BYTEA,
ADD COLUMN     "fileName" TEXT;

