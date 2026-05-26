-- AlterTable: add E-Life featured fields to Store
ALTER TABLE "Store" ADD COLUMN "eLifeFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Store" ADD COLUMN "eLifeFeaturedSort" INTEGER NOT NULL DEFAULT 0;
