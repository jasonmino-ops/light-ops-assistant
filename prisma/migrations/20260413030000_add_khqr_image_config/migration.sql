-- AlterTable: MerchantPaymentConfig
-- 1. 将 merchantId / merchantName / merchantAccountRef 改为可空（支持纯图片模式）
-- 2. 新增 khqrImageUrl（TEXT 可空，存 base64 data URL）
-- 3. 新增 uploadedByUserId（可空，记录上传者）
ALTER TABLE "MerchantPaymentConfig"
    ALTER COLUMN "merchantId"         DROP NOT NULL,
    ALTER COLUMN "merchantName"       DROP NOT NULL,
    ALTER COLUMN "merchantAccountRef" DROP NOT NULL,
    ADD COLUMN "khqrImageUrl"         TEXT,
    ADD COLUMN "uploadedByUserId"     TEXT;

-- CreateTable: KhqrConfigSession
-- 与 ProductImportSession 相同模式：telegramId @id，会话过期由应用层（30 min TTL）控制
CREATE TABLE "KhqrConfigSession" (
    "telegramId" TEXT NOT NULL,
    "tenantId"   TEXT,
    "phase"      TEXT NOT NULL DEFAULT 'AWAITING_IMAGE',
    "fileId"     TEXT,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KhqrConfigSession_pkey" PRIMARY KEY ("telegramId")
);
