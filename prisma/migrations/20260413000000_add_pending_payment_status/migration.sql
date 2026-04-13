-- AlterEnum: RecordStatus — 新增 PENDING_PAYMENT（预留"已建单待收款"状态）
-- 零售默认路径仍走 COMPLETED；餐饮先下单后结账时使用 PENDING_PAYMENT。
-- IF NOT EXISTS 保证幂等，可重复执行。
ALTER TYPE "RecordStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
