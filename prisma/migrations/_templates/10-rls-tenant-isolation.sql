-- ────────────────────────────────────────────────────────────────────────────
-- RLS 模板 — 租户隔离最小集
-- 前提：JWT 含 tenant_id claim；本表有 "tenantId" 列
-- service_role BYPASS RLS（无需 policy）；postgres 超级用户也 BYPASS
-- 把 <TABLE> 替换为本次新表名（保留引号）；<table_slug> 替换为小写下划线名
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."<TABLE>" ENABLE ROW LEVEL SECURITY;
-- 注意：不加 FORCE，让 service_role / postgres 仍 BYPASS

-- 同租户读
CREATE POLICY "<table_slug>_tenant_select"
  ON public."<TABLE>"
  FOR SELECT
  TO authenticated
  USING ("tenantId" = (auth.jwt() ->> 'tenant_id'));

-- 同租户写（INSERT/UPDATE/DELETE）
CREATE POLICY "<table_slug>_tenant_modify"
  ON public."<TABLE>"
  FOR ALL
  TO authenticated
  USING ("tenantId" = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK ("tenantId" = (auth.jwt() ->> 'tenant_id'));
