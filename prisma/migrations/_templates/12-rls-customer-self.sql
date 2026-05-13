-- ────────────────────────────────────────────────────────────────────────────
-- RLS 模板 — C 类顾客自查
-- 适用：CustomerOrder, StoreCustomerContact 等顾客只能查自己的数据
-- 前提：JWT 含 tg_id claim（Telegram ID）；本表有 "customerTelegramId" 或 "telegramId" 列
-- 把 <TABLE> 替换为本次新表名；<KEY> 替换为对应列名（如 "customerTelegramId" / "telegramId"）
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."<TABLE>" ENABLE ROW LEVEL SECURITY;

-- 顾客只读自己的记录
CREATE POLICY "<table_slug>_self_select"
  ON public."<TABLE>"
  FOR SELECT
  TO authenticated
  USING ("<KEY>" = (auth.jwt() ->> 'tg_id'));

-- 顾客匿名下单（公开 INSERT）— 仅在确实允许 supabase-js 直写时启用，否则继续走服务端中转
-- CREATE POLICY "<table_slug>_anon_insert"
--   ON public."<TABLE>"
--   FOR INSERT
--   TO anon
--   WITH CHECK (true);
