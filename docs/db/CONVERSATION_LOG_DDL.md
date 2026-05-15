# ConversationLog DDL（手动执行）

顾客 bot 三层对话日志表。Supabase SQL Editor 跑下方 SQL（安全幂等）。

执行后回到本地跑 `npx prisma generate` 让 Prisma Client 包含 `ConversationLog`。

## 建表

```sql
CREATE TABLE IF NOT EXISTS "ConversationLog" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT,
  "storeCode"    TEXT,
  "telegramId"   TEXT NOT NULL,
  "lang"         TEXT,
  "direction"    TEXT NOT NULL,            -- IN | OUT
  "text"         TEXT NOT NULL,
  "intentLayer"  INTEGER,
  "intentSlot"   TEXT,
  "intentSource" TEXT,                     -- RISK / BIZ / CHAT / FALLBACK_SHORT / FALLBACK_UNKNOWN / VOICE / RATE_LIMIT
  "escalated"    BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ConversationLog_tg_createdAt_idx"
  ON "ConversationLog" ("telegramId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationLog_tenant_createdAt_idx"
  ON "ConversationLog" ("tenantId", "createdAt");
```

## 回滚

```sql
DROP TABLE IF EXISTS "ConversationLog";
```

## 字段语义

- `direction = IN` 顾客发来的消息；`OUT` bot 回复的消息。
- `intentLayer` 1 业务 / 2 闲聊 / 3 转人工（VOICE / RATE_LIMIT 也走特殊层 2/3）。
- `escalated = true` 表示触发了 OWNER 通知（高风险或长句兜底）。
- 建议保留 90 天后定期清理；查询通常按 `telegramId + createdAt` 倒序。
