-- ────────────────────────────────────────────────────────────────────────────
-- A 类 grant 模板：顾客 H5 / 公开菜单 / 公开查询
-- 适用：Store, Product, ProductCategory 等顾客匿名读取的表
-- 把 <TABLE> 替换为本次新表名（保留引号）
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT                          ON public."<TABLE>" TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public."<TABLE>" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public."<TABLE>" TO service_role;

-- 显式禁止 anon 写入（防御）
REVOKE INSERT, UPDATE, DELETE ON public."<TABLE>" FROM anon;
