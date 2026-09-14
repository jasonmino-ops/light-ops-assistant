# ES-DESKTOP-UX-01 — Development Blueprint V1.0 FINAL

```
BLUEPRINT STATUS             = FINAL
DESIGN FROZEN                = YES
Implementation Authorization = NO
```

> 本文件是店小二 Desktop 后续所有开发任务的**唯一设计基线**。
> 冻结日期：2026-09-14　·　裁定人：Founder
> 基线仓库：`origin/main`　·　治理引用：根 `AGENTS.md`（149 行精简治理路由器版本）
> 配套文档：`es-desktop-ux-01-roadmap-v1-final.md` · `es-desktop-ux-01-freeze-record.md`

---

## 1. Blueprint Purpose / Scope

本文件定义架构边界、产品语义与约束，**不定义实现步骤**。

**适用范围：** Windows 商户桌面端（`desktop/` E-Shop Desktop）及其与 Web 业务层、打印 Runtime、云端的关系。

**不适用范围：** 手机端 / Telegram Mini App 产品设计、打印核心实现、云端业务逻辑。

### 八条总体定位

1. 长期 Windows 统一入口是 `desktop/` **E-Shop Desktop**。
2. **RC9 / Network Printing Add-on 不再承担商户主 UI**；它是当前 canonical production printing implementation。
3. **HRT / Windows Provider = Frozen Dormant Capability Framework** —— 已实现、未 FIELD、不扩张、不替换 RC9、不退役。
4. **0.4.7 = LEGACY / TRANSITIONAL / TO BE RETIRED** —— 当前不删除，满足 Retirement Gate 后才可另立退役任务。
5. **Browser POS 是一等正式 fallback**（见第 4 节最终措辞）。
6. **Desktop 管环境**：本机能力、窗口、显示器、Runtime、Health、Activation。不承担业务逻辑解释。
7. **Web Business UI 管业务**：商品、订单、收银、会员、报表、门店管理。
8. **Printing Runtime 独立运行** —— Desktop 可观测其状态，但不直接发业务打印命令。

---

## 2. Product Principles

**P1** 打开 Desktop 后，**环境自动恢复，业务访问不自动恢复**。
**P2** 正常状态尽量不打扰商户。
**P3** 自动恢复优先于让商户进入设置。
**P4** 营业页面只保留高频营业动作。
**P5** 管理、设置、技术能力逐层下沉。
**P6** 技术复杂度不暴露给普通商户。
**P7** 所有绿灯 / 正常 / 运行中必须有真实证据。
**P8** 不允许把「已配置」冒充「已连接」。
**P9** 不允许把「Runtime 运行中」冒充「Printer 在线」。
**P10** 不允许把未实现能力先画成可用能力。
**P11** UI 重构不得借机重构收银核心。
**P12** Desktop 重构不得借机重构打印核心。
**P13** Browser / Desktop 两条路径不得互相破坏。
**P14** 不删除已存在能力，除非另有明确退役任务。
**P15** 真实业务能力优先复用现有页面 / API / 权限。
**P16** Web / Electron 分层判据见第 3 节（多因素，非单一标准）。
**P17** 不知道就说不知道——证据过期时降级为「无法确认」，既不保持绿色也不变红。
**P18** 不要建模你测不到的东西。

**P19 状态色语义**

> **红色 = 核心营业被阻断，或继续操作存在明确业务 / 安全风险。**

未来可能纳入红色的情形包括：核心收银链不可用 · Operator 身份失效导致业务不可继续 · 关键业务状态使继续操作存在明确风险。

**继续冻结：打印机故障、顾客屏故障、非关键外围设备异常，不得仅因此把整体营业状态变红。**

原则不变：**非关键设备故障不得阻断收银。**

---

## 3. Desktop Technical Architecture V1

```
┌─ Cloud ──────────────────────────────────────────────────┐
│ 业务数据 · 身份/门店 · Print Job / execution evidence      │
│ Remote audit                                              │
└───────────────────────────────────────────────────────────┘
        ↑ HTTPS（可断；断了必须还能卖）
┌─ Web Business UI（连续发布，改了立刻生效）──────────────────┐
│ Product · Sales · Cart · Orders · Checkout · Hold         │
│ Refund · Member · Reports · Store management              │
│ Management Center · Settings（纯 Desktop 环境设置除外）     │
└───────────────────────────────────────────────────────────┘
        ↑ preload 契约：窄接口 · 能力白名单 · 调用方校验 · 最小暴露
┌─ Electron Desktop Shell（随安装包发布，改一次要装一次）──────┐
│ Application lifecycle · Activation · Window management     │
│ Fullscreen · Multi-display · Tray · Single instance        │
│ Local IPC · Credential storage · Runtime supervision       │
│ Native health · Display assignment                         │
└───────────────────────────────────────────────────────────┘
        ↑ Local Printing Status Contract V1（见第 14 节）
┌─ Printing Runtime（独立进程 · 独立安装 · 独立版本）─────────┐
│ Print job polling · FRONT/KITCHEN routing                  │
│ Rendering / transport · execution journal                  │
│ local printing status · cloud result evidence              │
└───────────────────────────────────────────────────────────┘
```

