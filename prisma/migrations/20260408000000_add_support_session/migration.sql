-- CreateTable
CREATE TABLE "SupportSession" (
    "telegramId" TEXT NOT NULL,
    "tenantId" TEXT,
    "sessionState" TEXT NOT NULL DEFAULT 'auto_active',
    "language" TEXT NOT NULL DEFAULT 'zh',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("telegramId")
);

-- CreateIndex
CREATE INDEX "SupportSession_tenantId_idx" ON "SupportSession"("tenantId");

-- CreateIndex
CREATE INDEX "SupportSession_sessionState_idx" ON "SupportSession"("sessionState");
