-- ────────────────────────────────────────────────────────────────────────────
-- D 类 grant 模板：系统 / 审计 / Session（service_role only）
-- 适用：OperationLog, TelegramMessage, OpsAdmin, *DailySummary, *Session 等
-- 把 <TABLE> 替换为本次新表名（保留引号）
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public."<TABLE>" TO service_role;

-- 严格禁止 anon / authenticated
REVOKE ALL ON public."<TABLE>" FROM anon;
REVOKE ALL ON public."<TABLE>" FROM authenticated;
