# EP-BR-SEC-01 — Shinhan Freeze Increment Evidence Pack

生成日期：2026-07-21  
实现 worktree：`/Users/jason/worktrees/ep-br-sec-01`  
分支：`feat/ep-br-sec-01-transaction-security`  
前一提交：`f4c1a2ee006b049913cec4b0c12dc83ab1cfba3b`  
正式 main 基线：`origin/main` / `a469c9f5b95b1214bd0fe32f6e5a0eb56a31c5f2`

## 决策与范围

Founder 已明确将 Shinhan 标记为 **FROZEN / HIDDEN / NOT COMMERCIALLY ENABLED**。本增量不删除历史数据或底层实现，不猜测银行回调协议，也不改变 CASH、静态 KHQR、柜台实体码人工确认或会员余额主链。

冻结恢复的前置条件仍为：正式商务合作、官方技术文档、获批测试/生产凭据、正式的签名与重放规范、安全审查和 Founder 明确批准。

## Surface Inventory

### 用户入口

- `app/menu/page.tsx`：顾客结算弹层的 `Pay now with Shinhan SOL`，原本已受 `/api/public/payments/shinhan/config` 的 `enabled` 控制。
- `app/menu/orders/page.tsx`：未付款订单原本无条件显示 `ShinhanPaymentBox`，其中含创建支付、打开 deeplink、刷新状态和 deeplink 文本。本次改为复用相同公开只读配置，并以默认 `false` 的 React 分支结构性阻断渲染。
- 历史已付款订单保留 `Shinhan SOL` 只读支付方式标签；未保留任何创建、打开或刷新操作入口。

### API 与状态推进

- `POST /api/public/orders/[orderId]/payments/shinhan/create`：原路径会先查询订单、创建 `PaymentTransaction`，再创建 deeplink。
- `POST /api/payments/shinhan/inquiry`：原路径可查询提供方并通过 `markPaymentPaidIfValid` 推进 `PaymentTransaction` 与 `CustomerOrder`。
- `POST /api/payments/shinhan/callback`：原路径可按 payload 更新失败状态，或通过 `markPaymentPaidIfValid` 推进 PAID。
- `GET /api/payments/shinhan/callback`：原来已为 405，保持不变。
- `GET /api/public/orders/[orderId]/payments/status`：仅读取订单及最近 `PaymentTransaction`，无写入；保持原样以支持历史只读查看。

## Freeze Controls

1. `lib/payments/shinhan-config.ts` 继续作为唯一服务端配置来源。`SHINHAN_PAYMENT_ENABLED` 默认 `false`；mock 配置不再视为可启用状态。只有服务端的非 mock、完整商业配置才可能返回 `enabled: true`。请求参数、客户端状态或页面 query 都不能开启该能力。
2. 公开配置接口仅返回 `{ enabled, frozen }`，不再向客户端提供 mock 状态。
3. 创建、主动查询及 callback POST 在任何请求体解析、身份读取、订单查询或 Prisma 写入之前，统一以 `503 { error: 'SHINHAN_PAYMENT_FROZEN' }` 失败关闭。
4. `lib/payments/shinhan.ts` 的创建与查询 helper 也使用同一冻结判断，防止未来直接调用绕过路由保护。
5. callback GET 仍返回 405、`Allow: POST`。冻结的 callback POST 对任意 payload 均不读取或更新订单、PaymentIntent/PaymentTransaction 状态，因而不能写入 PAID。

## 主链保护与边界

- 未修改 `app/cashier/page.tsx`、desktop POS、顾客屏、邀请页、打印链或 Desktop Runtime。
- 未修改 `prisma/**`、迁移、支付模型、商品、价格、购物车、销售金额计算或库存。
- 静态 KHQR、未配置系统 KHQR 时的实体码+员工人工确认、CASH、会员余额的既有实现未改动。
- `tests/browser-transaction-security.test.ts` 继续验证 KHQR 只有明确人工确认才写入 PAID；新增冻结 API 与 UI 门控回归覆盖。

## 验证结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npx tsx tests/browser-transaction-security.test.ts` | 0 | 通过；含冻结配置、创建、POST callback、inquiry、GET 405 与 KHQR 人工确认回归。 |
| `npx tsx tests/customer-landing-journey-static.test.ts` | 0 | 通过。 |
| `npx tsc --noEmit --incremental false` | 0 | 通过（无 stdout/stderr）。 |
| `npm run build` | 0 | 通过。 |

完整原始输出和退出码：

- `docs/reviews/ep-br-sec-01-shinhan-freeze-evidence/05-final-tests-and-typescript-output.txt`
- `docs/reviews/ep-br-sec-01-shinhan-freeze-evidence/06-final-build-output.txt`
- `docs/reviews/ep-br-sec-01-shinhan-freeze-evidence/03-incremental-source-diff.patch`

## 剩余风险与运营要求

- 冻结是代码和部署配置共同约束：生产环境必须保持 `SHINHAN_PAYMENT_ENABLED` 未设置或为 false。在未满足恢复前置条件前，不得将其改为 true。
- 历史 Shinhan 数据与旧 provider 代码被有意保留，但冻结路由不接受任何回调，也不会发起创建或查询；正式恢复前必须重新完成协议、签名、重放保护与 Security Review。
- 本包未执行真实银行支付，因为 Founder 已冻结该商业能力；其余主链的保护证据为未改动边界、既有 KHQR 人工确认测试和 production build。
