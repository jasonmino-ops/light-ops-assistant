-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'KHQR');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "khqrPayload" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_orderNo_key" ON "PaymentIntent"("orderNo");

-- CreateIndex
CREATE INDEX "PaymentIntent_tenantId_createdAt_idx" ON "PaymentIntent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_orderNo_idx" ON "PaymentIntent"("orderNo");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");
