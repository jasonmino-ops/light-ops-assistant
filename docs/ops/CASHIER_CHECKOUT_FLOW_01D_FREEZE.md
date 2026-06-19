# Cashier-CheckoutFlow-01D 电脑端 POS 标准收银主流程冻结

本文件为电脑端 POS 标准收银主流程冻结记录，不替代原始开发记录、测试说明和真实门店验收记录。

## 1. 冻结结论

Cashier-CheckoutFlow-01D 已进入主流程冻结。电脑端 POS 标准收银链路已经形成稳定闭环：

选商品 / 扫码 -> 确认本单 -> 选择收款方式 -> CASH / KHQR -> 确认收款 -> 复用原 `/cashier` `handleSubmit` 完成销售 -> 创建 SaleRecord -> 清空购物车 -> 顾客屏完成态 -> `/records` 可查看记录。

本轮只做冻结文档和 Obsidian 冻结记录，不新增功能、不继续修 UI 细节、不做小票打印。

## 2. 冻结 Commit

- 冻结业务 commit：`c80307c`
- 当前生产状态：以 Vercel Production 实际部署状态为准。

## 3. 冻结范围

### 3.1 /desktop/pos 电脑端员工收银台

冻结内容：

- 商品选择 / 扫码
- 本单确认
- 选择收款方式
- CASH 最终记账
- KHQR 最终记账
- 确认收款完成销售
- 复用原 `/cashier` `handleSubmit`
- 前端防重复提交

### 3.2 /desktop/display 顾客显示屏

冻结内容：

- 空闲等待页门店 KHQR 常驻展示
- 当前订单商品与金额展示
- 进入 payment 后本单 KHQR 展示
- 点击 KHQR 后大二维码聚焦弹窗
- 切 CASH 后大弹窗关闭
- 完成销售后感谢页 / 完成态
- 感谢页后回到空闲页

### 3.3 /records 销售记录

冻结内容：

- CASH 销售记录可查看
- KHQR 销售记录可查看
- `paymentMethod` 与店员最终选择一致

### 3.4 回归范围

冻结时确认不影响：

- 非 desktop `/cashier`
- 手机端 `/sale`
- 离线 CASH
- `offline-sync`
- records / dashboard 统计
- KHQR 回调 / 查单

## 4. 已完成任务列表

- Cashier-CheckoutFlow-01A：电脑端本单确认页
- Cashier-CheckoutFlow-01B：选择收款方式面板
- Cashier-CheckoutFlow-01C：CASH / KHQR 完成销售闭环
- Cashier-CheckoutFlow-01C-Fix01：KHQR 展示延迟排查与原 payment 状态同步
- Cashier-CheckoutFlow-01C-Fix02：desktop POS 选择 KHQR 后 PosSession 写入修复
- Cashier-CheckoutFlow-01C-Fix03：进入 payment 阶段即默认展示本单 KHQR
- Desktop-Display-KHQR-Idle-01A：顾客屏空闲页常驻展示门店 KHQR
- Desktop-Display-KHQR-Focus-01A：点击扫码收款 KHQR 后顾客屏大二维码聚焦弹窗
- Display-State-Alignment-Fix-01-02：修复 SELECT_PAYMENT 阶段 effect 覆盖和返回阶段状态错位

## 5. 当前最终流程

1. 店员打开 `/desktop/pos?storeCode=ST169E7000&lang=zh`。
2. 顾客屏打开 `/desktop/display?storeCode=ST169E7000&lang=zh`。
3. 店员选择商品或扫码加入购物车。
4. 顾客屏显示当前商品与金额。
5. 店员点击“确认本单”。
6. 店员确认商品、数量、金额后点击“确认本单，选择收款方式”。
7. 顾客屏进入本单 KHQR 待支付展示。
8. 店员选择 CASH 或 KHQR 作为最终记账方式。
9. 如果选择 KHQR，顾客屏可显示大二维码聚焦弹窗。
10. 店员确认已收款并完成销售。
11. 系统复用原 `/cashier` `handleSubmit` 创建 SaleRecord。
12. 购物车清空，顾客屏进入完成态。
13. `/records` 可查看对应 CASH / KHQR 销售记录。

## 6. /desktop/pos 验收结果

