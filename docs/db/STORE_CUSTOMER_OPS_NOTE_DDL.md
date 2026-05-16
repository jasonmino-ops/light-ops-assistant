# StoreCustomerContact.opsNote DDL（手动执行）

Supabase SQL Editor 跑（幂等）。完成后 `npx prisma generate`。

```sql
ALTER TABLE "StoreCustomerContact"
  ADD COLUMN IF NOT EXISTS "opsNote" TEXT;
```

回滚：
```sql
ALTER TABLE "StoreCustomerContact" DROP COLUMN IF EXISTS "opsNote";
```

## 状态字段扩展（无需 DDL）

`StoreCustomerContact.status` 取值范围扩展为：
- `active`：正常
- `flagged`：OPS 标记异常（老板端仍可见，前端可选择标识）
- `revoked`：OPS 解除错误绑定（老板端聚合时按需过滤）

仅写入策略变化，不改字段类型。
