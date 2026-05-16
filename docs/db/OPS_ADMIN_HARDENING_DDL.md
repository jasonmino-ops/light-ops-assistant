# OpsAdmin 安全加固 DDL（手动执行）

Supabase SQL Editor 跑（幂等）。完成后 `npx prisma generate`。

```sql
ALTER TABLE "OpsAdmin"
  ADD COLUMN IF NOT EXISTS "sessionVersion"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil"      TIMESTAMPTZ;
```

回滚：
```sql
ALTER TABLE "OpsAdmin"
  DROP COLUMN IF EXISTS "sessionVersion",
  DROP COLUMN IF EXISTS "failedLoginCount",
  DROP COLUMN IF EXISTS "lockedUntil";
```

## 字段语义

- `sessionVersion`：登录签 session 时把当前值写入 `opsSessionVersion`。
  改密码 / 解绑 / 换绑 telegram / 禁用账号 / 强制下线时 +1，旧 cookie 立刻失效。
- `failedLoginCount`：`/api/ops/login` 错误密码累计；成功后清零。
- `lockedUntil`：达到 5 次失败时设为 `now() + 15min`；命中时直接拒登。
