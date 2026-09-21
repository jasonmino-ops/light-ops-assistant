# ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 — Local First Printing Design Freeze V1.4

| 项 | 内容 |
|---|---|
| 文档版本 | V1.4（FROZEN） |
| 冻结日期 | 2026-09-21 |
| 审计基线 | `origin/main` = `5a2c4dcb30debd75fa2c89a3e165b0ba634502b8` |
| 批准状态 | **FG-1 已批准** · **FG-2 已批准** · FG-3 待提交 |
| 治理等级 | 实施为 L3 |
| 本文性质 | 架构冻结方向 + 治理分层。**后续实现的权威事实源** |
| 不授权 | Preview/Production 部署、Production migration、单店试点、安装包发布 |

> V1.0–V1.4 的代码审计执行于 `1e666ba67906573fd02ca0993b9c513073e1491c`。
> 该基线至 `5a2c4dcb` 之间仅有两个治理提交，差异仅限
> `docs/change-gates/exceptions/ES-PRINT-NETWORK-FIRST-01.json`，
> 未触及任何打印相关代码，技术结论不变。

---

## 1. 长期架构方向（FG-1 已批准）

- **V2 = RC10 Frozen Fallback Mode**：代码与运行行为逐字节冻结，长期保留为完整回退方案。
- **V3 = Local First Active Mode**：承载本地优先执行，未来主执行方向。
- **门店级唯一实际执行者**：Runtime Owner + 单调 `ownerEpoch` fencing。
- **控制面 Lease 与本地执行 Grace 分区**：`ownerEpoch` 永不因超时自动提升。
- **云端最小数据、门店本地执行**。
- 面向多商户、多电脑的长期可扩展架构；受控人工交接是唯一强制接管路径。

唯一目标：降低 Desktop 同机订单从制单完成到出票的等待。
非目标：离线营业、MQTT、Linux Box、USB、蓝牙、A4/PDF、支付、打印系统重写。

---

## 2. 三项 Founder Gate

### FG-1 · 架构冻结方向 —— 已批准
批准 §1 全部条款 + §4 技术不变式。

### FG-2 · 独立 L3 开发线 —— 已批准
允许在隔离分支为 V3 新增代码、数据库 schema、migration、受限 Electron IPC、
Desktop Runtime、云端任务合同与 Feature Flags；并签发与合并本任务所需的
Scope Guard exact authorization 记录。

硬约束：V2 冻结文件与运行行为不得修改；不得突破 §4 任一不变式。
不含：Preview/Production 部署、Production migration 执行、单店试点、安装包发布。

### FG-3 · 试点与部署 —— 待提交
每次单独提交、逐次授权、不得沿用：试点门店 · 试点时长 ·
进入 Production 的证据与回退准备 · Preview/Production 部署 · Production migration 执行。

---

## 3. 实施分层

### Wave 1（首轮交付：降低延迟的最小安全闭环）
1. V3 Shared Printing Core
2. 单门店 Active Print Host（Runtime Owner + ownerEpoch + endpoint OS 互斥）
3. 本地 Desktop IPC 直发
4. v3 Cloud Adapter 最小兼容（H5/第三方/远程补打在 V3_ACTIVE 下不降级，不可省）
5. `printJobId` 防重 + Outbox + endpoint 队列
6. RC10 V2 安全回退（模式状态机 + 双向交接 + HELD + 分区 Grace）
7. 单店 FIELD 试点

同属 Wave 1、不可裁剪：分区策略全套、执行租约只签发给当前 owner 设备、
强制交接的 quarantine 与旧 epoch fencing、无人服务队列看门狗、异种执行者探测。

### V1.3 Full（长期架构，非 Wave 1 前置）
多电脑编排与运维 UI（**自动接管本就被永久禁止**，Wave 1 实现守卫，长期实现编排）·
复杂远程支持控制 · 跨门店自动调度 · v2→v3 迁移与 v2 退役（独立 Founder Gate）·
多门店推广（FG-3 逐店）。

---

## 4. 技术不变式（冻结）

### V2 不变性（V2-INVARIANCE-02）
- **I-1** v2 行为逐字节不变，由端到端快照比对证明 →
  `tests/v2-relay-endtoend-snapshot.test.ts`
