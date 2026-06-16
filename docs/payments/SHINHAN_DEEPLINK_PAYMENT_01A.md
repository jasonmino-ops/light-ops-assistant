# Shinhan Deeplink Payment 01A 开发测试框架

## 一、当前能力说明

Payment-Shinhan-01A 当前已完成 Shinhan Deeplink Payment 的开发测试框架，commit：`632b120`。

当前支持：

- `PaymentTransaction` 表：记录第三方支付交易、请求、响应、callback、inquiry、错误信息和支付状态。
- Shinhan Deeplink provider 框架：独立于现有 CASH / KHQR 主流程。
- mock mode 创建 `deepLinkUrl`：没有真实 UAT 参数时可跑通内部流程。
- callback 模拟支付成功：支持根据 `trxId` / `txId` 查找交易并标记支付成功。
- inquiry 主动查单框架：支持按 `paymentId` 或 `trxId` 主动查询，并写入 `inquiryPayload`。
- CustomerOrder 支付状态更新：支付成功后同步更新 `paymentStatus=PAID`、`paidAt`、`paidAmount`、`paymentMethod=SHINHAN`。
- 顾客订单详情页入口：`Pay with Shinhan SOL`，创建支付后显示 `Open Shinhan SOL App` 与 `Refresh payment status`。

## 二、当前边界说明

当前阶段只做开发测试框架：

- 只做 Shinhan Deeplink Payment。
- 不做 KHQR API。
- 不做退款。
- 不做生产真实支付。
- 不影响 CASH 主流程。
- 不影响现有 KHQR 展示 / 人工确认主流程。
- 不影响 records 主流程和统计口径。
- 真实银行参数未配置前必须使用 mock mode。

## 三、环境变量说明

| 环境变量 | 说明 |
| --- | --- |
| `SHINHAN_PAYMENT_ENABLED` | 是否启用 Shinhan 支付框架。`1/true/yes/on` 表示启用。 |
| `SHINHAN_PAYMENT_MOCK_MODE` | 是否使用 mock mode。未配置时默认 mock mode。 |
| `SHINHAN_UAT_BASE_URL` | Shinhan UAT API Base URL，默认 `https://uat-pay.shinhan.com.kh`。 |
| `SHINHAN_API_KEY` | Shinhan 提供的 `api-key` header。 |
| `SHINHAN_SECRET_KEY` | Shinhan 提供的 HMAC-SHA512 SecretKey。 |
| `SHINHAN_MERCHANT_ID` | Shinhan 提供的 merchantId。 |
| `SHINHAN_MERCHANT_NAME` | Shinhan 提供的 merchantName。 |
| `SHINHAN_CALLBACK_BASE_URL` | 店小二 callback 外网域名 base，例如 `https://light-ops-assistant.vercel.app`。 |

mock mode 最小配置：

```bash
SHINHAN_PAYMENT_ENABLED=1
SHINHAN_PAYMENT_MOCK_MODE=1
```

真实 UAT mode 至少需要：

```bash
SHINHAN_PAYMENT_ENABLED=1
SHINHAN_PAYMENT_MOCK_MODE=0
SHINHAN_UAT_BASE_URL=https://uat-pay.shinhan.com.kh
SHINHAN_API_KEY=...
SHINHAN_SECRET_KEY=...
SHINHAN_MERCHANT_ID=...
SHINHAN_MERCHANT_NAME=...
SHINHAN_CALLBACK_BASE_URL=https://light-ops-assistant.vercel.app
```

不要把真实 `api-key` 或 `SecretKey` 写入代码、文档、commit 或聊天记录。

## 四、生产库 migration 提醒

线上使用前必须确认生产数据库已经执行 migration：

```text
20260616010000_add_payment_transaction
```

该 migration 会创建：

```text
PaymentTransaction
```

如果生产库没有 `PaymentTransaction` 表，线上创建 Shinhan 支付会失败。

上线前建议检查：

```sql
SELECT migration_name, finished_at
FROM _prisma_migrations
WHERE migration_name = '20260616010000_add_payment_transaction';

SELECT to_regclass('"PaymentTransaction"') AS table_name;
```

