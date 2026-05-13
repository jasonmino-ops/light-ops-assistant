# Supabase 数据库备份说明 — Beta v1.0

## 元信息

| 项 | 值 |
|----|----|
| 备份时间 | 2026-05-14 |
| 数据库项目 | `grkkevuebaaramqvuocd`（Supabase） |
| 区域 | aws-1-ap-southeast-1 |
| 数据库版本 | PostgreSQL 17.6 |
| 导出工具 | pg_dump 18.3（macOS / libpq） |
| 连接方式 | PgBouncer Transaction Pool（6543） |
| 关联 git commit | `6da913a` |
| 关联 tag | `beta-v1.0-commercial-trial` |

## 文件清单

| 文件 | 内容 | 行数 | 用途 |
|------|------|------|------|
| `schema.sql` | public schema 完整 DDL（表 / 索引 / 约束 / 序列 / 注释） | 1258 | 结构基线 |
| `full_backup.sql` | DDL + 全部数据（COLUMN INSERTS 格式） | 3533 | 完整恢复 |
| `key_tables_data.sql` | 仅业务表数据（无 DDL） | 964 | 部分数据恢复 |

## 关键业务表行数快照（截至备份时间）

| 表 | 行数 | 说明 |
|----|------|------|
| Tenant | 18 | 商户 |
| Store | 19 | 门店 |
| User | 37 | OWNER / STAFF |
| UserStoreRole | 37 | 角色绑定 |
| Product | 339 | 商品 |
| ProductCategory | 5 | 商品分类 |
| SaleRecord | 163 | 销售/退款单 |
| PaymentIntent | 45 | KHQR 支付意图 |
| MerchantPaymentConfig | 2 | 商户 KHQR 配置 |
| CustomerOrder | 51 | H5 顾客订单 |
| StoreCustomerContact | 4 | 顾客 TG 绑定 |
| BindToken | 110 | 邀请码 |
| StoreApplication | 12 | 开店申请 |
| TelegramMessage | 242 | 消息日志 |
| OperationLog | 134 | 操作审计 |
| SupportSession | 3 | 客服会话 |
| OpsAdmin | 1 | 运营管理员 |
| _prisma_migrations | 5 | Prisma 迁移记录 |

## 导出方式（脚本可重跑）

```bash
PGPASSWORD="<DB_PWD>" pg_dump \
  "postgresql://postgres.<PROJECT_REF>@<POOLER_HOST>:6543/postgres?sslmode=require" \
  --schema-only --no-owner --no-privileges --schema=public \
  > backups/beta_v1_0/schema.sql

PGPASSWORD="<DB_PWD>" pg_dump \
  "postgresql://postgres.<PROJECT_REF>@<POOLER_HOST>:6543/postgres?sslmode=require" \
  --no-owner --no-privileges --column-inserts --schema=public \
  > backups/beta_v1_0/full_backup.sql
```

> 注：通过 PgBouncer Transaction Pool 跑 pg_dump 成功。**未来若数据量增大** (CustomerOrder / SaleRecord 进入万级)，建议切换到 DIRECT_URL（5432 端口）以提高速度并避免 PgBouncer 超时。当前实例 DIRECT_URL 在本机不可直连（P1001），需在云端或开通公网直连后使用。

## 恢复建议

### 全量恢复到同一项目（覆盖现库 — 危险！）

```bash
# 1. 先 drop 现 public schema（仅当确定要清空）
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 2. 应用 full_backup.sql
psql "$DATABASE_URL" -f backups/beta_v1_0/full_backup.sql
```

### 恢复到新 Supabase 项目（推荐做法）

```bash
# 1. 新建空 Supabase 项目，拿到新 DATABASE_URL
# 2. 应用结构 + 数据
psql "$NEW_DATABASE_URL" -f backups/beta_v1_0/full_backup.sql
# 3. 跑 Prisma generate（保证 client 与 schema 对齐）
npx prisma generate
# 4. 在 Vercel 把 DATABASE_URL 切到新项目并触发新部署
```

### 仅恢复结构（应急重建）

```bash
psql "$DATABASE_URL" -f backups/beta_v1_0/schema.sql
```

### 仅恢复部分业务表数据（保留现 schema）

```bash
psql "$DATABASE_URL" -f backups/beta_v1_0/key_tables_data.sql
```

## 注意事项

- 备份**包含敏感信息**：用户表 telegramId、商户 KHQR 配置等。**禁止提交到公开仓库**。本备份目录默认走 git（私有仓库 OK），如需开源请改放 `.gitignore`。
- `full_backup.sql` 的 INSERT 语句格式为 column-inserts，**可逐行执行**，事务失败时不影响其它表。
- 恢复前请先备份当前 DB（防回滚错乱）：
  ```bash
  PGPASSWORD="$DB_PWD" pg_dump "$DATABASE_URL" --no-owner --schema=public > pre-restore-snapshot.sql
  ```
- 恢复后需重跑 Prisma migrate baseline（如有未应用迁移）或手工对照 `prisma/schema.prisma` 检查字段。
- Supabase Storage（`product-images` bucket）**不在本备份范围内**，需通过 Supabase Dashboard → Storage → 备份对应 bucket 文件。

## 后续备份建议

- 商业试跑阶段：**每周日 00:00 UTC 自动 pg_dump** → 推到 S3 或 Vercel Blob
- 重大版本发布前：手动执行一次完整 dump 并打 git tag 关联
- 客户数据增长后：评估切到 Supabase 自带的 PITR（Point-in-Time Recovery，需付费版）
