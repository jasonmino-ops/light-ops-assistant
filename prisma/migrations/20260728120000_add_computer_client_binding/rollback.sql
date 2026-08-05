-- EP-CC-01 Computer Client Binding —— 回滚脚本
--
-- 用途：把 20260728120000_add_computer_client_binding 完整撤销，
-- 回到该迁移之前的数据库结构。
--
-- 执行方式（生产需先备份，且必须用 DIRECT_URL 直连，不能走 PgBouncer）：
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260728120000_add_computer_client_binding/rollback.sql
--
-- 注意：
--   1. 本脚本会删除 ComputerBinding / ComputerBindingAudit 两张表及其全部数据，
--      回滚前如需保留审计，请先自行导出；
--   2. 不触碰任何旧 Desktop 表、Browser POS、订单、支付、商品等既有对象；
--      对 Store 只删除本迁移新增的 (id, tenantId) 复合唯一索引，不改动其它约束；
--   3. 回滚后需同步把 _prisma_migrations 中该条记录删除，否则 migrate deploy
--      会认为该迁移已应用而跳过。

BEGIN;

-- 1. 先删外键（子表 → 父表顺序）
ALTER TABLE "ComputerBindingAudit" DROP CONSTRAINT IF EXISTS "ComputerBindingAudit_actorUserId_fkey";
ALTER TABLE "ComputerBindingAudit" DROP CONSTRAINT IF EXISTS "ComputerBindingAudit_bindingId_fkey";
ALTER TABLE "ComputerBindingAudit" DROP CONSTRAINT IF EXISTS "ComputerBindingAudit_storeId_fkey";
ALTER TABLE "ComputerBindingAudit" DROP CONSTRAINT IF EXISTS "ComputerBindingAudit_tenantId_fkey";

ALTER TABLE "ComputerBinding" DROP CONSTRAINT IF EXISTS "ComputerBinding_decidedByUserId_fkey";
ALTER TABLE "ComputerBinding" DROP CONSTRAINT IF EXISTS "ComputerBinding_storeId_tenantId_fkey";
ALTER TABLE "ComputerBinding" DROP CONSTRAINT IF EXISTS "ComputerBinding_tenantId_fkey";

-- 2. 删表（索引随表一起删除）
DROP TABLE IF EXISTS "ComputerBindingAudit";
DROP TABLE IF EXISTS "ComputerBinding";

-- 3. 删除本迁移为 Store 新增的复合唯一索引（Store 其余结构不动）
DROP INDEX IF EXISTS "Store_id_tenantId_key";

-- 4. 删除枚举类型
DROP TYPE IF EXISTS "ComputerCredentialStatus";
DROP TYPE IF EXISTS "ComputerBindingStatus";

-- 5. 清除迁移记录，使该迁移可被重新应用
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260728120000_add_computer_client_binding';

COMMIT;
