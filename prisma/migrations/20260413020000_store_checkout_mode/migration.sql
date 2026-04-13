-- AlterTable: Store — 新增 checkoutMode 字段
-- DIRECT_PAYMENT（零售即时收款，默认）| DEFERRED_PAYMENT（挂单待结账，餐饮场景预留）
-- DEFAULT 'DIRECT_PAYMENT' 确保存量门店无感升级。
ALTER TABLE "Store"
    ADD COLUMN "checkoutMode" TEXT NOT NULL DEFAULT 'DIRECT_PAYMENT';