- **I-2a** 完全 v2 专属模块（不含任何 v3 扩展点）禁止任何修改（含格式化），
  整文件 SHA-256 冻结 → `tests/v2-invariance-frozen-files.test.cjs`
- **I-2b** `lib/es-tray-relay/service.ts` 按区段冻结：16 个 v2 执行分支
  （claim / markExecuting / complete / recover 等）逐函数 SHA-256 + 行数 +
  相对顺序；头部声明区既有行只增不改；唯一 v3 扩展点
  `enqueueRelayPrintJob` 不做哈希冻结，但其既有 v2 判定行必须按原相对顺序
  完整保留 → `tests/v2-invariance-service-regions.test.cjs`
- **I-3** 共享分发点只允许「纯新增分支」扩展，清单 G1 一次性冻结 →
  `tests/v2-invariance-extension-points.test.cjs`
- **I-4** 不得假定 v2 遵守任何 v3 协议；剥夺其执行权只靠
  「生产者停止发射 v2 任务」+「v2 进程不在运行」

> **为什么 `service.ts` 不用整文件哈希**：它同时承载 v2 执行分支与唯一的 v3
> enqueue 扩展点。整文件哈希会随任何合法扩展失效，于是「证明」退化成
> 「每次改完更新哈希」——那是变更记录，不是不变性证明。I-2b 因此把它拆成
> 「逐字冻结的 v2 区段」与「显式开放、但既有判定行受保护的扩展点」两部分。
>
> **静态与运行时的分工**：I-2a/I-2b/I-3 在静态层证明「v2 分支的顺序、判定
> 条件与字节未变」；I-1 快照套件在运行时层证明「v2 既有输出未变」。两者缺一
> 不可，任何一方都不得以「更新基线」代替证明。

### 执行边界
- `effectBoundary` 三值；`physicalCompletionKnown` 恒为 false
- `attempted` 在首次 `socket.write` 之前翻转
- 写字节前必须完成 `CROSSING_UNKNOWN` 持久化（fsync 返回后才 write）
- CROSSED = 字节已交本机 TCP 并完成 flush + FIN，≠ 打印机已收，≠ 已出票
- `CROSSING_UNKNOWN` 永不自动重打；人工闸 + 新 `executionId` + REPRINT 标记

### 并发与传输
- 同 `host:port` 严格串行；不同 `host:port` 并行
- 每票独立 TCP 连接，禁止复用
- 首版串行渲染（显式排队，不以 BUSY 失败代替）
- FRONT 成功不是 KITCHEN 执行的前置条件

### 账本与回报
- Ledger 主键 `printJobId`；五态 `NOT_CROSSED` / `CROSSING_UNKNOWN` / `CROSSED`
  / `FAILED_NOT_CROSSED` / `CANCELLED`
- 曾 CROSSED 或 CROSSING_UNKNOWN 者在 `expiresAt` + 余量前保留不可复用 tombstone
- Outbox 与执行队列物理分离；回报失败绝不阻塞后续本地执行；
  Outbox 必须支持释权后继续补报

### 门店模式与所有权
- 5 个执行模式（`V2_ACTIVE` / `V2_DRAINING` / `V3_ACTIVE` / `V3_DRAINING` / `BLOCKED_UNKNOWN`）
- 执行权同一时刻唯一；转移原子无重叠窗口
- `BLOCKED_UNKNOWN` 永不自动转出；DRAINING 未释权前可安全中止
- `jobSchemaVersion` 提供队列级天然互斥（v2 永远看不到 v3 任务）
- HELD 任务按最终生效模式物化

### 分区（控制面 / 执行面分离）
- **R-P1** 云端不得仅因心跳超时把门店交给第二 Runtime
- **R-P2** `ownerEpoch` 只能由旧 owner 主动释放或受控人工交接提升
- **R-P3** PrintBatch 执行租约只签发给当前 owner 设备
- **R-P4** 分区期间禁止任何模式切换
- Grace 内继续执行已签发、未过期、epoch 匹配的 batch
- Grace 超时关闭准入但不中断在飞任务；不自动切到第二 owner
- epoch 已提升 → fail-closed 停止执行，但继续 Outbox 补报

