# 优惠券最小闭环手动 QA Runbook

配套验收清单：[`COUPON_E2E_ACCEPTANCE_CHECKLIST.md`](./COUPON_E2E_ACCEPTANCE_CHECKLIST.md)

本文档**不声明任何条目"已通过"**，仅提供逐条操作步骤、curl / SQL 模板、预期结果、排查方向。
真人验收完成后，请将结果回填到 ACCEPTANCE_CHECKLIST 对应条目。

---

## 0. 验收前准备

### 0.1 占位变量

请提前替换文中所有 `<…>` 占位符为真实值。

| 占位符 | 说明 | 示例 |
|---|---|---|
| `<STORE_CODE>` | 测试门店 code（StoreCustomerContact.storeCode） | `ABC123` |
| `<CUSTOMER_TG_ID>` | 测试顾客 telegramId（已 active 绑定本店） | `123456789` |
| `<OTHER_TENANT_TG_ID>` | 另一商户的某顾客 telegramId（用于跨店测试） | `999999999` |
| `<TENANT_ID>` | 当前 tenant id | `clxxxx...` |
| `<STORE_ID>` | 当前 store.id | `clyyyy...` |
| `<TEMPLATE_ID>` | C1 后获得的某模板 id | `clzzzz...` |
| `<COUPON_ID>` | C3 / C5 后获得的某券 id | `clpppp...` |
| `<ORDER_NO>` | C15 下单后获得的订单号 | `C-20260515-ABC123-0001` |
| `<BASE_URL>` | API 根（本地 / 生产） | `http://localhost:3000` |

### 0.2 OWNER 鉴权方式

本地：在 `apiFetch` 调用走的 dev headers，无需 cookie。手动 curl 时附加：
```
-H 'x-tenant-id: <TENANT_ID>'
-H 'x-user-id: <OWNER_USER_ID>'
-H 'x-store-id: <STORE_ID>'
-H 'x-role: OWNER'
```

生产：必须从 Telegram WebApp `/api/auth/telegram` 拿到 `auth-session` cookie，再附 `-H 'Cookie: auth-session=...'`。

下文 curl 模板用 `$OWNER_AUTH` 占位上述全部头/cookie，请按环境替换。

### 0.3 顾客 H5 身份

`/me` `/me/coupons` `/menu` 必须在 **Telegram WebApp 内打开**，否则 `tgId` 解析为空、`/api/customer/coupons` 走 NEED_TG 分支。普通浏览器仅适合 fallback 路径验收（C8）。

### 0.4 数据库连接

Supabase 后台 → SQL Editor，或本地：
```bash
psql "$DIRECT_URL" -c '...'
```

---

## 1. C1 — 模板 lazy seed 不重复

### 1.1 静态复核

- **API**：`app/api/coupons/templates/route.ts:9–43`
- **逻辑**：`findMany WHERE tenantId AND status IN (ACTIVE, PAUSED)` → 空时 `createMany` seed 3 张 → 再 findMany 返回。
- **风险点（非阻塞）**：`createMany` 不是 upsert，理论上同一商户首次同时多端访问可重复 seed。OWNER 单人首访场景不触发，验收前先确认该 tenant 未 seed 过。
- **状态**：✅ 已实现 / 需人工验证。

### 1.2 操作

```bash
# 第 1 次调用（首访 lazy seed）
curl -s "$BASE_URL/api/coupons/templates" $OWNER_AUTH | jq

# 第 2 次调用（不应再 seed）
curl -s "$BASE_URL/api/coupons/templates" $OWNER_AUTH | jq

# SQL 校验：行数应为 3，与两次响应中的 ids 一致
psql "$DIRECT_URL" -c "
SELECT id, name, \"amountOff\", \"minSpend\", \"validDays\", status
  FROM \"CouponTemplate\"
 WHERE \"tenantId\"='<TENANT_ID>'
 ORDER BY \"createdAt\";"
```

### 1.3 预期