## 五、mock mode 测试步骤

1. 配置 env：

```bash
SHINHAN_PAYMENT_ENABLED=1
SHINHAN_PAYMENT_MOCK_MODE=1
```

2. 打开顾客订单详情页。

3. 找到未支付订单，点击：

```text
Pay with Shinhan SOL
```

4. 确认接口返回：

- `paymentId`
- `trxId`
- `deepLinkUrl`
- `status=PENDING`

5. 用 callback API 模拟 Shinhan 支付成功，传入：

- `trxId` 或 `txId`
- `responseCode=200` 或 `respondCode=200`
- `paymentAmount`

6. 点击：

```text
Refresh payment status
```

7. 确认：

- `PaymentTransaction.status=PAID`
- `CustomerOrder.paymentStatus=PAID`
- `CustomerOrder.paidAt` 已写入
- 顾客订单详情显示已支付

## 六、callback 测试示例

示例 1：JSON body，使用 `trxId` + `responseCode`：

```bash
curl -sS -X POST 'https://light-ops-assistant.vercel.app/api/payments/shinhan/callback' \
  -H 'Content-Type: application/json' \
  -d '{
    "trxId": "DXE-EXAMPLE-TRX",
    "timestamp": "2026-06-16T10:00:00Z",
    "trxCode": "MOCK_TXN_CODE",
    "responseCode": "200",
    "responseMessage": "MOCK_PAID",
    "paymentAmount": "5.50"
  }'
```

示例 2：query string，使用 `txId` + `respondCode`：

```bash
curl -sS -X POST 'https://light-ops-assistant.vercel.app/api/payments/shinhan/callback?txId=DXE-EXAMPLE-TRX&respondCode=200&respondMessage=MOCK_PAID&paymentAmount=5.50'
```

说明：

- 示例不包含真实密钥。
- 当前 01A callback 暂未做真实银行验签。
- `paymentAmount` 必须与 `PaymentTransaction.amount` 匹配，否则会返回金额不一致。

## 七、接 Shinhan UAT 前需要银行确认的资料

进入 Payment-Shinhan-01B 前，需要 Shinhan 明确提供或确认：

- UAT `api-key`
- UAT `SecretKey`
- UAT `merchantId`
- UAT `merchantName`
- callback 使用 GET 还是 POST
- callback 是否需要验签
- callback 字段名最终确认：
  - `trxId` / `txId`
  - `trxCode` / `txnCode`
  - `responseCode` / `respondCode`
  - `responseMessage` / `respondMessage`
- `amount` 是否支持小数
- `timestamp` 使用秒、毫秒，还是 ISO 字符串
- `deeplinkUrl` 是否有有效期
- Telegram WebView 是否能直接打开 `deeplinkUrl`
- SOL App 支付完成后是否能跳回店小二页面

## 八、下一阶段建议

Payment-Shinhan-01B 才接真实 UAT：

- 接真实 Shinhan UAT Deeplink API。
- 验证 HMAC-SHA512 hash 与银行要求完全一致。
- 验证 callback 字段和成功码。
- 验证 inquiry 查单。
- 用 Shinhan SOL App 做真实 UAT 测试。
- 明确 Telegram WebView 中打开 deeplink 和回跳策略。

01B 前不要直接打开生产真实支付。

## 九、验收清单 / Acceptance Checklist

### 1. 上线前检查 / Pre-flight Checklist

- [ ] 生产库已执行 migration：`20260616010000_add_payment_transaction`
- [ ] `PaymentTransaction` 表已存在
- [ ] `SHINHAN_PAYMENT_ENABLED` 已配置
- [ ] `SHINHAN_PAYMENT_MOCK_MODE` 已配置
- [ ] 未拿到 Shinhan UAT 参数前保持 mock mode
- [ ] `SHINHAN_CALLBACK_BASE_URL` 是公网可访问域名
- [ ] CASH 主流程未被改动
- [ ] 现有 KHQR 展示 / 人工确认主流程未被改动
- [ ] records 主流程和统计口径未被改动