### 安全与数据
- 禁止任何入站监听端口；Desktop/Runtime 只建立出站认证连接
- 受限 IPC 白名单 + sender/senderFrame 校验 + 主进程重算
- 服务端不信任浏览器自称的 `isDesktop`
- edge→cloud 不上传小票正文 / 顾客信息 / 商品明细 / ESC-POS 字节 / 完整日志
- cloud→edge 下发远程来源任务载荷是必要且允许的
- 远程支持默认只读；高级操作需商户授权 + 限时 + 最小权限 + 可撤销 + 可审计

GC-01…GC-16、Golden Tests 1–22、FIELD F-01…F-37 全部有效，不可豁免项不得裁剪。

---

## 5. Engineering Decisions 登记册

以下不再作为 Founder 逐项批准的阻塞项。工程负责人在给定范围内决定，须满足 §5.2 证据要求。

| ID | 决策项 | 推荐初始值 | 合理范围 | 测试/依据 |
|---|---|---|---|---|
| ED-01 | 控制面 Lease TTL | 20 s | 15–30 s | 现有 `claimLeaseMs` 默认 30 s（`lib/es-tray-relay/config.ts`）；Golden 14/22 |
| ED-02 | 心跳周期 / OWNER_SUSPECT | TTL÷3≈7 s；连续 3 次缺失 | 5–10 s；2–5 次 | Golden 19；F-33 |
| ED-03 | Partition Grace | 15 min | 10–60 min，**硬下界 10 min** | F-07 / F-32；Golden 18/20 |
| ED-04 | drain 窗口 | 120 s | 30–600 s | F-24/F-25/F-26 |
| ED-05 | HELD 看门狗阈值 | 60 s | 30–300 s | P0-7；F-30 |
| ED-06 | PrintBatch `expiresAt` | 15 min | 5–60 min | 有效期 = min(Grace, expiresAt)；F-18 |
| ED-07 | Ledger 保留与 tombstone | `expiresAt`+7 天；tombstone ≥90 天 | 余量 1–30 天 | P0-3；F-01。条数上限仅作用于 FAILED_NOT_CROSSED / CANCELLED |
| ED-08 | 字段设计（ownerEpoch / executionId / stateVersion / leaseId / configRevision / payloadHash+rendererVersion） | 按 §4 语义自定 | — | Golden 13/21/22 |
| ED-09 | Feature Flag 名称与粒度 | 沿用六 Flag 语义 | 名称自由 | 约束：Cloud Adapter V3 与 V3 Execution 必须同开同关 |
| ED-10 | 强制交接 SOP 步骤 | 按七步展开 | 可细化 | 不得删减：操作者确认 / 审计留痕 / quarantine / 旧 owner fail-closed |
| ED-11 | 试点机 v2 处置 | **卸载 RC10 Add-on** | 卸载 ／ 关闭自启+监督生命周期 | 强制下界：V3_ACTIVE 期间该机不存在可运行的 v2 执行者 |
| ED-12 | 真实订单 FIELD 样本量 | ≥20 单、跨 ≥2 营业日、双角色覆盖 | ≥10 单起 | 纸票 + Ledger + 云端事件三方一致（F-21） |
| ED-13 | Scope exception 路径与哈希清单、I-3 扩展点清单 | 见 §7 | 可增减，G1 一次性冻结 | I-2a 整文件哈希 / I-2b 区段指纹纳入 `authorizedPathSha256` 作禁止修改证明 |
| ED-14 | 渲染串行队列实现 | 显式 FIFO | — | P1-2：不得以 `NETWORK_RENDER_BUSY` 失败代替排队 |
| ED-15 | 测试数量、阶段内部顺序、其他内部参数 | 按七阶段 | 可调整 | 不得跳过任一 Golden Test 与不可豁免 FIELD 项 |

### 5.2 证据要求
每项初始值与每次变更须同时具备：
**E-1** 独立 Code Review（自审不算）· **E-2** 自动化测试覆盖边界值与失效路径 ·
**E-3** 真机证据 · **E-4** 审计记录（参数名、旧值、新值、理由、生效范围、
生效时间、负责人、证据链接）。变更登记必须落在本表。

