# 会员系统 V1 Browser / Playwright 验收清单

本文件为 Browser 验收清单，不替代真实 Telegram 真机测试，也不替代 Obsidian 开发/冻结记录。

适用范围：会员系统 V1 已上线后的所有会员相关小补丁、页面调整、API 兼容修复、入口调整、Browser smoke 回归。

当前前提：

- 会员系统 V1 已完成并真机通过。
- Browser-Setup-01 已完成，项目可使用 Playwright 做线上基础 smoke。
- Member-TG-01A 后端底座已冻结，Telegram 会员能力后续必须在冻结底座上小步追加。
- 本清单只定义验收，不要求创建真实业务数据，不要求触发真实收银或真实支付。

## 1. 验收原则

1. Browser smoke 用于快速发现白屏、路由错误、关键入口缺失、明显 API 错误、控制台错误。
2. Browser smoke 不替代 OWNER / STAFF 真机验收。
3. Browser smoke 不创建真实大额订单，不调整真实会员余额，不触发真实 KHQR。
4. 会员相关改动必须保护已通过链路：
   - `/members`
   - `/members/[id]`
   - `/home` 会员入口
   - `/cashier` 会员余额支付入口
   - `/records` 会员余额展示
   - CASH / KHQR 主收银链路
5. 如果 Browser smoke 出现 `会员加载失败`、Prisma P2021/P2022、白屏、Application error，不能进入真机验收。

## 2. 必测页面

### 2.1 `/home`

验收目标：确认会员入口不会破坏首页首屏和快捷操作。

检查项：

- 页面能打开，非 404 / 500。
- 页面 body 有可见内容，不白屏。
- 不出现 `首页数据加载失败，请稍后重试`。
- OWNER 模式下可见 `会员管理` 入口。
- `会员管理` 点击后可进入 `/members`。
- 快捷操作区域不因会员入口导致明显布局挤压。
- 语言切换、模式展示不出现明显异常。

允许：

- 无登录态 smoke 只能检查页面是否可打开和是否无关键错误。

不允许：

- `Application error`
- `首页数据加载失败`
- 关键入口缺失且不是权限原因

### 2.2 `/members`

验收目标：确认会员列表页可以加载，入口、搜索、新建按钮可见。

检查项：

- 页面能打开，非 404 / 500。
- 页面标题或主区域可识别为会员页面。
- 不出现 `会员加载失败，请重试`。
- 无会员时显示可理解空态，例如 `暂无会员`。
- 有会员时列表正常展示：
  - 会员姓名
  - 手机号或空手机号提示
  - memberCode
  - 余额
  - 状态
- 搜索框可输入。
- 搜索可覆盖：
  - 姓名
  - 手机号
  - memberCode
- `新建会员` 入口可见。
- OWNER 可见 `导入旧 POS 会员` 入口。
- STAFF 不应看到导入入口，或后端会拒绝导入。
- 页面有 `返回首页` 入口。

不允许：

- `会员加载失败`
- Prisma P2021 / P2022
- `[object Object]`
- `NaN`
- 余额空白或渲染异常

### 2.3 `/members/[id]`

验收目标：确认会员详情页能展示档案、余额和流水。

前提：如果当前线上已有会员，可从 `/members` 列表点击进入；如果没有会员，不强行创建真实会员，仅记录“无现有会员，详情页未测”。

检查项：

- 详情页能打开，非 404 / 500。
- 会员资料卡正常展示：
  - 姓名
  - 手机号
  - memberCode
  - 状态
  - 当前余额
  - 备注
  - 创建时间
- 余额流水区域可见。
- 流水展示包含：
  - 类型
  - sourceType
  - amount
  - balanceBefore
  - balanceAfter
  - note
  - createdAt
- OWNER 可见 `充值` / `调整余额` 按钮。
- STAFF 只读，不能直接操作充值/调整。
- 返回 `/members` 入口可用。

不允许：

- 余额出现 `NaN`、`[object Object]`、精度明显异常。
- STAFF 前端可直接操作高风险余额按钮。
- 页面白屏或接口错误被吞掉。

### 2.4 `/cashier?storeCode=ST169E7000`

验收目标：确认会员余额支付入口存在，但不破坏 CASH / KHQR 主链路。

检查项：

- 页面能打开，非 404 / 500。
- 商品 / 购物车 / 金额区域无明显异常。
- CASH 原入口仍存在。
- KHQR 原入口仍存在。
- 会员余额支付入口存在。
- 离线状态下会员余额支付入口应禁用或提示不可用。
- 会员手机号查询框或入口不影响普通商品加入购物车。

Browser smoke 禁止：

- 不创建真实大额订单。
- 不触发真实 KHQR。
- 不扣真实会员余额。
- 不修改 OfflineSaleSyncMap。

### 2.5 `/records`

验收目标：确认会员余额支付记录兼容显示，不破坏 CASH / KHQR / 离线补同步记录。

检查项：

- 页面能打开，非 404 / 500。
- 记录列表或空态正常。
- CASH 旧记录展示正常。
- KHQR 旧记录展示正常。
- 如果存在 MEMBER_BALANCE 记录，应显示为 `会员余额`。
- 离线补同步标签仍正常显示。
- 不出现 MEMBER_BALANCE 未知枚举错误。

不允许：

- records 白屏。
- records 排序或筛选明显异常。
- 会员余额记录导致整页报错。

## 3. 必测按钮和入口

后续会员相关改动至少检查：

- `/home` → `会员管理`
- `/members` → `返回首页`
- `/members` → 搜索框
- `/members` → `新建会员`
- `/members` → `导入旧 POS 会员`（OWNER only）
- `/members` → 会员详情入口
- `/members/[id]` → `充值`（OWNER only）
- `/members/[id]` → `调整余额`（OWNER only）
- `/cashier` → `会员余额`
- `/cashier` → CASH
- `/cashier` → KHQR
- `/records` → 记录卡片支付方式展示

