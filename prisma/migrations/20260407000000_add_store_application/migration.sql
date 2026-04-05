-- CreateTable
CREATE TABLE "StoreApplication" (
    "id" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "tenantId" TEXT,
    "bindTokenValue" TEXT,
    "note" TEXT,

    CONSTRAINT "StoreApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreApplication_status_idx" ON "StoreApplication"("status");

-- CreateIndex
CREATE INDEX "StoreApplication_telegramId_idx" ON "StoreApplication"("telegramId");