### 5.3 ED 不得突破的边界
不得使 Grace < 10 min；不得使 `ownerEpoch` 可超时自动提升；
不得使 V3_ACTIVE 门店存在可运行的 v2 执行者；
不得以条数上限驱逐 CROSSED / CROSSING_UNKNOWN；不得让两个 v3 Flag 分别开关。

---

## 6. ED → Founder Gate 升级触发器

- **ESC-1** 改变 V2 Frozen Fallback 的代码或运行行为
- **ESC-2** 扩大业务范围（离线营业、MQTT、Linux Box、USB、蓝牙、A4/PDF、支付等）
- **ESC-3** 降低 `CROSSING_UNKNOWN` 处理强度（自动重打、自动清除、缩短保留期，或跳过人工恢复闸门）
- **ESC-4** 降低防重强度（移除 `printJobId` 幂等约束、放宽 `requestHash` 冲突检测，或允许已执行 / 未知任务复用）
- **ESC-5** 降低权限与安全边界（放宽身份 / 租户 / 设备绑定、IPC sender 校验、最小权限或审计要求）

---

## 7. G1 冻结清单与基线哈希（2026-09-21，`origin/main` = `5a2c4dcb`）

### I-2a 完全 v2 专属文件（整文件冻结，禁止修改，ESC-1）
由 `tests/v2-invariance-frozen-files.test.cjs` 固化并逐次校验。这 10 个文件
不含任何 v3 扩展点，因此「整文件未被编辑」与「v2 行为未变」等价：

```
e-shop-tray/src/relayPoller.ts
e-shop-tray/src/networkRuntime.ts
e-shop-tray/src/executionJournal.ts
e-shop-tray/src/printing/networkRawTcpTransport.ts
app/api/es-tray-02/print-jobs/receive/route.ts
app/api/es-tray-02/print-jobs/[jobId]/executing/route.ts
app/api/es-tray-02/print-jobs/[jobId]/result/route.ts
lib/es-tray-relay/config.ts
lib/es-tray-relay/crypto.ts
e-shop-tray/src/networkContract.ts
```

### I-2b `lib/es-tray-relay/service.ts` 区段级指纹
由 `tests/v2-invariance-service-regions.test.cjs` 固化。该文件 736 行、
17 个顶层函数，其中 **16 个是 v2 既有执行分支，1 个是唯一的 v3 扩展点**；
函数之间的 16 个既有间隙也逐字冻结：

```
[冻结] serializeJob / storedRequest / cashierNetworkRoleIdempotencyKey
[冻结] sameNetworkItem / isOrderedNetworkItemSubset / isValidKitchenDependency
[扩展] enqueueRelayPrintJob            ← 唯一允许新增 v3 分支的区段
[冻结] recoverTimedOutJobs / lockActiveClaimScope / readNetworkQueueState
[冻结] assertExpectedNetworkMode / hasPotentialRelayWork
[冻结] claimNextRelayPrintJob / findClaimedJob / markRelayPrintJobExecuting
[冻结] sameTerminalResult / completeRelayPrintJob
```

守卫断言（全部 fail-closed）：

| 断言 | 内容 | 允许的变化 |
|---|---|---|
| A1 | 头部声明区 50 条既有行按原相对顺序完整保留 | 只允许新增 import / type |
| A2 | 17 个顶层函数的集合与相对顺序不变 | 不允许插入 helper；新 v3 helper 放独立模块 |
| A2b | 16 个既有函数间隙逐字冻结 | 不得新增顶层可执行语句、常量初始化、副作用或 monkey patch |
| A3 | 16 个冻结区段的 SHA-256 + 行数逐一匹配 | 无 |
| A4 | `enqueueRelayPrintJob` 内 4 条既有 v2 判定行按原相对顺序保留 | 仅允许修改该明确扩展区 |

`enqueueRelayPrintJob` 是**唯一**的版本选择点（写 `schemaVersion: 2` 或
`ES_TRAY_RELAY_SCHEMA_VERSION`）。G3 的 mode-aware 生产必须落在这里，
不得另起第二个版本选择点。

### I-1 golden 的三道 fail-closed 门槛

golden 是 v2 运行时行为的唯一基线，一旦被污染，后续所有"v2 未变"的结论都失效。
因此写入 golden 前必须依次通过（任一不过即拒绝写入）：

