# OPS SUPER_ADMIN 应急恢复（Supabase 硬兜底）

> 适用场景：
> - 唯一 SUPER_ADMIN 的密码全丢 + Telegram 也无法登录
> - OpsAdmin 表被误删 / 全员 status='DISABLED'
> - 主管理员 cookie 被盗，需要立刻强制下线所有 OPS session

本文档 **只通过 Supabase SQL Editor 执行**，不暴露任何 HTTP 后门。
执行账号必须是项目 owner / service_role。

---

## 1. 强制踢出所有 OPS 旧 cookie

```sql
-- 任何一处 sessionVersion 与 cookie 不一致即 403
UPDATE "OpsAdmin" SET "sessionVersion" = "sessionVersion" + 1;
```

完成后所有 OPS 用户被踢回 `/ops/login`，重新登录即可拿到新 session。

## 2. 重置某个 SUPER_ADMIN 的密码

```bash
# 本地生成 scrypt 密码 hash（与 lib/password.ts 一致）
node -e "
const c = require('crypto');
const pw = 'NEW_STRONG_PASSWORD_HERE';
const salt = c.randomBytes(16).toString('hex');
const buf  = c.scryptSync(pw, salt, 64).toString('hex');
console.log('scrypt:' + salt + ':' + buf);
"
```

把上面输出贴到 SQL：
```sql
UPDATE "OpsAdmin"
   SET "passwordHash"      = '<刚生成的 scrypt:salt:hash>',
       "sessionVersion"    = "sessionVersion" + 1,
       "failedLoginCount"  = 0,
       "lockedUntil"       = NULL,
       "status"            = 'ACTIVE'
 WHERE username = '<目标用户名>';
```

## 3. 解除 / 换绑 Telegram

```sql
-- 解绑（让被盗 Telegram 无法登录）
UPDATE "OpsAdmin"
   SET "telegramId"     = NULL,
       "sessionVersion" = "sessionVersion" + 1
 WHERE username = '<目标用户名>';

-- 换绑新 Telegram（先确认新 telegramId 未被占用）
UPDATE "OpsAdmin"
   SET "telegramId"     = '<新 telegramId>',
       "sessionVersion" = "sessionVersion" + 1
 WHERE username = '<目标用户名>';
```

## 4. 表为空 / 全员 DISABLED：从零重建 SUPER_ADMIN

按 §2 生成 hash，然后：
```sql
INSERT INTO "OpsAdmin"
  (id, name, username, "passwordHash", role, status, "sessionVersion",
   "failedLoginCount", "lockedUntil", "createdAt", "updatedAt")
VALUES
  (substr(md5(random()::text), 1, 25),
   'Super Admin Recovery',
   '<新用户名>',
   '<scrypt:salt:hash>',
   'SUPER_ADMIN', 'ACTIVE', 0, 0, NULL, NOW(), NOW())
ON CONFLICT (username) DO NOTHING;
```

## 5. 解除登录锁定（误锁后立刻可用）

```sql
UPDATE "OpsAdmin"
   SET "failedLoginCount" = 0,
       "lockedUntil"      = NULL
 WHERE username = '<目标用户名>';
```

---

## 操作纪律

- 每次执行后请在 OPS 后台 `/ops/admins` 复核结果。
- 所有由 SQL 直接发起的恢复 **不会** 自动写入 `OperationLog`；请事后人工创建一条说明（或本地登记），便于审计。
- 恢复完成后立刻：
  1. 用新密码登录验证。
  2. 把临时密码改为长期复杂密码。
  3. 通过 OPS 面板对其它 SUPER_ADMIN 账号也 `bump sessionVersion`，关闭异常窗口。

## 不允许的事

- ❌ 写 secret URL 后门
- ❌ 改 `lib/ops-auth.ts` 放行任意 OWNER
- ❌ 设 `OPS_USER_IDS=*` 或留空当通配
- ❌ 把 `OPS_PASSWORD` 长期留在 Vercel env（恢复完成后立刻删除并把 `OPS_AUTO_SEED` 关闭）
