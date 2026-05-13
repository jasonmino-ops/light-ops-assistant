-- ────────────────────────────────────────────────────────────────────────────
-- 现有 22 张表 grant 回填脚本（可选 / 手动执行）
--
-- 设计原则：
--   * 对当前应用零影响（应用走 postgres 超级用户连接，BYPASS 全部权限）
--   * 为未来 supabase-js / authenticated / Supabase 默认变更预先对齐基线
--
-- 用法：
--   PGPASSWORD=<pwd> psql "<DATABASE_URL>" -f prisma/scripts/backfill-existing-tables.sql
--
-- 验证：
--   PGPASSWORD=<pwd> psql "<DATABASE_URL>" -f prisma/scripts/audit-permissions.sql
--
-- 参考：docs/SUPABASE_PERMISSIONS_FREEZE_v1.md §7
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── A 类：顾客公开读 ────────────────────────────────────────────────────────
GRANT SELECT                          ON public."Store"           TO anon;
GRANT SELECT                          ON public."Product"         TO anon;
GRANT SELECT                          ON public."ProductCategory" TO anon;
REVOKE INSERT, UPDATE, DELETE         ON public."Store"           FROM anon;
REVOKE INSERT, UPDATE, DELETE         ON public."Product"         FROM anon;
REVOKE INSERT, UPDATE, DELETE         ON public."ProductCategory" FROM anon;

-- ── A/B/C 类共同：authenticated + service_role CRUD ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Store"           TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Product"         TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductCategory" TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Tenant"          TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."User"            TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."UserStoreRole"   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SaleRecord"      TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."MerchantPaymentConfig" TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."PaymentIntent"   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."BindToken"       TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StoreApplication" TO authenticated, service_role;

-- ── B 类：anon 显式撤销 ────────────────────────────────────────────────────
REVOKE ALL ON public."Tenant"           FROM anon;
REVOKE ALL ON public."User"             FROM anon;
REVOKE ALL ON public."UserStoreRole"    FROM anon;
REVOKE ALL ON public."SaleRecord"       FROM anon;
REVOKE ALL ON public."MerchantPaymentConfig" FROM anon;
REVOKE ALL ON public."PaymentIntent"    FROM anon;
REVOKE ALL ON public."BindToken"        FROM anon;
REVOKE ALL ON public."StoreApplication" FROM anon;

-- ── C 类：顾客 ↔ 商户混合 ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CustomerOrder"        TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public."CustomerOrder"        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StoreCustomerContact" TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public."StoreCustomerContact" TO authenticated;
REVOKE ALL ON public."CustomerOrder"        FROM anon;
REVOKE ALL ON public."StoreCustomerContact" FROM anon;

-- ── D 类：仅 service_role ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OperationLog"         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TelegramMessage"      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TenantDailySummary"   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StoreDailySummary"    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductImportSession" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."KhqrConfigSession"    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SupportSession"       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OpsAdmin"             TO service_role;

REVOKE ALL ON public."OperationLog"         FROM anon, authenticated;
REVOKE ALL ON public."TelegramMessage"      FROM anon, authenticated;
REVOKE ALL ON public."TenantDailySummary"   FROM anon, authenticated;
REVOKE ALL ON public."StoreDailySummary"    FROM anon, authenticated;
REVOKE ALL ON public."ProductImportSession" FROM anon, authenticated;
REVOKE ALL ON public."KhqrConfigSession"    FROM anon, authenticated;
REVOKE ALL ON public."SupportSession"       FROM anon, authenticated;
REVOKE ALL ON public."OpsAdmin"             FROM anon, authenticated;

COMMIT;

\echo '✓ Backfill applied. Run audit-permissions.sql to verify.'