**preload 契约措辞：** 不写「只读」。真实能力包含 fullscreen enter/exit、display swap、display redetect、lock / switch 等环境动作，这些是**受控的能力调用**，不是只读读取。

Electron 安全边界不变：`contextIsolation` · `sandbox` · `nodeIntegration: false` · IPC whitelist · sender validation（含主 frame 校验与角色分表）。

**Desktop V1 角色定义（冻结）：Shell · Environment Manager · Health Observer。** 不是打印宿主、不是业务逻辑宿主、不是数据宿主。

### 三条边界规则（冻结）

**规则 A —— 分层判据（多因素）。**

「改一次是否必须重装 Desktop」是**重要判断标准之一，不是唯一标准**。同时必须考虑：**OS 权限 · 安全边界 · 生命周期 · 原生能力 · 故障恢复需求**。

在发布节奏这一维度上：凡必须能在不重装的情况下修复的东西，原则上不进 Electron——小票模板、价格、税、促销、报表口径、业务文案、任何 i18n。依据是真实成本：安装包未签名、撞 SmartScreen、按 Windows 用户装。

**规则 B —— Electron 可以透明搬运业务数据，不得解释它。** 主进程不得计价、算税、算折扣、推导交易状态。一旦主进程算钱，Browser 与 Desktop 两条路径就会算出不同的数。

**规则 C —— 环境策略属于 Electron。** 自动全屏、多屏、Runtime 生命周期由主进程决定初始态；Web 只在用户明确操作时请求改变。

### 绝不进 Web 业务页面

显示器分配 · 窗口生命周期 · Runtime 进程监督 · 凭据存储 · 设备身份 · 开机自启 · 单实例锁。

另加：**打印任务的领取绝不能依赖某个浏览器标签页开着。**

### 绝不进 Electron 主进程

规则 A 覆盖的全部 · 任何数据库 / ORM 访问 · 任何业务 API 鉴权逻辑 · 任何需要 DOM 的渲染器（**谁持有渲染器，谁就被迫带一个浏览器环境**）。

### Desktop 与 Printing Runtime：互为可选

Printing Runtime 缺失 / 停止 / 崩溃 / 版本不同时，Desktop 必须能启动、能收银、能结账。Desktop 未运行时，Printing Runtime 必须能领取并执行打印任务。

后者今天不成立（RC9 依赖 0.4.7 的 identity 文件），解除该依赖属独立任务，不在本蓝图范围。

---

## 4. Browser / Desktop Strategy V1

**冻结：Desktop = 标准 Windows 商户路径；Browser = 一等正式 fallback。**

> **所有不依赖 Desktop 原生环境 / 本地硬件的业务能力，应保持 Browser 可用。**
>
> **Desktop-only 只能来自明确的：OS 能力 · 本地硬件能力 · Desktop environment capability。**
>
> **不得仅因为实现方便而把业务能力做成 Desktop-only。**

**Browser 应长期支持：** 商品 · 购物车 · 收银 · 挂单 · 顾客订单 · 会员 · 退款 · 报表 · **Management Center** · Business Settings。

**Desktop-only 环境能力（不要求 Browser 等价）：** 自动全屏 · 双屏自动分配 · 互换屏幕 · Tray / 自启 · Runtime supervision · 原生 health · **Desktop-local Operator PIN** · Technical diagnostics · Windows device trust。

**测试矩阵规则：** 业务测试只跑一遍（Web 层），环境测试只在 Desktop 上跑。

**隐藏规则：** 环境面板在 Browser 下**整块不渲染**，不是灰色不可用。

**防漂移：** Browser 的 Management Center 由现有 OWNER session 授权，**不得因为 Desktop 引入 PIN 而在 Browser 侧增加任何 PIN 门槛**——Browser 不存在 PIN。

---

## 5. Operator & Privilege Architecture V1

### 四层互不相等（冻结）

```
Device Identity ≠ Operator Identity ≠ OWNER Action Authorization ≠ Technical Support
```

| 层 | 回答什么 | 由谁承担 |
|---|---|---|
| Identity Root | 这个人是谁 | Telegram + `User` + `UserStoreRole` |
| Device Identity | 这台电脑属于哪家店 | Desktop Activation / Device Binding |
| **本机营业 PIN** | **现在是谁在操作 / 老板是否批准** | 本节 |
| Technical Support | 本机环境与诊断 | 本机临时解锁 |

**Telegram 的角色明确降为：Identity Root · Enrollment · Recovery。**

### Operator Lock 启动序列

```
Windows 开机 → Desktop 自启 → Device Activation 自动恢复
→ Runtime / Printing / 顾客屏 / 网络 自动准备
→ 【本机营业锁屏】→ 选择操作人员 → 输入 6 位 PIN → 营业前台
```

