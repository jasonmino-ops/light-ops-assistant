-- CreateEnum
CREATE TYPE "MarketingProductPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED');

-- CreateTable
CREATE TABLE "MarketingProductPage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" "MarketingProductPageStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT,
  "subtitle" TEXT,
  "heroImageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketingProductPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingProductPage_slug_key" ON "MarketingProductPage"("slug");
CREATE INDEX "MarketingProductPage_tenantId_idx" ON "MarketingProductPage"("tenantId");
CREATE INDEX "MarketingProductPage_storeId_idx" ON "MarketingProductPage"("storeId");
CREATE INDEX "MarketingProductPage_productId_idx" ON "MarketingProductPage"("productId");

-- AddForeignKey
ALTER TABLE "MarketingProductPage" ADD CONSTRAINT "MarketingProductPage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingProductPage" ADD CONSTRAINT "MarketingProductPage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingProductPage" ADD CONSTRAINT "MarketingProductPage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
