-- CreateTable
CREATE TABLE "ProductImportSession" (
    "telegramId"  TEXT NOT NULL,
    "tenantId"    TEXT,
    "phase"       TEXT NOT NULL DEFAULT 'AWAITING_DATA',
    "pendingRows" TEXT NOT NULL DEFAULT '[]',
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImportSession_pkey" PRIMARY KEY ("telegramId")
);
