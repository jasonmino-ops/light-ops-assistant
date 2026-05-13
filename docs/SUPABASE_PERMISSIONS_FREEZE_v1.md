# Supabase 权限兼容冻结 v1

**版本**：v1.0  生效日期：2026-05-13  适用项目：light-ops-assistant / 店小二

本文档为店小二系统数据库主线冻结项，**所有新增 Prisma migration / 手写 SQL / 新 SaaS 模块 / CRM / 支付 / 联盟平台 / 数字员工治理表 都必须遵循本规范**。

---

## 1. 背景与动机

Supabase 自 2025–2026 起调整 `public` schema 默认权限，从“隐式开放给 anon/authenticated”收紧为“显式 grant 才可访问”。本系统当前所有 Next.js API 通过 `postgres` 超级用户走 PgBouncer 连接（`DATABASE_URL`），尚未使用 supabase-js anon/authenticated 路径，**当前线上无故障**。

但若未来出现以下任一情况，将出现“部署成功但前端/客户端无法访问数据”的隐性事故：

- 任何模块切换到 supabase-js 直查（H5、Edge Function、Realtime、Webhook）
- Supabase 平台再次收紧 anon/authenticated 默认行为
- 切换至 Supabase Auth + RLS 治理用户隔离

本规范要求**所有未来新建表显式声明权限**，把权限作为数据库主线交付的一部分。

---

## 2. 现状审计（2026-05-13）

### 2.1 业务表清单（22 张，含 `_prisma_migrations`）

```
BindToken, CustomerOrder, KhqrConfigSession, MerchantPaymentConfig,
OperationLog, OpsAdmin, PaymentIntent, Product, ProductCategory,
ProductImportSession, SaleRecord, Store, StoreApplication,
StoreCustomerContact, StoreDailySummary, SupportSession,
TelegramMessage, Tenant, TenantDailySummary, User, UserStoreRole,
_prisma_migrations
```

### 2.2 权限当前状态

| 角色            | 显式 grant 表数 | 说明 |
|---------------- |---------------- |------|
| `anon`          | 0               | 顾客 H5 路径未来切 supabase-js 直查会全部失败 |
| `authenticated` | 0               | Supabase Auth 集成时立即失败 |
| `service_role`  | 0               | Edge Function / Webhook 切 supabase-js 时失败 |
| `postgres`      | (super)         | 现行应用走这条；当前可读写所有表 |

### 2.3 RLS 状态

- 所有 22 张表 `relrowsecurity = false`、`relforcerowsecurity = false`
- 无 RLS policy

### 2.4 风险评级

| 风险 | 等级 | 触发场景 |
|------|------|----------|
| anon 路径失效 | **高** | /m/[storeCode] 顾客 H5 若改 supabase-js 直查 menu/store 数据 |
| authenticated 路径失效 | **高** | 商户端若改用 Supabase Auth Cookie 替换自建 session |
| service_role 失效 | 中 | Webhook 改 supabase-js（如商户/顾客 bot 直查 DB） |
| 跨租户数据泄漏 | **高（一旦启用 RLS 模式）** | 未来切 supabase-js 后忘记加 tenantId policy |
| 系统表（OperationLog/OpsAdmin）被前端读到 | 高 | 未来若有人把所有表都 grant 给 anon |

---

## 3. 表分类规范

按业务路径把每张表归入一个类别。**类别决定 grant 模板**。

### A 类 — 公开（顾客 H5 / 公开查询）

`anon SELECT` + `authenticated CRUD` + `service_role CRUD`

只允许 SELECT 给 anon，**禁止 INSERT/UPDATE/DELETE 给 anon**（顾客下单写入走服务端 `service_role` 或 API 中转）。

当前应归类：
- `Store`（顾客扫码读门店名/banner/announcement/promo）
- `Product`（顾客菜单列表）
- `ProductCategory`（顾客菜单分类）

### B 类 — 商户业务（OWNER / STAFF）

`authenticated CRUD` + `service_role CRUD`（**不给 anon**）

