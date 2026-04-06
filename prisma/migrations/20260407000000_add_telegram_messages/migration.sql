-- CreateTable
CREATE TABLE "TelegramMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "recipientTelegramId" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "errorMessage" TEXT,
    "sentBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramMessage_tenantId_idx" ON "TelegramMessage"("tenantId");

-- CreateIndex
CREATE INDEX "TelegramMessage_recipientTelegramId_idx" ON "TelegramMessage"("recipientTelegramId");

-- CreateIndex
CREATE INDEX "TelegramMessage_createdAt_idx" ON "TelegramMessage"("createdAt");