- 两次响应 `templates[]` 长度均为 3，**id 完全相同**。
- DB 中该 `tenantId` 下 `CouponTemplate` 行数恒为 3（不会变成 6）。
- 三张默认券：`满 50 减 5` / `满 100 减 10` / `满 200 减 20`。

### 1.4 失败时排查

- 行数 > 3 → 已被重复 seed。检查并发或之前是否手动插入过。
- 401 / 403 → 鉴权头错误，参 0.2。
- 字段值不符 → 看 `DEFAULTS` 常量是否被改。

---

## 2. C3 — 商户单人发券

### 2.1 静态复核

- **页面**：`app/customers/page.tsx` Drawer「🎫 发送优惠券」按钮 → `IssueCouponModal`
- **API**：`app/api/customers/[id]/coupons/issue/route.ts`
- **关键校验**：
  - `ctx.role === 'OWNER'`（行 22）
  - `StoreCustomerContact` 同 tenantId + active（行 32–37）
  - `CouponTemplate` 同 tenantId + ACTIVE（行 40–43）
  - 同顾客同模板 `COUNT(status=AVAILABLE) >= 1` → 409 `ALREADY_HAS`（行 46–53）
- **关键写入**：`CustomerCoupon` 快照字段（name / type / amountOff / minSpend / expiresAt / issuedByUserId）
- **TG 通知**：try/catch 包裹，失败不影响响应 200
- **状态**：✅ 已实现 / 需人工验证。

### 2.2 操作

浏览器：商户端 `/customers` → 找到测试顾客 → 点卡片打开 Drawer → 点「🎫 发送优惠券」→ 选第一张模板 → 确认。

或 curl：
```bash
curl -s -X POST "$BASE_URL/api/customers/<CUSTOMER_TG_ID>/coupons/issue" \
  $OWNER_AUTH \
  -H 'Content-Type: application/json' \
  -d '{"templateId":"<TEMPLATE_ID>"}' | jq

# 再发一次（应被拦截）
curl -s -X POST "$BASE_URL/api/customers/<CUSTOMER_TG_ID>/coupons/issue" \
  $OWNER_AUTH \
  -H 'Content-Type: application/json' \
  -d '{"templateId":"<TEMPLATE_ID>"}' -i
```

SQL：
```sql
SELECT id, "templateId", "telegramId", status, "amountOff", "minSpend",
       "expiresAt", "usedOrderNo", "issuedByUserId"
  FROM "CustomerCoupon"
 WHERE "tenantId"='<TENANT_ID>'
   AND "telegramId"='<CUSTOMER_TG_ID>'
 ORDER BY "createdAt" DESC LIMIT 5;
```

### 2.3 预期

- 第一次：`{ ok:true, couponId, notified: true|false }` 200。`CustomerCoupon` 多 1 行 `status='AVAILABLE'`，`expiresAt` 在 `now + validDays * 86400s` 附近。
- 第二次：HTTP 409，`{ error:'ALREADY_HAS', message:'该顾客已持有同款可用券' }`，行数不变。
- `notified=true`：顾客 TG 收到「🎫 发券通知」消息；`false`：CUSTOMER_BOT_TOKEN 未配置或 TG API 失败（**仍 200**）。

### 2.4 失败时排查

- 404 `CUSTOMER_NOT_FOUND` → 该 telegramId 未绑定本租户或 status≠active。
- 404 `TEMPLATE_NOT_FOUND` → 模板不属本租户或非 ACTIVE。
- 第二次未 409 → 检查 `MAX_AVAILABLE_PER_TEMPLATE` 是否被改。

---

## 3. C5 — 批量发券 + CouponIssueBatch 计数

### 3.1 静态复核