- 商品选择 / 扫码：通过。
- 本单确认：通过。
- 选择收款方式：通过。
- CASH / KHQR 最终记账：通过。
- 确认收款完成销售：通过。
- 复用原 `handleSubmit`：通过。
- 防重复提交：沿用原 `submitting` 状态，冻结为可试跑方案。

## 7. /desktop/display 验收结果

- 空闲页门店 KHQR 常驻展示：通过。
- 当前订单商品与金额展示：通过。
- 进入 payment 后本单 KHQR 展示：通过。
- 点击 KHQR 后大二维码聚焦弹窗：通过。
- 切 CASH 后大弹窗关闭：通过，存在轻微关闭延迟，见 Known UX 2。
- 完成销售后感谢页 / 完成态：通过。
- 感谢页后回空闲页：通过。

## 8. CASH 验收结果

- 店员选择 CASH 后，最终 SaleRecord 记录为 CASH。
- 确认现金已收款后复用原完成销售逻辑。
- 顾客屏进入完成态。
- `/records` 可查看 CASH 记录。

## 9. KHQR 验收结果

- 进入 payment 阶段后顾客屏可显示本单 KHQR。
- 点击“扫码收款 KHQR”后可显示大二维码聚焦弹窗。
- 店员确认 KHQR 已收款后复用原完成销售逻辑。
- SaleRecord 记录为 KHQR。
- `/records` 可查看 KHQR 记录。
- 本轮不接 KHQR 自动回调，不做自动到账确认。

## 10. /records 验收结果

- CASH 销售记录可查看。
- KHQR 销售记录可查看。
- `paymentMethod` 与店员最终选择一致。
- 本轮未改 records 查询、排序、统计和退款逻辑。

## 11. 非 desktop /cashier 回归结论

非 desktop `/cashier` 原收银流程保持不变：

- 原收款方式逻辑不变。
- 原完成销售行为不变。
- 原 CASH / KHQR 流程不变。
- 原离线 CASH 流程不变。

## 12. /sale 回归结论

手机端 `/sale` 不属于本轮改造范围，未修改：

- 页面入口不变。
- 扫码 / 选商品不变。
- CASH / KHQR 收银不变。

## 13. 离线 CASH 影响结论

离线 CASH 不受本轮冻结影响：

- 未改 IndexedDB 离线订单结构。
- 未改离线订单保存逻辑。
- 未改 `offline-sync` API。
- 未改离线补同步记录展示。

## 14. 数据库 / API 影响结论

- 未改数据库 schema。
- 未新增 migration。
- 未改 `/api/cashier/sales`。
- 未改 `/api/cashier/display-session`。
- 未改 `/api/pos/session/current`。
- 未改 `/api/cashier/offline-sync`。
- 未改 KHQR 回调 / 查单。

## 15. 已知非阻塞体验项

### Known UX 1：CASH 顾客屏视觉仍为通用金额展示

当前选择 CASH 后，顾客屏左侧仍显示通用大金额卡片：

- 应付金额
- `$X.XX`
- 收款方式：现金

该问题不影响收银结果，不影响 `/records` 记账。

后续可优化为现金专属确认态，例如：

- 现金收款
- 请向店员支付现金
- `$X.XX`

### Known UX 2：KHQR 大二维码弹窗切换 CASH 时存在轻微关闭延迟

当前从 KHQR 切换 CASH 时，大二维码弹窗关闭可能有轻微延迟。

已确认不影响：

- 最终 `paymentMethod`
- SaleRecord 创建
- 顾客屏完成态
- CASH / KHQR 正确记账

后续可单独做：

- Display-KHQR-Focus-UX-01A：大二维码弹窗本地即时关闭优化

当前不继续修，避免主流程冻结前继续补丁叠补丁。

## 16. 不在本轮范围的事项

本轮不包含：

- 小票打印
- 打印模板
- 找零
- 现金专属顾客屏视觉
- KHQR 自动到账确认
- KHQR 回调完成销售
- 完整退款流程
- 新 API
- 数据库 schema 变更
- 非 desktop `/cashier` 改造
- `/sale` 改造

## 17. 下一阶段建议

下一阶段建议进入：

Desktop-ReceiptPrint-01A：小票打印设计文档 + 小票模板。

建议先做设计文档和打印模板口径，不直接接 USB 打印或浏览器自动打印。
