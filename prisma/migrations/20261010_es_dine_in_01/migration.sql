-- ES-DINE-IN-01 M1: dine-in table service.
--
-- Additive only: three enums, four tables, and one nullable column, one index and
-- one foreign key on "SaleRecord". No existing column, constraint, index or enum is
-- changed. The new column has no default and is not backfilled. Every historical
-- and every non-dine-in sale row keeps "diningBatchId" = NULL.
--
-- No table in this migration stores a price, a line amount, a receivable or a paid
-- amount. Consumption stays in "SaleRecord" and payment in "PaymentIntent".
--
-- Lock note for production review: "SaleRecord" takes an ACCESS EXCLUSIVE lock for
-- ADD COLUMN (metadata only, no rewrite), a SHARE lock while the new index builds,
-- and a SHARE ROW EXCLUSIVE lock for ADD CONSTRAINT (the validation scan is trivial
-- because every existing row is NULL). Run in a quiet window.

-- CreateEnum
CREATE TYPE "DiningAreaKind" AS ENUM ('HALL', 'ROOM');

-- CreateEnum
CREATE TYPE "DiningMealState" AS ENUM ('OPEN', 'PAID', 'CLOSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DiningBatchKind" AS ENUM ('ORDER', 'VOID', 'RENOTIFY');

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN "diningBatchId" TEXT;

-- CreateTable
CREATE TABLE "DiningTable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "areaKind" "DiningAreaKind" NOT NULL DEFAULT 'HALL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiningTable_name_check" CHECK (char_length(btrim("name")) >= 1)
);

-- CreateTable
CREATE TABLE "DiningMeal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "state" "DiningMealState" NOT NULL DEFAULT 'OPEN',
    "guestCount" INTEGER NOT NULL,
    "note" VARCHAR(200),
    "billNo" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "openedByUserId" TEXT NOT NULL,
    "openRequestKey" VARCHAR(128) NOT NULL,
    "openRequestDigest" CHAR(64) NOT NULL,
    "settleRequestKey" VARCHAR(128),
    "settleRequestDigest" CHAR(64),
    "paymentIntentId" TEXT,
    "paidByUserId" TEXT,
    "endRequestKey" VARCHAR(128),
    "endRequestDigest" CHAR(64),
    "endedByUserId" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiningMeal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiningMeal_guestCount_check" CHECK ("guestCount" BETWEEN 1 AND 999),
    CONSTRAINT "DiningMeal_version_check" CHECK ("version" >= 1),
    -- A payment fact exists exactly when the meal has been settled.
    CONSTRAINT "DiningMeal_payment_shape_check" CHECK (
        ("state" IN ('PAID', 'CLOSED')) = ("paymentIntentId" IS NOT NULL)
        AND ("paymentIntentId" IS NULL) = ("settleRequestKey" IS NULL)
        AND ("paymentIntentId" IS NULL) = ("settleRequestDigest" IS NULL)
        AND ("paymentIntentId" IS NULL) = ("paidByUserId" IS NULL)
        AND ("paymentIntentId" IS NULL OR "billNo" IS NOT NULL)
    ),
    -- Terminal fields exist exactly when the meal has ended.
    CONSTRAINT "DiningMeal_end_shape_check" CHECK (
        ("state" IN ('CLOSED', 'VOIDED')) = ("endedAt" IS NOT NULL)
        AND ("endedAt" IS NULL) = ("endRequestKey" IS NULL)
        AND ("endedAt" IS NULL) = ("endRequestDigest" IS NULL)
        AND ("endedAt" IS NULL) = ("endedByUserId" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "DiningBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "DiningBatchKind" NOT NULL,
    "requestKey" VARCHAR(128) NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "reason" VARCHAR(200),
    "refBatchId" TEXT,
    "noticeRequired" BOOLEAN NOT NULL DEFAULT false,
    "kitchenLineIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "noticeClaimedAt" TIMESTAMP(3),
    "noticeClaimedByUserId" TEXT,
    "noticeContentDigest" CHAR(64),
    "noticeWithdrawnAt" TIMESTAMP(3),
    "noticeReportedOutcome" VARCHAR(48),
    "noticeReportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiningBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiningBatch_seq_check" CHECK ("seq" >= 1),
    -- Only a re-notification points at another batch, and never at itself.
    CONSTRAINT "DiningBatch_ref_shape_check" CHECK (
        ("kind" = 'RENOTIFY') = ("refBatchId" IS NOT NULL)
        AND ("refBatchId" IS NULL OR "refBatchId" <> "id")
    ),
    CONSTRAINT "DiningBatch_reason_check" CHECK ("kind" = 'ORDER' OR "reason" IS NOT NULL),
    -- A notice is claimed at most once, is never both claimed and withdrawn, and a
    -- page report can only follow a claim.
    CONSTRAINT "DiningBatch_notice_shape_check" CHECK (
        ("noticeClaimedAt" IS NULL) = ("noticeClaimedByUserId" IS NULL)
        AND ("noticeClaimedAt" IS NULL) = ("noticeContentDigest" IS NULL)
        AND ("noticeReportedAt" IS NULL) = ("noticeReportedOutcome" IS NULL)
        AND ("noticeReportedAt" IS NULL OR "noticeClaimedAt" IS NOT NULL)
        AND ("noticeClaimedAt" IS NULL OR "noticeWithdrawnAt" IS NULL)
        AND ("noticeRequired" OR ("noticeClaimedAt" IS NULL AND "noticeWithdrawnAt" IS NULL))
    )
);

-- CreateTable
CREATE TABLE "DiningVoidLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "voidBatchId" TEXT NOT NULL,
    "saleRecordId" TEXT NOT NULL,
    "originalBatchId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "originalNoticeClaimed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiningVoidLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiningVoidLine_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "DiningVoidLine_batches_differ_check" CHECK ("voidBatchId" <> "originalBatchId")
);

