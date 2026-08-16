ALTER TABLE "Product"
ADD COLUMN "discountPrice" DECIMAL(12,2),
ADD COLUMN "discountEnabled" BOOLEAN NOT NULL DEFAULT false;