- **页面**：`app/customers/page.tsx` 顶部「🎫 批量发券」→ `BatchIssueCouponModal`
- **API**：`app/api/customers/coupons/batch-issue/route.ts`
- **关键校验**：OWNER + ≤50 人 + 模板 ACTIVE + 每顾客每模板最多 1 张 AVAILABLE
- **关键写入**：
  - 先 `CouponIssueBatch.create(totalCount=ids.length)`
  - 循环 `CustomerCoupon.create` + 内嵌 `sendAndLogMessage`
  - 最后 `CouponIssueBatch.update(successCount, failedCount)`
- **计数语义**（注意区别）：
  - `total = ids.length`
  - `success = 真正写库成功的`
  - `failed = create 抛错的`（数据库异常等）
  - `skipped = NOT_BOUND + ALREADY_HAS`（未单独入 batch 表，等于 `total - success - failed`）
  - `notified = TG 推送成功的`
- **状态**：✅ 已实现 / 需人工验证。注意 `CouponIssueBatch` 表里**没有 skipped 列**，验收时按 `total - success - failed` 推算。

### 3.2 操作

浏览器：`/customers` → 顶部「🎫 批量发券」→ 选模板 → 下一步 → 确认。

或 curl：
```bash
curl -s -X POST "$BASE_URL/api/customers/coupons/batch-issue" \
  $OWNER_AUTH \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "<TEMPLATE_ID>",
    "telegramIds": ["<CUSTOMER_TG_ID>", "<TG_ID_2>", "<TG_ID_3>"]
  }' | jq
```

SQL：
```sql
-- batch 表的累计
SELECT id, "templateId", "totalCount", "successCount", "failedCount",
       "issuedByUserId", "createdAt"
  FROM "CouponIssueBatch"
 WHERE "tenantId"='<TENANT_ID>'
 ORDER BY "createdAt" DESC LIMIT 5;

-- 该 batch 下发出的券明细
SELECT "telegramId", status, "amountOff", "minSpend", "expiresAt"
  FROM "CustomerCoupon"
 WHERE "batchId"='<BATCH_ID>';
```

### 3.3 预期

- 响应 `{ ok:true, batchId, total, success, skipped, failed, notified, results[] }`。
- `total = telegramIds.length`；`success + skipped + failed = total`。
- `CouponIssueBatch` 行：`totalCount=total`、`successCount=success`、`failedCount=failed`。
- `CustomerCoupon` 中 `batchId=<id>` 的行数 = `success`。
- 已持有同款的顾客 results 项 `status='SKIPPED', reason='ALREADY_HAS'`；未绑定的 `reason='NOT_BOUND'`。

### 3.4 失败时排查

- `BATCH_TOO_LARGE` → ids > 50。
- `successCount + failedCount + skipped ≠ total` → 看 batch update 是否漏跑（最后 `.catch(()=>{})` 静默吞）。
- 实际成功券数 ≠ batch.successCount → batch.update 静默失败；检查 prisma 连接。
- 通知数为 0 但 success > 0 → `CUSTOMER_BOT_TOKEN` 未配。

---

## 4. C9 — /me/coupons 三分类

### 4.1 静态复核

- **页面**：`app/me/coupons/page.tsx`
- **API**：`app/api/customer/coupons/route.ts`
- **关键逻辑**（行 39–48）：
  - `status='USED'` → used
  - `status IN ('CANCELLED','EXPIRED')` → expired
  - `status='AVAILABLE' AND expiresAt <= now` → expired（**响应端标记，DB 不变更**）
  - 其它 → available
- **风险点**：DB 中 `AVAILABLE` 但实际过期的券不会被回写 status，统计/数据分析需自己 JOIN expiresAt。
- **状态**：✅ 已实现 / 需人工验证。

### 4.2 操作

```bash
# 先准备数据：3 张券分别置不同状态
psql "$DIRECT_URL" -c "
UPDATE \"CustomerCoupon\" SET status='USED', \"usedAt\"=NOW()
 WHERE id='<COUPON_ID_A>';

UPDATE \"CustomerCoupon\" SET \"expiresAt\"=NOW() - INTERVAL '1 day'
 WHERE id='<COUPON_ID_B>';
-- COUPON_ID_C 保持 AVAILABLE + expiresAt 未来"

# 调接口
curl -s "$BASE_URL/api/customer/coupons?code=<STORE_CODE>&tgId=<CUSTOMER_TG_ID>" | jq
```

