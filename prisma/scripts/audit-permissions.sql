-- ────────────────────────────────────────────────────────────────────────────
-- Supabase 权限审计脚本
-- 用法：PGPASSWORD=<pwd> psql "<DATABASE_URL>" -f prisma/scripts/audit-permissions.sql
-- 输出 4 个报表：
--   1) 各表对 anon/authenticated/service_role 的显式权限
--   2) RLS 启用状态
--   3) RLS policy 列表
--   4) 序列权限（如有）
-- ────────────────────────────────────────────────────────────────────────────

\echo '== [1/4] Table privileges by role =='
SELECT
  table_name,
  grantee,
  string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

\echo ''
\echo '== [2/4] RLS status per table =='
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

\echo ''
\echo '== [3/4] RLS policies =='
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

\echo ''
\echo '== [4/4] Sequence privileges =='
SELECT
  object_name AS sequence_name,
  grantee,
  privilege_type
FROM information_schema.usage_privileges
WHERE object_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY object_name, grantee;