-- CreateIndex
CREATE INDEX "SaleRecord_diningBatchId_idx" ON "SaleRecord"("diningBatchId");

-- CreateIndex
CREATE INDEX "DiningTable_tenantId_storeId_isActive_sortOrder_idx" ON "DiningTable"("tenantId", "storeId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_tenantId_storeId_name_key" ON "DiningTable"("tenantId", "storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_id_tenantId_storeId_key" ON "DiningTable"("id", "tenantId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningMeal_paymentIntentId_key" ON "DiningMeal"("paymentIntentId");

-- CreateIndex
CREATE INDEX "DiningMeal_tenantId_storeId_state_idx" ON "DiningMeal"("tenantId", "storeId", "state");

-- CreateIndex
CREATE INDEX "DiningMeal_tableId_idx" ON "DiningMeal"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningMeal_tenantId_storeId_openRequestKey_key" ON "DiningMeal"("tenantId", "storeId", "openRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "DiningMeal_tenantId_storeId_billNo_key" ON "DiningMeal"("tenantId", "storeId", "billNo");

-- CreateIndex
CREATE UNIQUE INDEX "DiningMeal_tenantId_storeId_settleRequestKey_key" ON "DiningMeal"("tenantId", "storeId", "settleRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "DiningMeal_tenantId_storeId_endRequestKey_key" ON "DiningMeal"("tenantId", "storeId", "endRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "DiningMeal_id_tenantId_storeId_key" ON "DiningMeal"("id", "tenantId", "storeId");

-- One table holds at most one meal that has not ended. Expressed as a reviewed
-- PostgreSQL partial unique index because the Prisma schema cannot declare it. The
-- application lock in lib/dine-in is the first line, this index is the backstop.
CREATE UNIQUE INDEX "DiningMeal_one_active_per_table"
ON "DiningMeal"("tableId")
WHERE "state" IN ('OPEN', 'PAID');

-- CreateIndex
CREATE INDEX "DiningBatch_tenantId_storeId_mealId_idx" ON "DiningBatch"("tenantId", "storeId", "mealId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningBatch_mealId_seq_key" ON "DiningBatch"("mealId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "DiningBatch_mealId_requestKey_key" ON "DiningBatch"("mealId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "DiningBatch_id_tenantId_storeId_key" ON "DiningBatch"("id", "tenantId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningBatch_id_mealId_key" ON "DiningBatch"("id", "mealId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningVoidLine_saleRecordId_key" ON "DiningVoidLine"("saleRecordId");

-- CreateIndex
CREATE INDEX "DiningVoidLine_voidBatchId_idx" ON "DiningVoidLine"("voidBatchId");

-- CreateIndex
CREATE INDEX "DiningVoidLine_originalBatchId_idx" ON "DiningVoidLine"("originalBatchId");

-- CreateIndex
CREATE INDEX "DiningVoidLine_tenantId_storeId_mealId_idx" ON "DiningVoidLine"("tenantId", "storeId", "mealId");

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_diningBatchId_tenantId_storeId_fkey" FOREIGN KEY ("diningBatchId", "tenantId", "storeId") REFERENCES "DiningBatch"("id", "tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningMeal" ADD CONSTRAINT "DiningMeal_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningMeal" ADD CONSTRAINT "DiningMeal_tableId_tenantId_storeId_fkey" FOREIGN KEY ("tableId", "tenantId", "storeId") REFERENCES "DiningTable"("id", "tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningMeal" ADD CONSTRAINT "DiningMeal_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningBatch" ADD CONSTRAINT "DiningBatch_mealId_tenantId_storeId_fkey" FOREIGN KEY ("mealId", "tenantId", "storeId") REFERENCES "DiningMeal"("id", "tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningBatch" ADD CONSTRAINT "DiningBatch_refBatchId_mealId_fkey" FOREIGN KEY ("refBatchId", "mealId") REFERENCES "DiningBatch"("id", "mealId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningVoidLine" ADD CONSTRAINT "DiningVoidLine_mealId_tenantId_storeId_fkey" FOREIGN KEY ("mealId", "tenantId", "storeId") REFERENCES "DiningMeal"("id", "tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningVoidLine" ADD CONSTRAINT "DiningVoidLine_voidBatchId_tenantId_storeId_fkey" FOREIGN KEY ("voidBatchId", "tenantId", "storeId") REFERENCES "DiningBatch"("id", "tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningVoidLine" ADD CONSTRAINT "DiningVoidLine_originalBatchId_mealId_fkey" FOREIGN KEY ("originalBatchId", "mealId") REFERENCES "DiningBatch"("id", "mealId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningVoidLine" ADD CONSTRAINT "DiningVoidLine_saleRecordId_fkey" FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