| 门槛 | 内容 | 不通过时 |
|---|---|---|
| **G-1 确定性** | 同一隔离库上连续跑两遍完整场景，两遍之间彻底清理、各自新建租户/门店/绑定；两份 JSON 的 SHA-256 必须完全相同 | 拒绝写入，并指出第一处差异的场景名 |
| **G-2 内容审计** | 结构化白名单 + 明文黑名单（详见下表） | 拒绝写入，逐条列出违规路径 |
| **G-3 顺序** | 只有 G-1 与 G-2 全部通过才允许落盘 | —— |

G-2 的判定规则：

- **(a) 明文黑名单**：`COMPUTER_CLIENT_TOKEN_SECRET` 的明文 / base64 / hex / sha256
  形式；`DATABASE_URL` 全串及其 host / user / password / 库名。
- **(b) 未归一化扫描**：UUID、ISO 时间戳、13 位 epoch 毫秒、`postgres(ql)://`
  连接串、测试租户后缀 `v2inv-`、ESC/POS 初始化字节（`\u001b@` / `G0A=` / `1b40`）。
- **(c) 结构化白名单**：叶子字符串只允许两类——归一化占位符 `<FOO>` 或
  SCREAMING_SNAKE 枚举/错误码；数值必须是绝对值 ≤ 100000 的整数；
  载荷类字段（`request` / `payload` / `commandStream` / `data` / `items` /
  `customer*` / `documentName` / `queueName` / `target` / `message` /
  `resultMessage` / `stack` 等）只允许为 `null`，带值即违规。

比对模式下同样对磁盘上的 golden 跑一次 G-2，防止有人手工编辑基线后仍然"通过"。
非 `RelayServiceError` 的异常只记录大写错误类名，**不记录 message**——message
可能携带连接串或行内容且不可控。

### I-3 扩展点（允许纯新增分支，清单 G1 一次性冻结）
由 `tests/v2-invariance-extension-points.test.cjs` 固化清单、G1 整文件基线哈希与
27 条既有 `schemaVersion` 判定行的相对顺序。G1 阶段整文件哈希不一致即
fail-closed；未来合法 v3 扩展必须在同一受审 PR 内明确更新基线，并由 I-1
证明 v2 输出不变，不存在自动 drift 豁免：

```
lib/es-tray-relay/auth.ts           （4 条判定行）
lib/es-tray-relay/contract.ts       （10 条判定行）
e-shop-tray/src/cloudRelayClient.ts （13 条判定行）
```

> `lib/es-tray-relay/cashier-network-producer.ts` 已从强制清单移除：它在基线上
> 对 `schemaVersion` **零引用**，只是 `enqueueRelayPrintJob` 的调用方，版本选择
> 发生在被调用方内部，因此它不是共享分发点。为防止这一前提被悄悄破坏，同一
> 测试用反向断言锁住它——一旦它出现任何 `schemaVersion` 判定，或不再委派给
> `enqueueRelayPrintJob`，断言失败并强制把它重新纳入 I-3（属治理变更，需 Gate）。

> 基线 SHA-256 与区段指纹以三个测试文件内的固化值为准，不在本文重复维护，
> 避免双份真相。

---

**版本沿革**：V1.0 初稿 → V1.1（D-1 裁决：代码路径边界 + jobSchemaVersion 3）→
V1.2（V2/V3 互斥执行模式、模式状态机、HELD、mode-aware producer）→
V1.3（控制面 Lease 与本地执行 Grace 分区，修复 TTL 与 F-07 的矛盾）→
V1.4（治理收敛为三项 Founder Gate + Engineering Decisions 分层）→
V1.4-a（G1 候选修正：I-2 拆分为 I-2a 整文件 / I-2b 区段指纹；
`cashier-network-producer.ts` 移出 I-3 并改为反向断言；I-1 加装
隔离库 fail-closed 守卫与 FK 安全清理）→
V1.4-b（I-1 golden 写入增设 G-1 确定性 / G-2 内容审计 / G-3 顺序三道
fail-closed 门槛；claim 场景改为只观察布尔结果，不再把请求体带入快照）。
