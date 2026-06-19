# Cashier Checkout Flow 01A Design

本文件为电脑端 POS 收银流程标准化设计归档，基于 Claude 审查结论和当前代码取证整理，不替代原始开发记录。

## 1. 背景

当前电脑端 POS 路由 `/desktop/pos` 复用 `/cashier` 页面实现。`app/cashier/page.tsx` 中已存在：

```ts
isDesktopPos = window.location.pathname === '/desktop/pos'
```

这意味着任何直接修改 `/cashier` 主流程的行为，都可能同时影响：

- `/desktop/pos` 电脑端 POS
- `/cashier` 手机浏览器 / PWA 收银台
- 已冻结的离线 CASH 收银
- 会员余额支付入口
- 顾客屏 PosSession 同步

Claude 审查结论：电脑端 POS 新收银流程必须只在 `isDesktopPos === true` 时启用，不能全局修改 `/cashier`。

## 2. `/desktop/pos` 与 `/cashier` 复用关系

- `/desktop/pos` 当前通过路由复用 `/cashier` 页面能力。
- `/cashier/page.tsx` 负责商品、购物车、支付方式、提交销售、离线收银、会员余额支付和顾客屏同步。
- `/desktop/pos` 当前应被视为 `/cashier` 的 desktop shell，而不是独立收银实现。

## 3. 手机端 / Telegram 影响风险

高风险点：

1. `/cashier` 仍可能被手机浏览器或 PWA 使用。
2. `/sale` 手机端和 Telegram 商户端收银不依赖 `/cashier`，但不能被误改。
3. `/cashier` 已包含离线收银、会员余额支付、PosSession 同步等已验收能力。
4. 如果直接修改 `handleSubmit()` 或底层销售 API，可能破坏 CASH / KHQR / 离线 CASH 主链路。
5. 如果全局改变支付区布局，可能影响非 desktop `/cashier` 的既有操作路径。

## 4. 当前收银流程最大 5 个问题

1. 电脑端商品选择阶段直接暴露“完成销售”，不符合标准 POS 的“确认订单 -> 选择支付 -> 完成收款”流程。
2. 商品核对和支付选择混在同一底部区域，店员容易误操作。
3. KHQR 顾客屏虽然可显示二维码，但员工端流程仍不够标准化。
4. 电脑 POS 与手机/PWA `/cashier` 共用页面，直接改全局流程风险高。
5. 后续若加入找零、退款、小票打印、日结，当前单步完成销售流程扩展性不足。

## 5. 推荐 POS 标准收款流程

建议目标流程：

1. 选择商品。
2. 确认本单。
3. 选择收款方式。
4. CASH / KHQR / 会员余额等分支处理。
5. 确认收款。
6. 生成 SaleRecord。
7. 顾客屏显示完成态。
8. 回到下一单。

## 6. desktop-only 保护方案

所有新流程只在：

```ts
isDesktopPos === true
```

时启用。

保护原则：

- 非 desktop `/cashier` 不改变按钮、支付方式、提交逻辑。
- 不修改 `handleSubmit()` 函数体。
- 不修改 `/api/cashier/sales`。
- 不修改 `/sale/page.tsx`。
- 不修改 PosSession API。
- 不修改离线 CASH 保存 / 同步逻辑。

## 7. 对 CASH / KHQR / 离线 CASH / 顾客屏的影响

### CASH

第一阶段不改变 CASH 提交流程，只是在 desktop 模式下先进入“确认本单”视图。

### KHQR

第一阶段不改变 KHQR 选择、二维码展示、人工确认和完成销售逻辑。

### 离线 CASH

第一阶段不改变离线 CASH 保存逻辑，不改变 IndexedDB 订单结构。

### 顾客屏

第一阶段不改变 PosSession 同步。员工端选商品时顾客屏仍显示商品和金额；进入本单确认阶段不额外改变顾客屏状态。

## 8. 分阶段开发方案

### 01A：设计归档

- 归档 Claude 审查结论。
- 明确 desktop-only 保护边界。

### 01C：确认本单 UI

- `/desktop/pos` 商品选择阶段主按钮改为“确认本单”。
- 点击后进入本单确认视图。
- 不创建 SaleRecord。
- 不调用 `handleSubmit()`。

### 01D：选择收款方式面板

- 在 desktop-only `SELECT_PAYMENT` 阶段实现 CASH / KHQR / 会员余额选择面板。
- 仍需保持非 desktop 流程不变。

### 01E：CASH 收款确认

- 增加现金收款确认、可选找零展示。
- 必须单独验证 CASH 主链路。

### 01F：KHQR 等待扫码面板

- 增加 KHQR 支付等待态。
- 不接自动到账确认，仍由员工人工确认。

## 9. 第一阶段建议

第一阶段只做：

- `/desktop/pos` 商品选择阶段不直接显示“完成销售”。
- 增加“确认本单”按钮。
- 增加本单摘要确认视图。
- 增加“下一步将选择收款方式”的占位状态。

第一阶段不做：

- 完整支付面板。
- 找零。
- KHQR 等待扫码面板。
- 自动到账确认。
- SaleRecord 创建逻辑改造。

## 10. 哪些任务给 Codex

适合 Codex 小步开发：

- desktop-only 条件渲染。
- 本单确认 UI。
- 测试文档。
- Obsidian 开发记录。
- 后续分阶段的小 UI 面板。

## 11. 哪些情况需要暂停回 Claude 复审

出现以下情况必须暂停：

1. 需要修改 `handleSubmit()` 主体。
2. 需要修改 `/api/cashier/sales`。
3. 需要修改 SaleRecord / PaymentIntent 结构。
4. 需要修改 PosSession API 结构。
5. 需要修改离线订单 IndexedDB 结构。
6. 需要改 CASH / KHQR 状态机。
7. 需要影响 `/sale` 或手机端 `/cashier`。
8. 需要新增数据库 migration。

## 12. Cashier-CheckoutFlow-01C 实施边界

本轮 01C 只允许：

- 新增 `checkoutStep` 最小状态。
- 在 `isDesktopPos` 下替换底部主按钮。
- 增加本单确认视图。
- 增加 SELECT_PAYMENT 占位提示。

本轮 01C 不允许：

- 调用 `handleSubmit()`。
- 创建 SaleRecord。
- 修改支付 API。
- 修改手机端 / Telegram 收银流程。
