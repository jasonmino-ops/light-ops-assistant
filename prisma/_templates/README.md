# Migration grant 模板

每张新 public 表 migration 必须以下方四个模板之一收尾。详见 [`/docs/SUPABASE_PERMISSIONS_FREEZE_v1.md`](../../../docs/SUPABASE_PERMISSIONS_FREEZE_v1.md)。

| 文件 | 适用场景 |
|------|----------|
| `01-grant-public-anon.sql`        | A 类：顾客 H5 / 公开菜单 / 公开查询 |
| `02-grant-tenant-authenticated.sql` | B 类：商户业务（OWNER / STAFF） |
| `03-grant-customer-mixed.sql`     | C 类：顾客 ↔ 商户混合 |
| `04-grant-system-service-role.sql` | D 类：系统 / 审计 / Session |
| `10-rls-tenant-isolation.sql`     | 跨租户隔离 RLS policy 样板 |
| `11-rls-public-read.sql`          | A 类表的 anon RLS 读策略 |
| `12-rls-customer-self.sql`        | C 类顾客自查订单 RLS |

**使用**：
1. 复制对应 `.sql` 内容到本次 migration 末尾
2. 把 `<TABLE>` 替换为实际表名（保留引号）
3. 若涉及多张表，重复粘贴块