当前应归类：
- `Tenant`, `User`, `UserStoreRole`
- `SaleRecord`, `MerchantPaymentConfig`, `PaymentIntent`
- `BindToken`, `StoreApplication`

### C 类 — 顾客 ↔ 商户混合

顾客匿名写 + 商户授权读。先用 `service_role CRUD` 走服务端 API；如未来直查需求出现再细化 RLS。

当前应归类：
- `CustomerOrder`（顾客 POST，商户 GET）
- `StoreCustomerContact`（顾客绑定，商户读）

### D 类 — 系统 / 审计 / Session（`service_role` only）

**禁止 anon / authenticated 任何权限**。

当前应归类：
- `OperationLog`、`TelegramMessage`
- `TenantDailySummary`, `StoreDailySummary`
- `ProductImportSession`, `KhqrConfigSession`, `SupportSession`
- `OpsAdmin`

---

## 4. 统一 grant 模板

每张新表的 migration 必须以下面 4 段之一收尾。SQL 模板位于 `prisma/migrations/_templates/`。

### 4.1 A 类（公开）

```sql
GRANT SELECT ON public."<Table>" TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."<Table>" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."<Table>" TO service_role;
```

### 4.2 B 类（商户业务）

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public."<Table>" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."<Table>" TO service_role;
-- 显式撤销 anon（防御 Supabase 未来扩大默认权限）
REVOKE ALL ON public."<Table>" FROM anon;
```

### 4.3 C 类（顾客 ↔ 商户混合，先服务端中转）

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public."<Table>" TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."<Table>" TO authenticated;
REVOKE ALL ON public."<Table>" FROM anon;
-- 后续如需顾客直查，再按 RLS 模板补 policy
```

### 4.4 D 类（系统 / 审计）

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public."<Table>" TO service_role;
REVOKE ALL ON public."<Table>" FROM anon;
REVOKE ALL ON public."<Table>" FROM authenticated;
```

### 4.5 序列权限（auto-increment / sequence；若该表有自增列才需要）

```sql
-- 仅当表使用 SERIAL / IDENTITY 时执行
GRANT USAGE, SELECT ON SEQUENCE public."<Table>_<col>_seq" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."<Table>_<col>_seq" TO service_role;
```

> 本项目所有主键用 `cuid()` 客户端生成，无 sequence；新表用 cuid 即可跳过本步。

---

## 5. RLS 模板（tenant 隔离最小集）

当一张表**未来允许 authenticated 角色直查**且需要按租户隔离时，按下列模板补 RLS。**当前应用走 `postgres` 超级用户 BYPASS RLS，启用 RLS 不会影响现有 API**。

### 5.1 启用 + 默认拒绝

```sql
ALTER TABLE public."<Table>" ENABLE ROW LEVEL SECURITY;
-- 不加 FORCE，让 service_role 仍可后台维护
```

### 5.2 同租户读写 policy（要求 JWT 含 `tenant_id` claim）

```sql
-- 读：当前 JWT 的 tenant_id 必须等于行的 tenantId
CREATE POLICY "<table>_tenant_select"
  ON public."<Table>"
  FOR SELECT
  TO authenticated
  USING ("tenantId" = (auth.jwt() ->> 'tenant_id'));