**锁屏时允许：** Runtime · Printing Runtime · Customer Display · Network / Health · 自动恢复 · Technical Support unlock。

**锁屏时禁止：** 收银 · 退款 · 业务写入 · 会员余额操作 · OWNER 管理能力。

操作人列表来自该门店 `UserStoreRole`（status ACTIVE）——**按门店取，不按租户取**。

### PIN 产品定义（冻结）

> **本机营业 PIN = 已授权门店 Desktop 环境上的操作人快速确认凭证。**
> 回答「现在是谁」与「老板批不批」，不回答「这个人是谁」。

**必须：** 映射到现有 `User` · 继续只有 OWNER / STAFF · 6 位 · 不存明文 · 必须有失败锁定 · 在线 / 服务端验证优先。

**不是：** 账号密码 · Telegram 替代品 · 手机登录凭证 · Browser 必须共用的凭证 · 全网 Credential · 第二套 User 体系 · 新增店长的理由 · 重构 session/auth 的理由 · 建设 Credential Framework 的入口。

**作用域粒度：** 默认作用于**已授权门店 Desktop 环境**。是否精确绑定 `User × Store × Device` 还是 `User × Store`，**由未来 Operator PIN 独立任务的 Pre-Development Audit 决定**。不为「本机」二字提前做重。

**「本机」指作用域，不指验证位置。** 在线 / 服务端验证优先——本地验证需要本地凭据存储、哈希、失败计数与吊销机制，即本蓝图禁止的「本地密钥体系」。

> **注：上述为边界，不是永久不可变的实现规定。** 最终具体验证实现仍由未来 Operator PIN Pre-Development Audit 在本蓝图边界内决定。

**断网重启后的 PIN 解锁行为保持 OPEN**，不提前设计离线 Credential cache。

### OWNER Operator Login

老板选自己 + 本机 PIN → 建立 **OWNER Operator 状态** → 可进入 Desktop OWNER Management Center。**不要求老板每天重新打开 Telegram。**

明确记录的取舍：**6 位数字将守护全店财务视图与门店配置。** 支撑它的是设备已被门店授权、老板本人在自己柜台前、失败锁定存在。**这是被明确接受的权衡。**

### STAFF Operator Login

STAFF 选自己 + PIN → **STAFF Operator 状态** → 进入 STAFF 范围营业能力（第 18 节权限分类）。

**STAFF Operator 状态永远不会因任何 PIN 输入而变成 OWNER 状态。**

### OWNER 单次授权

```
STAFF 正在操作 → 敏感动作 → 要求 OWNER PIN
→ 只批准当前动作 → current operator 仍是 STAFF
```

目标记录：`operatorUserId = STAFF` · `authorizedByUserId = OWNER`。

**V1 只定义单次授权。** 不提前设计 5/10/15 分钟窗口 · ACL · Policy Engine · 动态 Scope Token。

支撑事实：`SaleRecord` / `PaymentIntent` / `MemberBalanceLedger` / `CustomerOrder` 四个模型**已有成对的** `operatorUserId` + `authorizedByUserId`。

### Lock / Switch Operator

必须支持**锁定收银台**与**切换营业员**，且：不关闭 Desktop · 不停止 Runtime · 不停止 Printing · 不破坏顾客屏。

> **Lock 不得因为锁屏本身丢失当前交易状态。**
>
> **锁定后的未完成交易，在 Operator 切换后的可见性、恢复方式与归属，属于未来 Operator implementation task 的显式设计项，本 Blueprint 不提前假定。**

设计要求：**切换必须比「凑合用上一个人的身份继续」更省事**，否则店员不会切，归属数据当天退化成噪声。

### Legacy Device→OWNER Constraint

当前 device authorization fallback 会把门店 OWNER 当作 operator。**定义为 Legacy Operator Attribution Constraint，本蓝图不修。**

长期目标：`Device Identity + Operator Identity → POS Authorization`。

**硬约束：在新 Operator Login 取得真机 FIELD VERIFIED 之前，不得直接关闭旧 fallback**，否则破坏现有 V727 / Browser / Desktop 可工作路径。

**历史数据警告：Operator Login 上线前，由 device fallback 产生的 `operatorUserId` 不能被当作可靠的真实营业员归属。** 基于该字段的人效、班次、异常归因分析在该时间点之前都不成立。

### PIN Persistence（不冻结 schema）

**四项最小要求：** PIN verification material（不存明文）· failed attempts / lock state · 与现有 `User` / `Store` 的归属 · 设置 / 重置时间信息。

**三条禁止：** 不改 `User` 模型硬塞 PIN · 不改现有 session / auth · 不建大型 Credential Framework。

具体持久化结构由未来独立任务审计决定。

### 手机 OWNER（未来轻量能力，非 V1 依赖）

未来可：查看哪些员工已设置 PIN · 已设置 / 未设置 · 重置或清除。

**不要求：** 在手机设置 PIN · 绑定 PIN · 明文查看 PIN · 成为登录必经路径。