## 4. 必测 API

Browser smoke 阶段不一定直接调用 API，但页面异常时必须定位到具体接口。

会员系统 V1 必测或重点关注：

- `GET /api/members`
- `POST /api/members`
- `GET /api/members/[id]`
- `POST /api/members/[id]/recharge`
- `POST /api/members/[id]/adjust`
- `GET /api/members/lookup`
- `POST /api/members/import/dry-run`
- `POST /api/members/import/confirm`
- `GET /api/cashier/member-lookup`
- `POST /api/cashier/member-balance-pay`
- `GET /api/records` 或 records 页面实际使用的记录接口
- `GET /api/me`

API 异常时必须记录：

- HTTP status
- error code
- response body 中的安全错误信息
- 是否是 auth/session/store context 问题
- 是否是 Prisma P2021 / P2022

## 5. 必测角色

### OWNER

OWNER 应能：

- 在 `/home` 看到会员管理入口。
- 打开 `/members`。
- 新建会员。
- 导入旧 POS 会员。
- 打开会员详情。
- 充值。
- 调整余额。
- 在 `/cashier` 查询会员并使用会员余额支付。

### STAFF

STAFF 应能：

- 继续使用 `/cashier` CASH / KHQR。
- 如产品允许，可只读查看会员或商品相关页面。

STAFF 不应能：

- 导入旧 POS 会员。
- 充值。
- 调整余额。
- 绕过后端 OWNER 权限。

Browser smoke 无真实登录态时，不强制覆盖角色差异；真机测试必须覆盖。

## 6. 错误文案和控制台检查

Browser / Playwright 必须捕获：

- `console.error`
- `pageerror`
- failed request（如测试脚本支持）
- 页面截图

出现以下文案或错误，应判定失败：

- `首页数据加载失败`
- `会员加载失败`
- `请稍后重试`（出现在核心页面主区域时）
- `Member table does not exist`
- `Prisma P2021`
- `Prisma P2022`
- `Application error`
- `500`
- `404`
- `MEMBER_BALANCE` 未知枚举
- `NaN`
- `[object Object]`

允许出现：

- `暂无会员`
- `无记录`
- `无待处理订单`
- 权限不足提示（前提是角色不具备权限）

## 7. API 异常时页面提示要求

页面可以显示友好错误，但不能只给开发者不可定位的模糊失败。

最低要求：

- 会员列表加载失败：页面显示可理解提示，console 或网络日志能定位真实 API。
- 新建会员失败：展示明确原因，例如手机号已存在、无权限、门店上下文丢失。
- 导入失败：展示行号和错误原因。
- 会员余额支付失败：余额不足、会员不存在、离线不可用需要明确提示。

## 8. 后续会员功能改动 Browser smoke 最小清单

### 必测页面

- `/home`
- `/members`
- `/members/[id]`（有会员时）
- `/cashier?storeCode=ST169E7000`
- `/records`

涉及 Telegram 会员绑定时额外测：

- `GET /api/telegram/member-bind?token=xxx`
- 后续顾客确认页（TG-01B 实现后）

### 必测按钮

- 会员管理
- 返回首页
- 新建会员
- 导入旧 POS 会员
- 会员详情
- 充值
- 调整余额
- 会员余额支付
- CASH
- KHQR

### 必测 API

- `GET /api/members`
- `POST /api/members`
- `GET /api/members/[id]`
- `POST /api/members/[id]/recharge`
- `POST /api/members/[id]/adjust`
- `GET /api/cashier/member-lookup`
- `POST /api/cashier/member-balance-pay`
- `GET /api/records`

### 必测角色

- OWNER
- STAFF

### 必测回归点

- CASH 不受影响。
- KHQR 不受影响。
- `/sale` 不受影响。
- `/records` 不白屏。
- Dashboard 不受影响。
- OfflineSaleSyncMap 不受影响。
- 离线模式下会员余额支付禁用。
- 会员余额支付不写入 IndexedDB 离线订单。

## 9. 通过 / 失败判定

### 通过

满足以下条件可判定 Browser smoke 通过：

- 必测页面可打开。
- 无白屏。
- 无关键错误文案。
- 无明显 console error / pageerror。
- 关键入口存在。
- 受保护主链路入口仍存在。
- 截图已生成。

### 失败

出现以下任一情况必须失败：

- 关键页面 404 / 500。
- 页面白屏。
- 会员列表加载失败。
- 首页关键错误影响入口。
- Prisma P2021 / P2022。
- MEMBER_BALANCE 导致 records 报错。
- CASH / KHQR 入口消失。
- STAFF 可见高风险 OWNER 操作且后端未拦截。

## 10. 回报格式

每次会员相关 Browser smoke 按以下格式回报：

1. Browser 验收结论
2. Production commit
3. Deployment State
4. `/home` 验收结果
5. `/members` 验收结果
6. `/members/[id]` 验收结果
7. `/cashier` 验收结果
8. `/records` 验收结果
9. OWNER / STAFF 覆盖情况
10. 控制台错误 / pageerror
11. 关键错误文案检查结果
12. 是否创建或修改任何数据
13. 截图 / 报告路径
14. 是否建议进入真机验收

## 11. 与真机测试的关系

Browser smoke 通过后，仍需按真机模板验证：

- iPhone Telegram Mini App
- Android Telegram Mini App，如有条件
- OWNER
- STAFF
- 顾客端 H5，如本次改动涉及
- 真实门店低风险小额试跑，如本次改动涉及收银

会员系统相关真机通过后，必须同步 Obsidian 开发记录或冻结记录。