-- 写：插入/更新时强制 tenantId 等于 JWT 的 tenant_id
CREATE POLICY "<table>_tenant_modify"
  ON public."<Table>"
  FOR ALL
  TO authenticated
  USING ("tenantId" = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK ("tenantId" = (auth.jwt() ->> 'tenant_id'));
```

### 5.3 公开读 policy（A 类表）

```sql
-- A 类表 SELECT 不做 tenant 校验（顾客扫码本来就跨租户访问指定 storeCode）
CREATE POLICY "<table>_public_read"
  ON public."<Table>"
  FOR SELECT
  TO anon
  USING (true);
```

### 5.4 顾客自查自己订单 policy（C 类表）

```sql
-- 顾客只能读 customerTelegramId = 自己 JWT.tg_id 的订单
CREATE POLICY "customer_order_self_read"
  ON public."CustomerOrder"
  FOR SELECT
  TO authenticated
  USING ("customerTelegramId" = (auth.jwt() ->> 'tg_id'));
```

---

## 6. Prisma migration 收尾约定

Prisma 自动生成的 migration SQL 默认不包含 grant。**人工补 grant 的方式**：

1. 跑 `npx prisma migrate dev --create-only --name <feature>` 生成 SQL 文件但不执行
2. 打开 `prisma/migrations/<timestamp>_<feature>/migration.sql`
3. 在文件**末尾**追加对应类别的 grant SQL（参考 §4）
4. 跑 `npx prisma migrate dev` 应用 migration

如使用 psql 直接 ALTER（本项目因 PgBouncer 事务模式常用），DDL 后同一脚本必须包含 grant 收尾。

---

## 7. 当前 22 张表回填建议（可选 / 手动）

下方 SQL 为零风险回填脚本：对**当前应用无影响**（走 postgres 角色 BYPASS），但能提前对齐治理基线。完整版本见 `prisma/scripts/backfill-existing-tables.sql`。

**回填总策略**：所有表先 REVOKE FROM anon/authenticated（防御默认变更），再按分类显式 grant。

```sql
-- A 类：公开读
GRANT SELECT ON public."Store" TO anon;
GRANT SELECT ON public."Product" TO anon;
GRANT SELECT ON public."ProductCategory" TO anon;

-- A/B/C 类共同：authenticated + service_role CRUD
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Store"           TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Product"         TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductCategory" TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Tenant"          TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."User"            TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."UserStoreRole"   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SaleRecord"      TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."MerchantPaymentConfig" TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."PaymentIntent"   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."BindToken"       TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StoreApplication" TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CustomerOrder"   TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."CustomerOrder"           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StoreCustomerContact" TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."StoreCustomerContact"    TO authenticated;

-- D 类：仅 service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OperationLog"     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TelegramMessage"  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TenantDailySummary" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."StoreDailySummary"  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductImportSession" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."KhqrConfigSession"  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SupportSession"     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OpsAdmin"           TO service_role;

-- D 类显式 REVOKE
REVOKE ALL ON public."OperationLog"           FROM anon, authenticated;
REVOKE ALL ON public."TelegramMessage"        FROM anon, authenticated;
REVOKE ALL ON public."TenantDailySummary"     FROM anon, authenticated;
REVOKE ALL ON public."StoreDailySummary"      FROM anon, authenticated;
REVOKE ALL ON public."ProductImportSession"   FROM anon, authenticated;
REVOKE ALL ON public."KhqrConfigSession"      FROM anon, authenticated;
REVOKE ALL ON public."SupportSession"         FROM anon, authenticated;
REVOKE ALL ON public."OpsAdmin"               FROM anon, authenticated;
```

> 是否立即执行回填由维护者决定。本规范不强制现在跑，但**强制所有新 migration 遵循 §4**。

---

## 8. 验收与审计

- **审计脚本**：`prisma/scripts/audit-permissions.sql`
  ```bash
  PGPASSWORD=$DB_PWD psql "$DATABASE_URL" -f prisma/scripts/audit-permissions.sql
  ```
  输出当前每张表对 anon/authenticated/service_role 的 grant 列表与 RLS 状态。

- **PR 检查清单**（写入 Pull Request 模板）：
  - [ ] 本 PR 新建/修改了 public schema 表？若是，已按 §3 分类
  - [ ] migration SQL 末尾已追加 §4 grant 模板
  - [ ] 涉及租户隔离的表已按 §5 启用 RLS
  - [ ] 已用 `prisma/scripts/audit-permissions.sql` 验证生效

---

## 9. 演进路径（v2 预期方向）

- v2 引入 Supabase Auth + JWT `tenant_id` claim，全面打开 authenticated 路径
- v2 顾客 H5 可逐步切换到 supabase-js + anon SELECT + RLS（替代 Next.js API route 中转）
- v2 新增模块（CRM 联盟平台 / 数字员工 / 支付）一上线就遵循本规范，零迁移成本

---

**维护者**：jasonmino  上次更新：2026-05-13