**Desktop 本机必须能完成最小设置与 OWNER 管理。**

---

## 6. Sales Workspace Architecture V1

**当前真实工作流：Direct Sale / Counter Sale。未来扩展：Table Service / Restaurant。**（不使用「Retail Mode」命名。）

### 当前 Direct Sale 保留并复用的真实收银链

商品分类 · 商品卡片 · 搜索 / 扫码 · 顾客订单 · 本地挂单 · 门店挂单 · 购物车 · 支付 · 会员余额支付 · 在线 / 离线业务状态 · 收款结果。

### 演进原则：Shell-first · Extraction-by-necessity

**不大重构 5416 行 cashier。** 优先用 Desktop shell **包裹**现有 `CashierPage`——这条接缝已被验证（`/desktop/pos/page.tsx` 仅 40 行，组合而非改写）。

**不得为了代码整洁先抽离：** checkout state machine · payment handlers · offline sale path · scan path · cart mutation · customer order state/actions。**这些是核心业务内核。**

**可逐步抽离的仅是纯展示 / 外壳区域。**

### 隔离规则（冻结）

> **管理中心不得 import cashier page 内部实现。新管理能力应通过 `lib/*`、API、已有页面实现。**

**防漂移：** 若某功能**必须新建 API 才能重建**，即说明它尚未就绪——**停止并报告，不得顺手新建 API**。该规则的价值正在于它是一个就绪判据，不是一道绕过去的门。

### 命名约束

组件边界不得抹掉数据模型已有的区分：待处理顾客订单 ≠ 门店待收款挂单；本地挂单（localStorage、含 checkoutStep、仅本浏览器）≠ 门店挂单（云端、手机也能结）。

---

## 7. Restaurant / Table Service Position V1

### 当前真实状态

**不存在：** Table entity · Open Table · Table Session · Add Items · Table Bill aggregation。

**只有：** `CustomerOrder.tableNo`（可空字符串）· table QR generator（客户端生成，不落库）· `DEFERRED_PAYMENT` · `PENDING_PAYMENT` · 现有 checkout / printing / SaleRecord。

### 长期方向（冻结）

**Table Service 不得另造第二套 POS。** 必须最大化复用 Product · Order · Pending Payment · Checkout · Payment · Printing · SaleRecord · Reporting，只增加真正缺失的 table-domain 概念。

```
Table → Active Bill / Pending Payment → Append Items → Checkout
```

**最重要的复用判断：Table Service 的现有基础是「门店挂单」，不是「桌号二维码」。** `DEFERRED_PAYMENT` + `PENDING_PAYMENT` 的语义就是先开单后结账，已跨设备、已接通结账与打印。

### V1 处置

**Restaurant / Table Service = Explicit Non-Goal for V1。**

Settings 中只允许「**桌号二维码**」，指向现有 `/table-qrcodes`。

**不得命名为：** 桌台管理 · 桌台状态 · 开桌管理。

### 不写死 Direct Sale 的四条可检查约束

1. 主区不得把「一个购物车 = 一笔交易」写成唯一模型。
2. 待处理顾客订单面板不得被做成次要抽屉——餐饮场景下它是主路径。
3. 结账状态机不得假设购物车内容只能来自「点击商品卡」。
4. 「挂单」概念不得被改名为零售专有词。

---

## 8. Membership Architecture Position V1

```
Member  ≠  Customer  ≠  Coupon account
```

| | Member | Customer / Coupon |
|---|---|---|
| 主键 | `memberCode` / `phone` / `telegramId`（按门店） | `telegramId`（`StoreCustomerContact`，按 storeCode） |
| 载体 | `Member` + `MemberBalanceLedger` + `SaleRecord.memberId` | `CustomerCoupon` / `CouponTemplate` / `CouponRedemption` |
| 在哪里用 | **收银台**（余额支付） | `/menu` 顾客自助点单、`/me/coupons` |
| 收银员能否代用 | 能 | **不能** |

**Desktop V1 Management Center 允许：** 会员管理 · 会员余额流水。

**不加入：** CRM · 营销触达 · 优惠券管理 · 积分。

**当前无 Points / Loyalty 系统。Blueprint 与 UI 禁止出现「积分」。**

不放进 Desktop V1 ≠ 删除。

### 会员与支付解耦（方向，非本轮实施）

**长期冻结：Member identity 独立于 Payment method。** 允许 `Member = Jason · Payment = CASH`，也允许 `Payment = MEMBER_BALANCE`。

**现状限制：** 当前只有选择 `MEMBER_BALANCE` 后才能查会员。本蓝图只冻结方向，**不实施独立会员绑定入口**。

### 优惠

当前 cashier 没有真实优惠来源（`discountAmount: 0` 硬编码，无券能力）。

**不得把「优惠」表现成已可用业务能力。** 现有只读显示「优惠 −$0.00」可保留，**不得做成可点击 / 可编辑的入口**。

柜台优惠券核销继续 OPEN。

---

