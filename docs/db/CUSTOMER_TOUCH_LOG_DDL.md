# CustomerTouchLog — 手动 DDL 记录

> ⚠️ **本表通过 psql 直连 PgBouncer pooler 手动建立，未经过 Prisma migration**。
> 灾备恢复 / 新环境部署时**必须**先在 Supabase SQL Editor 或 psql 执行下方 DDL，
> 否则 /customers 触达功能将 500。

## 1. 元信息

| 项 | 值 |
|----|----|
| 表名 | `public."CustomerTouchLog"` |
| 创建时间 | 2026-05-15 |
| 创建方式 | psql 直连 PgBouncer pooler（6543）执行 `CREATE TABLE IF NOT EXISTS` |
| 关联 commit | `c2f633b` — `feat: /customers 单顾客 Telegram 触达最小闭环` |
| 关联 Prisma 模型 | `prisma/schema.prisma` 末尾 `model CustomerTouchLog`（已同步） |
| 关联代码 | `app/api/customers/touch/route.ts` |
| 业务用途 | 商户 OWNER 主动触达本店已绑定 Telegram 顾客的日志（含 24h 节流查询） |

## 2. 为什么手动 DDL 而非 Prisma migrate

- 项目使用 Supabase + PgBouncer **Transaction Pool**（端口 6543），Prisma migrate 需要 advisory lock 与持久会话，在事务模式 pooler 下经常 **卡死**（无错误输出，进程悬挂）
- Supabase 直连端口 5432（DIRECT_URL）在某些区域 / 网络下不可达（P1001），无法稳定跑 migrate
- 解决方案：所有 DDL 改用 psql 直接 ALTER / CREATE，在同一脚本内附加 grant / index，事后同步更新 `prisma/schema.prisma` + `npx prisma generate`
- 详见 `docs/SUPABASE_PERMISSIONS_FREEZE_v1.md` §6 Prisma migration 收尾约定

## 3. 字段定义

| 字段 | 类型 | 可空 | 默认 | 说明 |
|------|------|------|------|------|
| `id` | TEXT | NOT NULL | — | 主键，应用层用 `cuid()` 生成 |
| `tenantId` | TEXT | NOT NULL | — | 所属商户 |
| `storeId` | TEXT | NULL | — | 所属门店（顾客可能跨多店，按 storeCode → store 反查写入） |
| `telegramId` | TEXT | NOT NULL | — | 顾客 Telegram ID（来自 StoreCustomerContact） |
| `templateKey` | TEXT | NOT NULL | — | `THANK_YOU` / `PROMO` / `ORDER_CARE` |
| `messageText` | TEXT | NOT NULL | — | 实际发送的渲染后文案（含 zh/en/km 自动选择） |
| `status` | TEXT | NOT NULL | — | `SENT` / `FAILED` / `THROTTLED` |
| `errorMessage` | TEXT | NULL | — | Telegram API 报错文案（如 'chat not found'） |
| `sentByUserId` | TEXT | NOT NULL | — | 触发触达的 OWNER 用户 ID（来自 `getContext().userId`） |
| `sentAt` | TIMESTAMP(3) | NOT NULL | `CURRENT_TIMESTAMP` | 发送时间，节流查询的核心字段 |
| `createdAt` | TIMESTAMP(3) | NOT NULL | `CURRENT_TIMESTAMP` | 记录创建时间 |

## 4. 索引

| 索引名 | 列 | 用途 |
|--------|----|------|
| `CustomerTouchLog_pkey` | `id` | 主键（自动） |
| `CustomerTouchLog_tenantId_telegramId_sentAt_idx` | `(tenantId, telegramId, sentAt)` | **节流查询**：24h 内同顾客同模板未发送过 |
| `CustomerTouchLog_sentByUserId_idx` | `sentByUserId` | OWNER 追溯发送历史 |

## 5. 权限策略（Supabase 权限治理 v1 — D 类 / 系统审计）

| 角色 | 权限 |
|------|------|
| `postgres`（应用运行时连接） | 全权（超级用户 BYPASS） |
| `service_role` | SELECT / INSERT / UPDATE / DELETE |
| `authenticated` | **REVOKE ALL** |
| `anon` | **REVOKE ALL** |
| RLS | 未启用（与现有 22 张业务表保持一致） |

理由：触达日志包含 telegramId、操作人 userId、消息全文，**严禁**前端直查；统一走服务端 API（OWNER 守卫 + 跨租户校验）。

