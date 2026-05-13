-- ────────────────────────────────────────────────────────────────────────────
-- RLS 模板 — A 类公开表 anon 全表读
-- 适用：Store, Product, ProductCategory 等顾客 H5 公开查询表
-- 把 <TABLE> 替换为本次新表名（保留引号）；<table_slug> 替换为小写下划线名
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."<TABLE>" ENABLE ROW LEVEL SECURITY;

-- anon 可读全表（公开数据，本来就跨租户访问）
CREATE POLICY "<table_slug>_public_read"
  ON public."<TABLE>"
  FOR SELECT
  TO anon
  USING (true);

-- authenticated 同样可读（含商户后台）
CREATE POLICY "<table_slug>_authenticated_read"
  ON public."<TABLE>"
  FOR SELECT
  TO authenticated
  USING (true);

-- 写操作仅 service_role + postgres（无需 policy，BYPASS）