## 9. Desktop Information Architecture V1

```
【本机营业锁屏】        ← 业务访问之前的门
        ↓
   营业前台      ┐
   管理中心      ├── 商户业务 IA
   设置          ┘

   技术支持模式   ← 环境诊断旁路，不是业务层
```

**「四层」指 {Operator Lock, 营业前台, 管理中心, 设置}。技术支持是旁路，不是第五层。**

**分界线（冻结）：管理中心持状态与业务动作；设置持配置。**

### 必须留在营业前台

商品分类 · 商品卡片 · 搜索 / 扫码（含 `/` 聚焦与 HID 隐藏输入框）· 购物车与数量 · 挂单与恢复 · 收款 · **在线 / 离线状态与待同步计数** · 待处理顾客订单计数 · 会员查询与余额支付入口 · 语言切换 · 退出全屏 · 管理中心入口 · **打开顾客屏（仅 Browser 环境）**。

**离线状态不是设备信息，是业务约束。** 离线时仅支持 CASH，不支持 KHQR，不支持会员余额。藏起来等于让收银员在不知情时对顾客说「可以扫码付」。

**「打开顾客屏」必须按环境条件渲染，不能无条件移除。** 浏览器不允许脚本在无用户手势时自动在第二块屏开全屏窗口；V727 当前真实形态正是 Browser 路径。

---

## 10. Management Center IA V1

```
1. 营业
   销售记录 · 门店挂单 · 交班 / 日结 · 退款 · 补打小票

2. 商品与数据
   商品管理 · 经营数据 · 商品报表

3. 会员
   会员管理 · 会员余额流水

4. 门店
   员工 / 邀请 · 门店配置† · 收款设置† · 桌号二维码† · 多门店入口

5. 系统
   设备与系统状态‡ · 设置† · 关于与支持
```

**† 跳转入口，唯一实现位置在设置（第 11 节）。**

**‡ 一处实现、两处呈现：**「设备与系统状态」与设置右侧状态栏共用**单一状态源**（Runtime Health + Local Printing Status Contract）与**单一渲染组件**，不得各建一套。

**不增加 Dashboard。不做会员营销分类。不显示钱柜「预留」。**

**TikTok / 达人推广：** 手机 / Web Owner 为主场景，Desktop 最多轻入口，不作为一级模块，不做 Desktop 专属实现。其产出是要复制进 TikTok App 的文案与脚本。**顾客触达 / Coupon marketing 同理。**

### 形态约束

**导航外壳，不重写老板后台。** 优先复用现有 Web 页面 / API / 权限。

必须预先接受：`/products`（4928 行）、`/dashboard`（2530 行）等页面是手机形态的，嵌进大屏会显得窄。**V1 照原样接入并接受它不好看**，版式适配留到试点之后，**绝不因此重写**。

### STAFF Management

STAFF **不看到完整 OWNER Management Center**，只显示真实允许的：营业相关 · 自己可看的记录 · 挂单 · 系统状态（只读）· 帮助。

**具体权限必须遵守真实后端权限。不能把 `effectiveRole` 的视觉隐藏当作安全边界**（C15）。

---

## 11. Settings IA V1

```
门店    门店信息 · 收款设置 · 语言 · 桌号二维码
设备    打印设备 · 显示器设置（Desktop-only）· 自动打印
系统    Desktop 偏好 · 关于店小二
```

右侧常驻系统状态，**只显示有真实数据源的项**；与第 10 节的「设备与系统状态」共用同一实现（见 ‡ 注记）。

**Technical Support 不进入普通 Settings 导航。**

---

## 12. Technical Support IA V1

**只负责：** Runtime / version · Display raw info · Printing diagnostics · Endpoint / role / transport · journal / error code · identity / binding diagnostics · logs · diagnostic export · native recovery actions。

**禁止：** 收银 · 查看 OWNER 财务数据 · 任何业务权限 · **绕过 Operator Lock**。

**解锁方式：** 本机触发 · 默认隐藏 · 有时限 · 自动失效 · 不进入业务 role schema。

---

## 13. Printing Architecture Position V1

**RC9 Network Printing = V1 canonical production printing implementation。** 唯一具有真实 FRONT / KITCHEN FIELD 证据的打印路径。Desktop V1 的打印状态整合**只面向**这条路径。

**HRT / Windows Provider = Frozen Dormant Capability Framework。** 已实现、未 FIELD。**不扩张 · 不替换 RC9 · 不退役**；仅当未来出现明确的 USB / 钱箱 / 秤 / 本地硬件真实需求时重新评估。

**Desktop V1 不直接发业务打印命令。** 打印路径保持：

```
Business / Cloud Print Job → Independent Printing Runtime → Physical Printer
```

**Offline Printing 是独立 Open Question。** 未来若要改变此边界，**必须重新走 Architecture / Founder Gate**。

---

## 14. Local Printing Status Contract V1

> **Desktop 依赖的是契约，不是 RC9 的内部 state 文件。**

