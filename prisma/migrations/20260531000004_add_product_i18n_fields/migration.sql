-- Add multilingual name/description fields to Product
ALTER TABLE "Product" ADD COLUMN "nameZh" TEXT;
ALTER TABLE "Product" ADD COLUMN "nameEn" TEXT;
ALTER TABLE "Product" ADD COLUMN "nameKm" TEXT;
ALTER TABLE "Product" ADD COLUMN "descZh" TEXT;
ALTER TABLE "Product" ADD COLUMN "descEn" TEXT;
ALTER TABLE "Product" ADD COLUMN "descKm" TEXT;