浏览器：Telegram 内打开 `$BASE_URL/me/coupons?code=<STORE_CODE>` → 切三 tab。

### 4.3 预期

- 响应 `counts: { available, used, expired }` 各 = 1。
- `available[].status='AVAILABLE'`；`used[].status='USED'`；`expired[]` 中 B 的 `status='EXPIRED'`（响应端标记），但 DB 仍是 AVAILABLE。
- 三 tab UI 显示对应张数；可用 tab 上「去使用」跳 `/menu?couponId=...`。

### 4.4 失败时排查

- 400 `INVALID_PARAMS` → 缺 code 或 tgId。
- 404 `STORE_NOT_FOUND` → storeCode 不存在。
- 该顾客的券全部去哪了？检查 `CustomerCoupon.tenantId` 与 `Store.tenantId` 是否一致、`storeId` 是否在 `{store.id, null}` 内。

### 4.5 SQL 验证 DB 没被写过

```sql
SELECT status, "expiresAt"
  FROM "CustomerCoupon" WHERE id='<COUPON_ID_B>';
-- 期望：status='AVAILABLE'（响应端标记 EXPIRED 不应回写）
```

---

## 5. C11 — /menu URL 携券自动选中

### 5.1 静态复核

- **页面**：`app/menu/page.tsx`
- **URL 解析**（mount effect 内）：`new URLSearchParams(window.location.search).get('couponId')` → `setSelectedCouponId(initCouponId)`
- **拉券 effect**：依赖 `[showConfirm, storeCode, tgId, cartTotal, selectedCouponId]` → 在结算弹窗打开时调 `/api/public/coupons/available` 带 `couponId`
- **若服务端返 `selectedCoupon=null` 且传入 id 在 unavailable**：前端 `setSelectedCouponId(null)` + 显示 `couponMsg`
- **状态**：✅ 已实现 / 需人工验证。

### 5.2 操作

1. 准备一张可用券（minSpend 容易达到，比如 5 元）。
2. Telegram 内打开 `$BASE_URL/menu?code=<STORE_CODE>&couponId=<COUPON_ID>`。
3. 加货物 ≥ minSpend → 点结算。

可不点击 UI，直接验后端：
```bash
curl -s -X POST "$BASE_URL/api/public/coupons/available" \
  -H 'Content-Type: application/json' \
  -d '{
    "storeCode": "<STORE_CODE>",
    "telegramId": "<CUSTOMER_TG_ID>",
    "subtotal": 50,
    "couponId": "<COUPON_ID>"
  }' | jq
```

### 5.3 预期

- 接口响应 `selectedCoupon.id === <COUPON_ID>`、`discountAmount` 与券类型匹配、`payableAmount = subtotal - discount`。
- 前端结算弹窗：优惠券行显示该券 name；「已优惠」非 $0；「应付」 = 商品 − 已优惠。

### 5.4 失败时排查

- `selectedCoupon=null` 且 `unavailable` 中 reason `MIN_NOT_MET` → 购物车未到 minSpend，加货物。
- `unavailable` 中 reason `NOT_FOUND` → couponId 不存在 / 已用 / 已过期 / 跨店 / 跨人。
- URL 解析失效 → 检查 `/me/coupons` Link 是否拼对 `couponId=`。

---

## 6. C14 — minSpend 不满足自动取消

### 6.1 静态复核

- **页面**：`app/menu/page.tsx` 拉券 effect 第 32–40 行
- **逻辑**：服务端 `available[]` 仅含 `minSpend ≤ subtotal` 的券；`unavailable[]` 含 `MIN_NOT_MET`。前端如发现传入的 `selectedCouponId` 不在 `available` 命中，调 `setSelectedCouponId(null)` + 设置 `couponMsg`。
- **状态**：✅ 已实现 / 需人工验证。