RC9 是这份契约的**第一个 producer**，不是契约本身。其内部状态由它自己的需要塑形并持续变化，**Desktop 不得直接读取或解析**。

**目的：Local operational truth。**

**防漂移：契约的 producer 侧实现属打印链改动，需独立授权**，不得在 Desktop 任务中顺手改 RC9。

### 最小字段语义

`schemaVersion` · `producerVersion` · `seq`（单调递增）· `writtenAt`（**stale 判定唯一依据**）· **Windows user identity** · **Windows session identity（若可获得）** · configured roles · configured endpoints · latest execution result · result code。

### 工程要求

**atomic write** · **stale detection**（按 `writtenAt` 老化，**不得依赖任何「我要退出了」消息**——崩溃永远不发那条消息）· **forward-compatible parser**（读到更高 `schemaVersion` 时渲染为「打印服务版本较新，状态暂不可读」）· **readable / debuggable** · **Runtime 与 Desktop 可独立升级**。

### Windows 多用户语义

状态位于 per-user `%APPDATA%`（`perMachine: false`）。

- **若 Desktop 能获得可靠的跨用户证据** → 可以明确提示「打印服务运行用户与当前用户不一致」。
- **若 Desktop 无法获得可靠的跨用户证据** → **不得猜测**，显示「打印服务状态暂时无法确认」。

**本蓝图不假装 V1 已具备跨用户进程发现能力。**

Multi-Windows-user duplicate print agent 继续是 **Open Question / Commercial Deployment Constraint**。当前试点约束：**营业机使用一个指定 Windows 营业账户。**

### Cloud 的角色

heartbeat / PrintJob / journal evidence = **remote / audit truth**。

**Cloud 不回答「此刻本机到底怎样」**——它必然滞后且需要网络，而整套设计的前提正是断网还要能卖。

---

## 15. Printing Status Model V1

### 两条独立的轴，UI 永远不得合并成一句话

**打印服务：** 运行中 / 状态暂时无法确认 / 未运行

**前台打印机（后厨同理）：** 未配置 / 已配置 / 最近打印：成功 · timestamp / 上次打印失败 · timestamp

「打印机可达性」这条轴**刻意不存在**——当前无任何主动探活实现（P18）。

### 冻结的三条语义

```
Configured         ≠  Connected
Runtime Running    ≠  Printer Online
Last Print Success ≠  Currently Online
```

### 冻结的四条规则

**绿色只能由新鲜的正向证据点亮，不能由「没有坏消息」点亮。**

**绿色在 V1 只能描述一件事：【打印服务运行中】**，且必须有新鲜 Runtime 正向证据。

**证据过期 → 降级为「状态暂时无法确认」（灰，不是黄），既不保持绿色也不变红。**

**在主动 printer probe 存在之前，禁止显示「已连接」「在线」「healthy」。**

### 与顶部营业状态的聚合

**打印相关状态永远不会把顶部营业状态变红**（P19）。前台票或后厨票未出，销售本身是成功的，补打即可。

---

## 16. Display Assignment Model V1

> **Display assignment = preference, not invariant.**

**Best-effort restore + Graceful fallback。**

### 身份：多个弱信号打分，不拼强 fingerprint

对每块显示器就位置、尺寸、scaleFactor、internal 标志、label 逐项打分；取最高分；**只有最高分超过阈值且明显优于次高分时才接受**。两个角色都唯一解析才恢复。

**raw fields 必须保存用于诊断**——哈希式指纹在设计上就不可调试，这个错误不重复犯。

### 最重要的规则

> **只有用户显式执行「互换屏幕」时才写入持久化 preference。**

RDP · 临时单屏 · hotplug · DPI · resolution · topology changes，**一律不得自动覆盖用户偏好**。自动保存是这类系统最常见的自毁机制。

### Complexity Ceiling

> **不确定就 fallback。不建设第二套复杂的 fingerprint recovery system。**

只允许一轮打分 + 阈值 + 消歧。不允许历史布局库、多候选回溯、启发式修补。

### 回退

无法可靠恢复 → Windows primary = cashier → first external = customer → **不阻断营业** → **非阻断提示**（只在有保存偏好却未能兑现时出现；首次运行与单屏不提示；**绝不能是原生对话框**）。

健康快照记录 `assignmentSource: restored | fallback | user`。

---

## 17. Legacy 0.4.7 Lifecycle / Retirement Gate V1

**状态：LEGACY / TRANSITIONAL / TO BE RETIRED。当前不删除。**

**Retirement Gate（12 条，须全部有证据）：** independent install · activation · binding · credential persistence · cold boot · identity recovery · browser launch dependency · printing bootstrap · upgrade · **rollback** · Windows FIELD · legacy merchant migration。

**Rollback：** 只要求在**明确的 Migration Safety Window 内**存在已验证 rollback。**不要求永久维持回滚到 0.4.7。**

全部 Gate 有证据后才允许另立退役任务。Gate 满足时 0.4.7 也不立即删除，在 Migration Safety Window 内保持可安装。

