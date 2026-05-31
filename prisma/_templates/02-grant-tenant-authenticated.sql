-- ────────────────────────────────────────────────────────────────────────────
-- B 类 grant 模板：商户业务（OWNER / STAFF）
-- 适用：Tenant, User, UserStoreRole, SaleRecord, MerchantPaymentConfig 等
-- 把 <TABLE> 替换为本次新表名（保留引号）
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public."<TABLE>" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."<TABLE>" TO service_role;

-- 显式撤销 anon（防御 Supabase 未来扩大默认权限）
REVOKE ALL ON public."<TABLE>" FROM anon;