## 6. 完整 DDL（可重跑、幂等）

```sql
-- ============================================================================
-- CustomerTouchLog 完整 DDL
-- 适用：新环境部署 / 灾备恢复 / 重建 Supabase 项目
-- 重跑安全：所有语句带 IF NOT EXISTS / IF EXISTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS "CustomerTouchLog" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL,
  "storeId"      TEXT,
  "telegramId"   TEXT NOT NULL,
  "templateKey"  TEXT NOT NULL,
  "messageText"  TEXT NOT NULL,
  "status"       TEXT NOT NULL,
  "errorMessage" TEXT,
  "sentByUserId" TEXT NOT NULL,
  "sentAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CustomerTouchLog_tenantId_telegramId_sentAt_idx"
  ON "CustomerTouchLog"("tenantId", "telegramId", "sentAt");

CREATE INDEX IF NOT EXISTS "CustomerTouchLog_sentByUserId_idx"
  ON "CustomerTouchLog"("sentByUserId");

-- Supabase 权限治理 v1（D 类 / 系统审计）：仅 service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CustomerTouchLog" TO service_role;
REVOKE ALL ON public."CustomerTouchLog" FROM anon;
REVOKE ALL ON public."CustomerTouchLog" FROM authenticated;
```

## 7. 执行方式（两种均可，结果一致）

### 方式 A — Supabase Dashboard SQL Editor（推荐，最稳）
1. 登录 Supabase Dashboard → Project `grkkevuebaaramqvuocd`
2. 左栏 **SQL Editor** → New query
3. 粘贴 §6 完整 DDL → Run
4. 全部语句应返回 `Success. No rows returned`

### 方式 B — psql 直连 PgBouncer pooler
```bash
PGPASSWORD="<DB_PWD>" psql \
  "postgresql://postgres.<PROJECT_REF>@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require" \
  -f docs/db/CUSTOMER_TOUCH_LOG_DDL_inline.sql   # 或直接粘贴 §6 块
```

执行后应输出：
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
GRANT
REVOKE
REVOKE
```

## 8. 验证（执行后必须跑）

```bash
# 8.1 表存在
PGPASSWORD="$DB_PWD" psql "$DATABASE_URL" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_name = 'CustomerTouchLog';"
# 期望：1

# 8.2 索引存在
PGPASSWORD="$DB_PWD" psql "$DATABASE_URL" -c \
  "SELECT indexname FROM pg_indexes WHERE tablename = 'CustomerTouchLog';"
# 期望：3 个（pkey + 2 idx）

# 8.3 权限正确（service_role 4 项，anon/auth 应空）
PGPASSWORD="$DB_PWD" psql "$DATABASE_URL" -c \
  "SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
     FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name = 'CustomerTouchLog'
      AND grantee IN ('anon','authenticated','service_role')
    GROUP BY grantee;"
# 期望：仅 service_role 一行，privs='DELETE,INSERT,SELECT,UPDATE'

# 8.4 应用层联通（生产或本地）
# 打开 /customers，选一个 bound 顾客触发触达 → 应成功 → 表内多一行 status='SENT'
PGPASSWORD="$DB_PWD" psql "$DATABASE_URL" -c \
  "SELECT count(*) FROM \"CustomerTouchLog\";"
```

## 9. 灾备恢复时的位置

- **阶段一·底层** 中执行（`docs/freezes/BETA_V1_0_FULL_STACK_DISASTER_RECOVERY.md`）：
  在 `psql -f full_backup.sql` **之前** 或 **之后**都可（IF NOT EXISTS 幂等）
  推荐：full_backup.sql 应该已经包含该表（若备份时已存在）→ 重复执行无害
  如果是从 `schema.sql`（裸结构）恢复 → 必须额外执行本 DDL

## 10. 后续若需要走 Prisma migrate baseline

```bash
# 1. 确保 prisma/schema.prisma 中 model CustomerTouchLog 与本文档一致
# 2. 标记本表为已应用（baseline）
npx prisma migrate resolve --applied <YOUR_MIGRATION_NAME>
# 或在 Supabase SQL Editor 手动插入 _prisma_migrations 表对应行
```

本步骤**不强制**做，因为整个项目当前已是"DDL 手动 + schema.prisma 同步 + generate"的稳态。

---

**维护人**：jasonmino
**最近更新**：2026-05-15
**关联 PR**：commit `c2f633b`