---

## 18. Compatibility Constraints

**C1 Scope Guard 绝对禁止路径** 含 `app/cashier/page.tsx`、`app/desktop/display/page.tsx`、`app/api/cashier`、`prisma/schema.prisma`；授权带内容哈希绑定。

**C2 顾客屏实时通道名是跨进程事实契约**（`light-ops:customer-display:realtime:v1`），同时硬编码在 Web 层与 Desktop preload，并由静态安全测试比对。

**C3 「自动打印」在商户眼里是两种不同机制。** 现有 `autoPrint` 是「销售完成后自动打开**浏览器**打印」，与 RC9 网络打印**完全无关**。设置页措辞必须分开。

**C4 语言当前有三个来源**（Desktop 配置 → URL query → `LangProvider` localStorage）。本蓝图把「语言」放在设置 › 门店，但其语义实为设备 / 用户级，实现前需统一。

**C5 `PosSession` 每门店只有一行**（`@@unique([tenantId, storeId])`）。同门店两台收银终端会争抢同一行。

**C6 角色只有 OWNER / STAFF。**

**C7 `checkoutMode` 与 `tier` 驱动真实行为差异。** IA 不得假设所有门店看到同一组入口。

**C8 Electron 安全边界由静态测试守护。** `contextIsolation` / `sandbox` / `nodeIntegration` / `webSecurity` 不得改动；`windowManager.ts` 不得匹配 `/child_process|execFile|spawn\(|exec\(/`；新 IPC 通道必须同步进白名单表、preload 硬编码字符串与静态断言。**preload 是能力白名单接口，不是只读接口。**

**C9 Member / Customer / Coupon 是分离的身份体系。**

**C10 桌台不是实体；table QR ≠ table management。**

**C11 收银台优惠恒为 0。** 只读展示可留，不得做成可交互入口。

**C12 无积分体系。**

**C13 登录唯一入口是 Telegram，系统中不存在密码。**

**C14 会话是 7 天 HMAC cookie，无 `exp`、无会话版本号。**

**C15 `enterStaffMode` 不降权。** 只改客户端状态，session cookie 仍是 OWNER。**基于 `effectiveRole` 的入口显隐在该路径上是纯视觉遮挡，不得当作权限边界。**

**C16 Legacy Operator Attribution Constraint。** device fallback → OWNER；Operator Login 上线前的历史 `operatorUserId` 不可靠；FIELD VERIFIED 前不得关闭旧 fallback。

**C17 角色按门店授予。** Operator 选择器必须是门店范围。

**C18 已有 PIN 范式应被参照而非另造**（6 位 + 哈希 + 版本 + 失败计数 + 锁定 + 审计）。

**C19 Electronic Menu 是已走完受控发布流程的真实能力。** 其入口页为薄 server component，实现分布在 `ElectronicMenuScreen` / `ElectronicMenuDocument` / `DisplayBoundary` / `menu-board-layout` / `lib/electronic-menu` 与三个 API，并有六份 acceptance 记录与两份 change-gate 记录。**其 Desktop 归属未在本蓝图评估，V1 IA 不含它。**

> **通用规则：不得以入口文件行数单独判断能力成熟度；必须依据其实际依赖页面 / API / 验收记录确认。**

**C20 PIN 不创造身份。**

**C21 Technical Support 不是业务角色。**

**C22 Desktop-only capability 不要求 Browser 等价实现**，但不得因此削减 Browser 的业务能力。

**C23 当前打印链路没有 printer reachability probe。**

**C24 offline sale ≠ offline printing。** 离线可开单，但打印任务在服务端与销售同事务创建，离线期间**一张票都不出且静默**。

**C25 本地挂单与交班基于 localStorage，按浏览器 profile 隔离。** 管理中心呈现它们时，其范围限于同一浏览器环境；跨设备 / 跨浏览器不可见。

---

## 19. Explicit Non-Goals

大规模 cashier business refactor · checkout state machine rewrite · Printing Core rewrite · RC9 / HRT merge · Desktop direct business printing · Offline Printing redesign · active printer probe · 店长 role · complex ACL · enterprise IAM · Browser PIN parity · offline PIN credential system · Table entity / Restaurant implementation · 开桌 / 加菜 · coupon at cashier · loyalty points · full CRM · TikTok Desktop rewrite · Electronic Menu Desktop 引入 · Apple visual rewrite within architecture phase · 0.4.7 retirement execution。

补充：本轮不新增任何 schema / migration；不新增账号体系；不重构 session / auth。

---

## 20. Open Questions