### 6.2 操作

1. 先选中一张满 100 减 10 的券（购物车 ≥ 100 时）。
2. 在购物车面板移除商品，使 cartTotal 降到 < 100。
3. 重新点结算（弹窗会重新拉券）。

或纯 API：
```bash
curl -s -X POST "$BASE_URL/api/public/coupons/available" \
  -H 'Content-Type: application/json' \
  -d '{
    "storeCode": "<STORE_CODE>",
    "telegramId": "<CUSTOMER_TG_ID>",
    "subtotal": 50,
    "couponId": "<COUPON_100_MIN>"
  }' | jq
```

### 6.3 预期

- 响应 `selectedCoupon=null`，`unavailable[]` 含该 couponId 且 `reason='MIN_NOT_MET'`，`discountAmount=0`，`payableAmount=subtotal`。
- 前端：橙色提示「需满足最低消费方可使用」，优惠券行显示「N 张可用 ›」或 noCoupon；已优惠 = $0。

### 6.4 失败时排查

- 仍显示选中 → effect 未触发，检查 `cartTotal` 是否真改变（依赖项变化）。
- `discountAmount` 非 0 → 服务端筛券逻辑出错，查 `route.ts:62` 的 `brief.minSpend > subtotal` 比较。

---

## 7. C15 — 下单成功核销（三表一致）

### 7.1 静态复核

- **API**：`app/api/public/orders/route.ts`
- **事务起点**：行 173 `prisma.$transaction(async (tx) => { ... })`
- **三步**：
  1. `tx.customerOrder.create({ totalAmount: payable })`（行 175–189）
  2. `tx.customerCoupon.updateMany`（行 196–207）where 含 id / tenantId / telegramId / status='AVAILABLE' / expiresAt > now / OR storeId∈{store.id, null}
  3. `tx.couponRedemption.create({ orderNo, couponId, discountAmount, tenantId, storeId, telegramId })`（行 209–219）
- **金额三段**：响应 `subtotal / discountAmount / payableAmount / coupon`；`CustomerOrder.totalAmount` = payable。
- **状态**：✅ 已实现 / 需人工验证。

### 7.2 操作

```bash
curl -s -X POST "$BASE_URL/api/public/orders" \
  -H 'Content-Type: application/json' \
  -d '{
    "storeCode": "<STORE_CODE>",
    "customerTelegramId": "<CUSTOMER_TG_ID>",
    "items": [{"productId":"<PRODUCT_ID>","quantity":1}],
    "couponId": "<COUPON_ID>",
    "lang": "zh"
  }' | jq
```

SQL 验证三表一致：
```sql
-- 1) CustomerOrder
SELECT "orderNo", "tenantId", "storeId", "totalAmount", status, "customerTelegramId"
  FROM "CustomerOrder" WHERE "orderNo"='<ORDER_NO>';

-- 2) CustomerCoupon
SELECT id, status, "usedAt", "usedOrderNo", "telegramId"
  FROM "CustomerCoupon" WHERE id='<COUPON_ID>';

-- 3) CouponRedemption
SELECT id, "couponId", "orderNo", "discountAmount", "telegramId", "tenantId", "storeId"
  FROM "CouponRedemption" WHERE "orderNo"='<ORDER_NO>';
```

### 7.3 预期

- 响应 200，`subtotal=商品合计`、`discountAmount=优惠`、`payableAmount=subtotal-discount`、`coupon={id,name,type}`。
- 三表完全一致：
  - `CustomerOrder.totalAmount = payableAmount`
  - `CustomerCoupon.status='USED'` + `usedAt` 接近 now + `usedOrderNo=<ORDER_NO>`
  - `CouponRedemption.discountAmount = response.discountAmount`、`telegramId/tenantId/storeId/couponId/orderNo` 全填且与 CustomerOrder 一致

