# 数据库迁移规范

## 原则

- **迁移与 build 分离**：`npm run build`（Vercel 部署）不自动执行迁移，避免迁移失败阻断发布。
- **迁移单独手动执行**：每次 schema 变更后，在本地或 CI 中单独跑一次 `migrate:prod`。
- **使用直连**：Prisma migrate 不兼容 Supabase 连接池（PgBouncer），必须使用 `DIRECT_URL`（端口 5432）而非 `DATABASE_URL`（端口 6543 pooler）。

---

## 有 schema 变更时的操作顺序

```bash
# 1. 本地编写并生成迁移文件（不连生产库）
npx prisma migrate dev --name <描述>
# 示例：npx prisma migrate dev --name add_store_application

# 2. 确认 DIRECT_URL 已在当前 shell 或 .env 中设置
#    DIRECT_URL = Vercel 环境变量里的 DIRECT_URL（Supabase 直连，端口 5432）
#    可从 Vercel Dashboard → Settings → Environment Variables 复制

# 3. 执行生产迁移（直连 Supabase，绕过 PgBouncer）
DIRECT_URL=postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres \
  npm run migrate:prod

# 或者先 export 再执行：
export DIRECT_URL=postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres
npm run migrate:prod

# 4. 确认迁移成功后，正常 push 代码，Vercel 自动触发 build（只跑 next build）
git push
```

---

## migrate:prod 脚本说明

```json
"migrate:prod": "DATABASE_URL=$DIRECT_URL prisma migrate deploy"
```

- 将 shell 中的 `$DIRECT_URL` 临时覆盖为 `DATABASE_URL`，Prisma CLI 用此直连执行迁移。
- 幂等：已执行过的迁移会跳过，不会重复执行。
- 只适用于 macOS / Linux shell；Windows 请用 `cross-env DIRECT_URL=xxx npm run migrate:prod`。

---

## 常见迁移表（历史记录）

| 迁移文件 | 内容 |
|---------|------|
| `20260331071511_init` | 初始建表 |
| `20260405000000_add_ops_admin` | OpsAdmin 表 |
| `20260406000000_add_daily_summaries` | 每日汇总表 |
| `20260407000000_add_store_application` | StoreApplication 表（开店申请） |
| `20260407000000_add_telegram_messages` | TelegramMessage 表（消息发送日志） |