| # | 问题 |
|---|---|
| 1 | Offline Printing A / B / C —— Founder 未决 |
| 2 | Operator PIN 断网重启后的解锁行为 |
| 3 | 首次 PIN enrollment 方式 |
| 4 | Legacy Device→OWNER 迁移策略 |
| 5 | Refund 当前真实权限口径 / 未来授权归类 |
| 6 | localStorage 挂单与交班的长期存储 |
| 7 | 真实 shift operator / 营业员归属迁移 |
| 8 | Restaurant / Table Service 实施时机 |
| 9 | Table entity 未来 schema 与生命周期 |
| 10 | 柜台优惠券核销 |
| 11 | Multi-store Desktop UX |
| 12 | Multi-Windows-user duplicate print agent（含跨用户证据可得性） |
| 13 | Customer display kiosk mode |
| 14 | Technical Support unlock UX |
| 15 | Management IA 试点后的最终排序 |
| 16 | **Local Printing Status Contract 的发现方式**——Desktop 与 RC9 是不同 appId，不应长期硬编码对方路径；**属契约的一部分，必须在实现前定** |
| 17 | 锁屏后未完成交易在 Operator 切换后的可见性 / 恢复 / 归属 |

---

## 21. Decisions Frozen Before Pilot

Desktop 技术分层与三条边界规则 · Desktop V1 角色定义 · Desktop 与 Printing Runtime 互为可选 · preload 能力白名单契约与 Electron 安全边界 · Browser fallback 策略及其限定 · 四层产品 IA 与「管理中心持状态、设置持配置」分界线 · 四层身份互不相等 · Operator Lock 启动序列与锁屏边界 · Lock 不丢失交易状态 · 本机营业 PIN 产品语义与全部 Non-Goals · 6 位 + 不存明文 + 失败锁定 + 在线验证优先 · OWNER PIN 可建立 OWNER Operator 状态（含取舍的明确接受）· 单次授权为 V1 唯一授权形态 · Legacy Device→OWNER 不修且不得提前关闭 · 历史 operatorUserId 不可靠 · PIN 四项最小持久化要求与三条禁止 · Sales Workspace shell-first 与核心内核不抽离 · 管理中心不得 import cashier 且不得顺手新建 API · Restaurant 复用原则与 Non-Goal 定位 · Member / Customer / Coupon 分离 · 会员与支付解耦方向 · RC9 canonical / HRT frozen dormant · Desktop 不直接发业务打印命令 · 契约为唯一耦合面且 producer 侧改动需独立授权 · Printing Status Model 全部规则 · 跨用户证据不足时不得猜测 · Display Assignment 全部规则含 Complexity Ceiling · 0.4.7 十二条 Retirement Gate · 第 18 节全部兼容性约束 · 第 19 节全部 Non-Goals · 第 23 节 Change-Control Rule。

---

## 22. Decisions Deferred Until Pilot

Management Center 最终排序 · 哪些入口每天真的高频 · 是否需要 Dashboard · 商品报表与经营数据是否合并 · Operator PIN 断网重启行为 · 锁屏后未完成交易的切换语义 · Customer display kiosk mode · touch density / font / card size · 通知打扰阈值 · 手机与 Desktop 的跨端入口偏好 · Restaurant 实施优先级 · 交班 / 日结字段是否够用 · Technical Support 解锁手势与时限 · 营业页还能减到什么程度 · Electronic Menu 是否进入 Desktop。

---

## 23. Blueprint Change-Control Rule

本文件是后续所有 Desktop 开发任务的**唯一设计基线**。

任何后续实现任务：

1. **不允许自行改变 Blueprint。**
2. **不允许因为实现方便扩大范围。**
3. **不允许借 UI 改造重构收银核心。**
4. **不允许借 Desktop 改造重构打印核心。**
5. **不允许把未实现能力先画成可用能力。**
6. **不允许以「顺便修」为理由修改不相关业务。**
7. **不允许为了视觉效果改变业务口径。**
8. **不允许为了 Desktop 破坏 Browser fallback。**
9. **不允许为了新 Operator 模型提前关闭旧可工作路径。**
10. **不允许开发者自行增加 schema / migration 来解决蓝图外问题。**

### 冲突处理

```
STOP
→ 报告：Blueprint 预期 / 真实实现 / 冲突 / 最小选项 / 是否需要 Blueprint Change
→ 返回 Founder / Architecture Gate
→ 只有显式批准后才能改变 Blueprint
```

判定为「冲突」的情形包括但不限于：蓝图假定的能力在代码中不存在 · 蓝图禁止触碰的路径被证明不可避免 · 第 18 节任一兼容性约束无法满足 · 某项 Non-Goal 被证明是前置依赖。

**禁止边开发边偷偷修改架构。**

### 证据纪律

实现产出中出现的任何「正常 / 在线 / 已连接 / 已验证」字样，必须能指向具体证据来源。**不得以「与本次改动无关」作为已知失败的通过标准。**

**不得以文件行数、目录规模等间接指标判断能力成熟度。**

### 提交分离

蓝图修订与功能实现不得在同一 change set 中。

---

```
BLUEPRINT STATUS             = FINAL
DESIGN FROZEN                = YES
Implementation Authorization = NO
Code Change                  = NO
Production Change            = NO
```

**只有 Founder 后续单独授权「进入 P0 Governance Readiness」，才允许开始 P0。**