### 7.4 失败时排查

- 三表对不上 → 事务未原子化。验证：人为 throw 后看 CustomerOrder 是否真的不入库。
- `totalAmount` 比预期高（无折扣）→ 检查事务前 couponSnapshot 是否构造成功，body.couponId 是否被剥离。
- `usedOrderNo` 是 null → updateMany.data 未含此字段。

---

## 8. C16 — 并发同券只能成功一次

### 8.1 静态复核

- **API**：同 7.1
- **关键防御**：行 196 `tx.customerCoupon.updateMany({ where:{ ..., status:'AVAILABLE' } })` → 行 208 `if (upd.count !== 1) throw new Error('COUPON_ALREADY_USED')`
- **事务隔离**：Prisma 默认 `READ COMMITTED`；两并发只有一个 updateMany 影响行 = 1，另一个为 0 → 409。
- **兜底**：`CouponRedemption.orderNo @@unique` 即便同一 orderNo 被走两次也阻止双写。
- **状态**：✅ 已实现 / 需人工验证。

### 8.2 操作

打两个 terminal，**几乎同时**回车：
```bash
# Terminal A
curl -s -X POST "$BASE_URL/api/public/orders" \
  -H 'Content-Type: application/json' \
  -d '{"storeCode":"<STORE_CODE>","customerTelegramId":"<CUSTOMER_TG_ID>",
       "items":[{"productId":"<P1>","quantity":1}],"couponId":"<COUPON_ID>"}' &
# Terminal B（同时）
curl -s -X POST "$BASE_URL/api/public/orders" \
  -H 'Content-Type: application/json' \
  -d '{"storeCode":"<STORE_CODE>","customerTelegramId":"<CUSTOMER_TG_ID>",
       "items":[{"productId":"<P1>","quantity":1}],"couponId":"<COUPON_ID>"}' &
wait
```

或一行并发：
```bash
( curl -s ... & curl -s ... & wait ) | jq -s
```

SQL：
```sql
SELECT COUNT(*) FROM "CouponRedemption" WHERE "couponId"='<COUPON_ID>';
SELECT "usedOrderNo", status FROM "CustomerCoupon" WHERE id='<COUPON_ID>';
SELECT "orderNo", "totalAmount" FROM "CustomerOrder"
 WHERE "storeId"='<STORE_ID>' AND "createdAt" > NOW() - INTERVAL '5 minutes';
```

### 8.3 预期

- 一笔 200，一笔 409 `{ error:'COUPON_ALREADY_USED' }`。
- `CouponRedemption` 中该 couponId 计数 = 1。
- `CustomerCoupon.usedOrderNo` 指向成功的 orderNo，status='USED'。
- 失败那笔的订单**不入库**（事务回滚）；CustomerOrder 表近 5 分钟内只多 1 行。

### 8.4 失败时排查

- 两笔都 200 → updateMany.where 漏 `status='AVAILABLE'`；或事务被 split。
- 两笔都 409 → 第一笔事务未提交，updateMany 都返 0；查 Prisma 事务日志。
- CustomerOrder 多了 2 行 → 事务范围错误，订单 create 在事务外。

---

## 9. C17 — 过期券拦截

### 9.1 静态复核

- **API**：`app/api/public/orders/route.ts`
- **事务外校验**：行 144–146 `if (coupon.expiresAt.getTime() <= Date.now()) → 400 COUPON_EXPIRED`
- **事务内 updateMany where**：`expiresAt: { gt: new Date() }` 再次兜底
- **状态**：✅ 已实现 / 需人工验证（双层防护）。

### 9.2 操作

```sql
-- 制造一张已过期的 AVAILABLE 券
UPDATE "CustomerCoupon"
   SET "expiresAt" = NOW() - INTERVAL '1 hour'
 WHERE id='<COUPON_ID>' AND status='AVAILABLE';
```