### 2. mock mode 验收 / Mock Verification

- [ ] 顾客订单详情能看到 `Pay with Shinhan SOL`
- [ ] 点击后能创建 `PaymentTransaction`
- [ ] 返回 `paymentId`
- [ ] 返回 `trxId`
- [ ] 返回 `deepLinkUrl`
- [ ] callback 模拟 `responseCode=200` 后 `PaymentTransaction.status=PAID`
- [ ] callback 模拟 `respondCode=200` 后 `PaymentTransaction.status=PAID`
- [ ] `CustomerOrder.paymentStatus` 同步变为 `PAID`
- [ ] `CustomerOrder.paidAt` 已写入
- [ ] `Refresh payment status` 能读到最新状态
- [ ] 重复 callback 不应重复入账或破坏订单状态
- [ ] 错误 `paymentAmount` 不应错误标记 `PAID`
- [ ] `responseCode` 非 `200` 不应标记 `PAID`
- [ ] `respondCode` 非 `200` 不应标记 `PAID`

### 3. 01B 接真实 UAT 前检查 / UAT Readiness

- [ ] 已获得 UAT `api-key`
- [ ] 已获得 UAT `SecretKey`
- [ ] 已获得 UAT `merchantId`
- [ ] 已获得 UAT `merchantName`
- [ ] 已确认 callback 使用 GET 还是 POST
- [ ] 已确认 callback 是否需要验签
- [ ] 已确认 callback 字段名：`trxId` / `txId`
- [ ] 已确认 callback 字段名：`responseCode` / `respondCode`
- [ ] 已确认 callback 字段名：`trxCode` / `txnCode`
- [ ] 已确认 `timestamp` 使用秒、毫秒，还是 ISO 字符串
- [ ] 已确认 `amount` 小数格式
- [ ] 已确认 `deeplinkUrl` 有效期
- [ ] 已确认 Telegram WebView 是否能唤起 Shinhan SOL App
- [ ] 已确认手机浏览器是否能唤起 Shinhan SOL App
- [ ] 已确认 SOL App 支付完成后是否支持跳回店小二页面

## 十、当前禁止事项 / Do Not Do Yet

- 不接生产参数
- 不开启真实付款
- 不改 CASH
- 不替换现有 KHQR
- 不做 KHQR API
- 不做 refund
- 不做 dashboard 分项统计
- 不做 OPS 配置页面
- 不把真实 `api-key` / `SecretKey` 写入代码、文档、commit 或聊天记录

## 十一、Customer Checkout V2 前端入口补充

2026-06-16 已将 Shinhan SOL 从“订单详情页临时支付按钮”前移到顾客 checkout 确认流程中。

当前 checkout 结构：

- 先选择消费 / 履约方式：
  - Dine in / Pick up at store
  - Delivery
- 再选择支付方式：
  - Pay later：到店或送货时使用 CASH / KHQR 支付
  - Pay now with Shinhan SOL：提交订单后创建 Shinhan Deeplink mock payment
- 最后提交订单。

当前边界：

- `Pay later` 保持原有 CustomerOrder 下单流程，不创建 `PaymentTransaction`。
- `Pay now with Shinhan SOL` 会先创建 CustomerOrder，再调用：
  - `POST /api/public/orders/[orderId]/payments/shinhan/create`
- 支付成功后的状态刷新使用：
  - `GET /api/public/orders/[orderId]/payments/status`
- Shinhan SOL 是否展示由只读公开配置接口控制：
  - `GET /api/public/payments/shinhan/config`
- 公开配置接口只返回 `enabled` / `mockMode`，不返回 `api-key`、`SecretKey`、merchant 信息或任何敏感参数。
- `/menu/orders` 订单详情页继续保留 Shinhan 状态显示和非主入口支付能力，但主要支付入口已调整为 checkout。

仍然不做：

- 不接真实 Shinhan UAT。
- 不做 KHQR API。
- 不做退款。
- 不替换现有 CASH / KHQR 主流程。
- 不改变 `/sale` 收银主流程。
- 不改变 `records` 统计口径。
