-- ────────────────────────────────────────────────────────────────────────────
-- C 类 grant 模板：顾客 ↔ 商户混合
-- 适用：CustomerOrder, StoreCustomerContact 等顾客匿名写 + 商户读的表
-- 把 <TABLE> 替换为本次新表名（保留引号）
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public."<TABLE>" TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public."<TABLE>" TO authenticated;

-- anon 默认完全禁止；后续如需顾客 supabase-js 直查/直写，按 RLS 模板 12 加 policy 后再开
REVOKE ALL ON public."<TABLE>" FROM anon;