```bash
curl -s -X POST "$BASE_URL/api/public/orders" \
  -H 'Content-Type: application/json' \
  -d '{"storeCode":"<STORE_CODE>","customerTelegramId":"<CUSTOMER_TG_ID>",
       "items":[{"productId":"<P1>","quantity":1}],"couponId":"<COUPON_ID>"}' -i
```

### 9.3 预期

- HTTP 400，`{ error:'COUPON_EXPIRED', message:'优惠券已过期' }`。
- `CustomerOrder` 不产生新行。
- `CustomerCoupon.status` 仍 `AVAILABLE`（事务外拦截，未触达 updateMany）。

### 9.4 失败时排查

- 返 200 → 检查 expiresAt 是否真过期（时区/UTC）。
- 返其它 4xx → 看 message，可能是 minSpend / tenantId 错。

---

## 10. C19 — 跨商户 couponId 拦截

### 10.1 静态复核

- **API**：`app/api/public/orders/route.ts`
- **事务外**：行 135–142 `findFirst WHERE tenantId=store.tenantId AND telegramId=trimmedTgId AND status='AVAILABLE' AND OR(storeId)` → 不命中 → 400 `COUPON_INVALID`
- **事务内 updateMany**：行 197–206 `WHERE tenantId=store.tenantId AND telegramId=trimmedTgId AND ...` 再次卡 tenant
- **状态**：✅ 已实现 / 需人工验证（双层防护）。

### 10.2 操作

需准备一张**别家商户**的 `<OTHER_TENANT_COUPON_ID>`：

```sql
-- 找一张属于别家 tenant 且 AVAILABLE 的券
SELECT id, "tenantId", "telegramId", status
  FROM "CustomerCoupon"
 WHERE "tenantId" <> '<TENANT_ID>'
   AND status='AVAILABLE'
 LIMIT 1;
```

```bash
curl -s -X POST "$BASE_URL/api/public/orders" \
  -H 'Content-Type: application/json' \
  -d '{
    "storeCode": "<STORE_CODE>",
    "customerTelegramId": "<CUSTOMER_TG_ID>",
    "items": [{"productId":"<PRODUCT_ID>","quantity":1}],
    "couponId": "<OTHER_TENANT_COUPON_ID>"
  }' -i
```

### 10.3 预期

- HTTP 400，`{ error:'COUPON_INVALID', message:'优惠券不可用' }`。
- 别家商户的 `CustomerCoupon` 行**未受影响**：
  ```sql
  SELECT status FROM "CustomerCoupon" WHERE id='<OTHER_TENANT_COUPON_ID>';
  -- 期望仍为 AVAILABLE
  ```
- 本商户 `CustomerOrder` 不增加。
- 别家 `CouponRedemption` 不增加。

### 10.4 失败时排查

- 返 200 → 严重，请立刻停验并检查 `findFirst.where` 是否含 tenantId。
- 返 200 但事务回滚 → updateMany 兜底起作用，但事务外校验有漏洞，需修。

---

## 11. 验收完成后

- 把每一项的结果（通过 / 不通过 / 备注）回填到 `COUPON_E2E_ACCEPTANCE_CHECKLIST.md` 对应条目的 checkbox。
- 不通过项请单独 issue 或在群里同步，附 curl 响应 + SQL 截图，便于复现定位。
- 任何 5xx / 事务异常 / 三表不一致 → 立即停止后续验收，先定位根因。

---

## 12. 已知边界（验收不涉及）

- 一张券**多次部分核销** → 不支持（v1 单券单订单全额核销）。
- **多券叠加** → 不支持。
- **跨店通用券**（storeId=null）→ schema 已留口子，UI 未做创建入口。
- **券模板 CRUD 后台页** → 不在本期。
- **CouponRedemption 没有 couponId 唯一约束** → 现状由 `CustomerCoupon.updateMany WHERE status='AVAILABLE'` 影响行数 + `CouponRedemption.orderNo @@unique` 双兜底。如未来要扩"一券多次"，必须重新评估。
