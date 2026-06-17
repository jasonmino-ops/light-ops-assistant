-- Member V1 Batch 1: member profile and balance ledger foundation.

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'MEMBER_BALANCE';

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MemberBalanceLedgerType" AS ENUM ('IMPORT', 'RECHARGE', 'CONSUME', 'REFUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "MemberBalanceLedgerSourceType" AS ENUM ('IMPORT', 'SALE_RECORD', 'MANUAL_RECHARGE', 'MANUAL_ADJUST', 'REFUND', 'API');

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN "memberId" TEXT,
ADD COLUMN "memberBalanceUsed" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "memberCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberBalanceLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "MemberBalanceLedgerType" NOT NULL,
    "sourceType" "MemberBalanceLedgerSourceType" NOT NULL,
    "sourceId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceBefore" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "operatorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberBalanceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_tenantId_storeId_memberCode_key" ON "Member"("tenantId", "storeId", "memberCode");

-- CreateIndex
CREATE UNIQUE INDEX "Member_tenantId_storeId_normalizedPhone_key" ON "Member"("tenantId", "storeId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "Member_tenantId_idx" ON "Member"("tenantId");

-- CreateIndex
CREATE INDEX "Member_storeId_idx" ON "Member"("storeId");

-- CreateIndex
CREATE INDEX "Member_status_idx" ON "Member"("status");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_tenantId_idx" ON "MemberBalanceLedger"("tenantId");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_storeId_idx" ON "MemberBalanceLedger"("storeId");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_memberId_idx" ON "MemberBalanceLedger"("memberId");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_type_idx" ON "MemberBalanceLedger"("type");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_sourceType_idx" ON "MemberBalanceLedger"("sourceType");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_sourceId_idx" ON "MemberBalanceLedger"("sourceId");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_operatorUserId_idx" ON "MemberBalanceLedger"("operatorUserId");

-- CreateIndex
CREATE INDEX "MemberBalanceLedger_createdAt_idx" ON "MemberBalanceLedger"("createdAt");

-- CreateIndex
CREATE INDEX "SaleRecord_memberId_idx" ON "SaleRecord"("memberId");

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBalanceLedger" ADD CONSTRAINT "MemberBalanceLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBalanceLedger" ADD CONSTRAINT "MemberBalanceLedger_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBalanceLedger" ADD CONSTRAINT "MemberBalanceLedger_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBalanceLedger" ADD CONSTRAINT "MemberBalanceLedger_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
