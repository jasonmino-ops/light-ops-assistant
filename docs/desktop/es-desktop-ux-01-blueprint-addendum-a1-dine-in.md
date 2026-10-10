# ES-DESKTOP-UX-01 Blueprint Addendum A1 — 餐饮行业堂食模块

```
STATUS        = DRAFT / PROPOSED（待 Founder 批准合入；本文件尚未进入 origin/main）
适用任务      = ES-DINE-IN-01
修改 FINAL 原文 = 否（本文件为独立增补，不改 es-desktop-ux-01-blueprint-v1-final.md 一字）
合入方式      = 独立治理 change set，不与功能实现同一 change set（Blueprint 第 23 节）
```

**A1.1 性质**
本增补只为「餐饮行业堂食模块」新增范围。它不修改 Blueprint V1.0 FINAL 的任何原文，不取消其任何 Non-Goal，不改变 Desktop V1 各阶段已作出的验收结论。Blueprint 与 Roadmap 的原有条款对 Desktop V1 范围继续完全有效。

**A1.2 相关原文（行号对应 `origin/main` @ `193eb3d8d88b213d797744f3ea892cfd098b8858`）**

| 位置 | 原文 |
|---|---|
| 第 7 节 L315 | 「Restaurant / Table Service = Explicit Non-Goal for V1。」 |
| 第 7 节 L317–319 | 「Settings 中只允许「桌号二维码」，指向现有 `/table-qrcodes`。」「不得命名为：桌台管理 · 桌台状态 · 开桌管理。」 |
| 第 7 节 L305–311 | 「Table Service 不得另造第二套 POS。必须最大化复用 Product · Order · Pending Payment · Checkout · Payment · Printing · SaleRecord · Reporting，只增加真正缺失的 table-domain 概念。」「Table → Active Bill / Pending Payment → Append Items → Checkout」「Table Service 的现有基础是「门店挂单」，不是「桌号二维码」。」 |
| 第 6 节 L279 | 「不得为了代码整洁先抽离：checkout state machine · payment handlers · offline sale path · scan path · cart mutation · customer order state/actions。」 |
| 第 18 节 L609 | 「C10 桌台不是实体；table QR ≠ table management。」 |
| 第 19 节 L647–649 | Non-Goals 含「Table entity / Restaurant implementation · 开桌 / 加菜」；「补充：本轮不新增任何 schema / migration」 |
| 第 20 节 | Open Questions 第 8 项「Restaurant / Table Service 实施时机」、第 9 项「Table entity 未来 schema 与生命周期」 |
| 第 23 节 | 「不允许开发者自行增加 schema / migration 来解决蓝图外问题。」 |
| Roadmap L80、L442、L565 | Restaurant 不进入本 Roadmap；设置页「桌台管理（Non-Goal，只放二维码入口）」；Deferred Programs 表 |

**A1.3 范围划分**

| | Desktop V1（原范围，不变） | 堂食模块（本增补新增） |
|---|---|---|
| 适用门店 | 全部 | 仅 `businessType = FOOD`、在试点名单内的门店 |
| Table Service | Explicit Non-Goal，继续有效 | 作为独立模块立项，独立验收 |
| 桌台实体 | 不存在；C10 对 V1 各页面继续成立 | 模块内引入桌台、一次用餐、批次、退菜行（`DiningTable`、`DiningMeal`、`DiningBatch`、`DiningVoidLine`），以及 `SaleRecord.diningBatchId` 一个可空列 |
| 设置页 | 只放桌号二维码入口，不变 | 不向设置页加入任何桌台入口 |
| schema / migration | 第 19 节「本轮不新增」继续约束 V1 各阶段 | 模块所需表结构须经独立审查与 Founder 精确授权后单独执行，不由开发者自行增加 |

**A1.4 命名（仅限堂食模块之内）**
允许使用「堂食」「堂食开桌」「桌台」「开桌」「加菜」「清台」。第 7 节的命名禁令对 Desktop V1 的营业页、管理中心、设置页继续有效；除 A1.5 的入口按钮外，这些页面不得出现上述词汇。

**A1.5 入口**
营业页左栏「退出全屏」旁增加一个「堂食开桌」按钮，仅当门店满足新业务条件（启用、餐饮行业、试点名单、本地 V3 打印模式、Desktop 请求）且操作人鉴权通过时显示；条件不满足但该店仍有未结堂食账单时，按钮文案为「处理未结堂食账单」。除这一个按钮外，本模块不改变营业页的任何布局、状态机或文案。

**A1.6 对冻结原则的承诺及其实现方式**

1. **不另造第二套 POS。** 商品读同一接口；消费金额只写入现有 `SaleRecord`，收款只写入现有 `PaymentIntent`；模块新增的表不保存任何金额；报表口径不变；不新建商品、库存或账务存储。
2. **以门店挂单为基础。** 未结消费即 `PENDING_PAYMENT` 销售行，路径与第 7 节一致：桌台 → 未结账单 → 追加 → 结账。模块只增加第 7 节所说「真正缺失的 table-domain 概念」：桌台、一次用餐、批次。
3. **不抽离收银内核。** 模块自带选品视图，不 import 也不拆分 `CashierPage` 的内部实现。
4. **不新增打印链路。** 使用现有 Desktop 打印桥与现有渲染器；不改 V2 合同，不改 V3 身份规则，不改 Printing Core。
5. **不破坏 Browser fallback 与现有可工作路径。** 模块不可用时，营业页行为与今天完全一致。

**A1.7 对 Open Questions 的处置**
第 8 项由本增补回答为「作为独立模块、在试点门店先行」。第 9 项由模块的 Architecture Pack 回答，以其独立审查结论为准。

**A1.8 已由 Founder 确认的产品选择（2026-10-10）**

1. 用餐中的堂食账单在现有「门店挂单」处可以查看；旧的挂单结账与取消入口对堂食账单一律拒绝。
2. 首版只对处于本地 V3 打印模式的试点门店开放。
3. OWNER / STAFF 操作矩阵：退菜、撤台、桌台维护仅 OWNER；其余 STAFF 可做。Desktop 以本机授权运行时角色恒为 OWNER，这是现有身份模型的边界，页面明示。
4. 结账前退掉厨房可能已收到的菜，出退菜通知；厨房是否收到无法确定时，必须先当面向厨房核对。

首版不含：`PAYMENT_PENDING` 状态、认领既有付款、通用恢复平台、第二套商品 / 库存 / 账务 / 打印系统、H5 并入、预订、并桌、拆账、离线、会员支付。

**A1.9 生效**
本增补经 Founder 批准并以独立治理 change set 合并进入 `origin/main` 后生效。生效不等于任何 exception 处于 ACTIVE，也不等于功能已验收。
