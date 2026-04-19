-- CreateTable: ProductCategory（两级分类：parentId=null → 一级，parentId非空 → 二级）
CREATE TABLE "ProductCategory" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "parentId"  TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- 自引用外键（parentId → id），删除父级时子级 parentId 置 NULL
ALTER TABLE "ProductCategory"
    ADD CONSTRAINT "ProductCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductCategory_tenantId_idx"           ON "ProductCategory"("tenantId");
CREATE INDEX "ProductCategory_tenantId_parentId_idx"  ON "ProductCategory"("tenantId", "parentId");

-- AlterTable: Product — 新增可空 categoryId
ALTER TABLE "Product"
    ADD COLUMN "categoryId" TEXT;

ALTER TABLE "Product"
    ADD CONSTRAINT "Product_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
