Historical snapshot source: founder-provided authoritative V1.0-RC2 text on 2026-07-14.

# E-Shop Legacy Grandfathered Register V1
## Legacy 既有豁免链路治理登记册

| 项目 | 内容 |
| --- | --- |
| 文档编号 | ES-LEGACY-REGISTER-001 |
| 文档名称 | 《Legacy Grandfathered Register V1》（Legacy 既有豁免链路治理登记册） |
| 版本 | V1.0-RC2 |
| 状态 | **FINAL FREEZE CANDIDATE** |
| 起草日期 | 2026-07-14 |
| RC1 修订日期 | 2026-07-14（治理规则收口与五项拍板裁定） |
| RC2 修订日期 | 2026-07-14（两轮 Codex 只读核实后的事实回填与冻结候选收口，回填记录见文末） |
| 资产类型 | Runtime 技术债治理登记册（非 Baseline、非 ADR、非技术设计文档） |
| 上位文件 | ES-CONST-001 V1.0（FINAL FROZEN）；ES-STRAT-001 V1.0（FINAL FROZEN）；ES-HRT-001 V1.0（FINAL FROZEN） |
| 下位/关联资产 | Milestone B Architecture Entry Gate（本 Register 是其前置资产）；各 ADR；各 Adapter Spec |
| 生效范围 | E-Shop Store Operating System 生产系统中一切 Legacy Grandfathered 项 |

---

# 第 1 章：定位

## 1.1 本文件是什么

本文件是 Store Operating System 的 **Legacy 治理登记册（Register）**。它的目的只有一个：**把目前仍存在于生产系统中的 Legacy Grandfathered 项全部登记、分类、治理**，并跟踪其迁移状态直至退役。

它是 Milestone B Architecture Entry Gate 的前置资产（ES-HRT-001 第 20.5 章 Entry Gate 硬条件第 8 项），是 Runtime 技术债的治理工具。

## 1.2 本文件不是什么

- 不解释架构（架构解释权属三份上位 Baseline）；
- 不设计未来（目标链路定义权属 ES-HRT-001）；
- 不新增 Runtime 设计、Contract、Device Model；
- 不修改任何 FINAL FROZEN 内容；
- 不是迁移项目计划（迁移执行属 Milestone B 实施计划）。

## 1.3 核心治理立场

**Grandfathered 是豁免，不是许可。** 每一条登记项都是对已冻结架构原则的一次有时限、有边界、有退出路径的违例宽限。登记的意义在于：让每一次宽限都可见、可控、可退出——而不是让它合法化、永久化。

**未登记即违规。** 本 Register 生效后，生产系统中任何未登记的 Legacy 链路不享受 Grandfathered 豁免，一经发现按架构违规处理：立即登记并评估，或立即整改。

## 1.4 继承声明

本文件完整继承 ES-CONST-001、ES-STRAT-001、ES-HRT-001 的全部冻结裁定。以下事项在本文件中一律视为既定事实，不重新讨论：Provider 模型、Contract 体系、Device Slot / Physical Device Identity / Device Assignment 三分模型、Runtime 边界、UNKNOWN 与 Resolution 模型、Printer / Scanner / Customer Display 三类契约、EHA 正式角色（Windows Provider Host + Executor）、HMF 控制平面退役、唯一设备执行链路、Legacy 替换范围（ES-HRT-001 第 20.4 章）。

本 Register 中对上述概念的一切引用均为引用，不构成再裁定。

---

# 第 2 章：登记规则

## 2.1 准入判据（什么有资格登记为 Legacy Grandfathered）

一条链路/入口/能力必须同时满足以下全部条件，方可登记：

1. **真实存在**：当前存在于生产系统或过渡双轨中（不登记假想项、不登记已退役项）；
2. **违反已冻结架构**：与三份上位 Baseline 的至少一条冻结原则冲突（如绕过唯一执行链路、构成第二入口、构成第二控制平面）；
3. **有现实存续理由**：立即移除将损害 Store Continuity First（真实门店连续经营），或其替代链路尚未可用；
4. **有明确迁移目标**：ES-HRT-001 或上位文件已定义其目标归宿；
5. **可被围堵**：能够执行"不得扩建"约束（无法围堵的项不是 Legacy，是失控，须立即整改）。

## 2.2 Legacy ID 规则

格式：`LEG-<域>-<三位序号>`。域代码：PRT（打印）、SCN（扫码）、DSP（客显）、EHA（EHA 入口）、HMF（HMF 控制平面）、GEN（其他）。ID 一经分配永不复用；条目退役后 ID 与历史记录永久保留。

## 2.3 治理阶段（Stage）枚举

每条登记项处于且仅处于以下一个阶段：

| 阶段 | 最低语义（RC1 收口） |
| --- | --- |
| PENDING_CLASSIFICATION | 发现候选，尚未完成归类（是否属本 Register 治理范围待裁定） |
| REGISTERED | 确认真实存在，已登记，但依赖与风险尚未完全盘点 |
| CONTAINED | "不得扩建"约束生效，Consumer 清单已登记并冻结，风险暂时可控 |
| MIGRATION_READY | 目标链路、验证方式与回退路径已具备（真机验证通过） |
| MIGRATING | 真实 Consumer 正在切换（含试点替换、分批迁移、旧入口降级与关闭倒计时——DECOMMISSIONING 语义并入本阶段） |
| RETIRED | 无生产 Consumer，旧入口关闭，回退窗口结束，证据归档（终态） |

阶段只能前进或经审批回退一级（回退须记录原因并审计）；RETIRED 为终态。

## 2.4 阶段推进的分级批准与记录（RC1 收口）

治理状态变更按阶段分级批准，**不要求每次由创始人批准**：

| 治理动作 | 批准层级 |
| --- | --- |
| 进入 REGISTERED / CONTAINED | 治理负责人（CTO）批准 |
| 进入 MIGRATION_READY | 架构负责人 + Verifier 双批准 |
| 进入 MIGRATING | Milestone Owner 批准 |
| 宣布 RETIRED、PENDING_CLASSIFICATION 归类裁定、新增正式条目、改变分类/风险等级/迁移目标 | 创始人或 CTO 最终批准 |

每次推进/回退记录：日期、依据（真机验证结论、切换事实、指标）、批准人。本 Register 的**条目字段值是运行数据**：按第 6 章维护原则更新，不构成对本文件规则部分的修订。

## 2.5 "不得扩建"的执行细则（继承 ES-HRT-001，此处为执法条款）

- 登记项冻结功能范围：只允许安全修复（缺陷修复、安全补丁），禁止新增能力、新增调用方、新增设备类型支持；
- 任何新设备能力需求一律走 Hardware Runtime 正式链路，**不得以"Legacy 顺手加一点"实现**；
- 扩建请求的唯一合法出口：向 HRT 正式链路提需求；本 Register 只记录拒绝依据，不受理豁免扩建。

---

# 第 3 章：登记模板

每条登记项必须完整填写以下字段（字段结构冻结，字段值为运行数据）：

| 字段 | 说明 |
| --- | --- |
| Legacy ID | 按 2.2 规则分配 |
| 名称 | 链路/入口的准确名称与简述 |
| 当前状态 | 生产在用 / 过渡双轨 / 试点在用 / 待核实（标注盘点置信度） |
| 所属类别 | 设备执行链路 / 设备事件链路 / 硬件入口（第二入口豁免） / 控制平面豁免 / 其他 |
| 当前 Owner | 治理责任人（问责对象）与技术责任线 |
| 当前调用方 | 谁在调用（应用、页面、模块）；调用方清单冻结，禁止新增 |
| 当前生产用途 | 它在真实门店里做什么 |
| 为什么允许存在 | Grandfathered 豁免的具体理由（必须援引 Store Continuity 或替代链路未就绪） |
| 风险说明与风险等级 | 违反哪条冻结原则、现实故障风险、审计缺口；风险等级变更属治理状态变更（2.4） |
| 是否允许扩展 | 一律"禁止"（仅安全修复）；例外不存在 |
| 迁移触发条件 | 什么事件发生后必须启动切换（挂钩事件而非日历日期） |
| 推荐迁移目标 | ES-HRT-001 定义的目标链路/组件 |
| 回退方式 | 切换失败时如何受控回退（RC1 新增） |
| 证据 | 代码、部署配置、日志或真机证据的引用（RC1 新增） |
| 最近核实时间与核实标记 | 6.4 六种合法核实状态之一（FACT_VERIFIED / PARTIALLY_VERIFIED / FACT_VERIFICATION_REQUIRED / FACT_VERIFICATION_BLOCKED / PENDING_CLASSIFICATION / EXTERNAL_EVIDENCE_REQUIRED）+ 核实日期 |
| 当前阶段 | 2.3 阶段枚举之一 |
| 待办 | 当前阻塞项与下一步动作（RC1 新增，运行数据） |
| 备注 | Milestone B 义务、特殊约束 |

---

# 第 4 章：首批登记项

首批登记范围继承 ES-HRT-001 第 20 章 Legacy 首批清单，另含一条诚实盘点产生的候选项。

## 4.0 登记总览

首批清单构成（RC2 收口）：**五个治理对象，其中四个已确认存在或部分存在（LEG-PRT-001 / LEG-SCN-001 / LEG-DSP-001 / LEG-HMF-001），LEG-EHA-001 为待外部证据确认的候选治理对象**；另有一条已归类移出记录（LEG-PRT-002）。不虚构生产事实。

| Legacy ID | 名称 | 类别 | 当前阶段 | 事实核实标记（RC2 回填） | Milestone B 义务（ES-HRT-001 20.4 冻结） |
| --- | --- | --- | --- | --- | --- |
| LEG-PRT-001 | 浏览器打印链路 | 设备执行链路 | CONTAINED | FACT_VERIFIED（SV-02 真机记录 + 四处代码证据） | 必须试点替换 |
| LEG-SCN-001 | 浏览器键盘楔扫码输入链路 | 设备事件链路 | CONTAINED | FACT_VERIFIED（SV-01 冻结记录 + cashier 页面代码证据） | 真机验证 + 单终端唯一业务消费源 |
| LEG-DSP-001 | Web Serial 客显页面直写链路 | 设备执行链路 | CONTAINED | **PARTIALLY_VERIFIED**（基础 USB Serial 已真机验证；最新实时链路未 production verified） | 必须试点替换 |
| LEG-EHA-001 | EHA 面向应用的 localhost HTTP API | 候选治理对象（第二入口防御性记录） | **PENDING_CLASSIFICATION** | **FACT_VERIFICATION_BLOCKED**（外部 EHA 仓库不可访问） | 若确认真实存在，按 5.7 事件触发式规则关闭 |
| LEG-HMF-001 | Electron HMF 控制平面（框架壳） | 控制平面豁免 | CONTAINED | FACT_VERIFIED（框架壳已加载；硬件控制未实现） | 必须退役归一（迁移或封存） |
| LEG-PRT-002 | 云打印链路（SW-AIOT） | 已归类移出（Cloud 远程执行服务边界） | CLASSIFIED_OUT_OF_HRT_SCOPE / TRANSFERRED_TO_CLOUD_GOVERNANCE | 已确认（产品决策：商户侧已隐藏/停用） | 无——不是 Milestone B HRT 迁移项 |

## 4.1 LEG-PRT-001 — 浏览器打印链路

| 字段 | 内容 |
| --- | --- |
| Legacy ID | LEG-PRT-001 |
| 名称 | 浏览器打印链路：Web POS 经浏览器打印流程（window.print 及关联前端打印组件）输出小票 |
| 当前状态 | 生产在用（真实门店已验证，SV-02 系列） |
| 所属类别 | 设备执行链路 / Printer 类 |
| 当前 Owner | 治理：创始人 Jason；技术：Desktop Runtime 线（CTO 监管） |
| 当前调用方（Consumer 子清单，RC2 回填） | 同一浏览器打印技术链的四类业务用途（共享迁移目标与治理原则，**不拆分新 Legacy ID**）：① 交易小票 & 补打——`app/components/DesktopReceipt.tsx`（`window.open` + `win.print()`）；② 交班报表——`app/components/ShiftReportPrint.tsx`（打印窗口 + `window.print()`）；③ 日结报表——`app/components/DayCloseReport.tsx`（打印窗口 + `window.print()`）；④ 统一触发入口——`app/cashier/page.tsx`（触发小票、交班、日结与自动小票打印）。Consumer 清单冻结 |
| 当前生产用途 | 门店小票、交班报表、日结报表打印的现行本地路径 |
| 为什么允许存在 | HRT 正式 Printer Contract / Provider 链路尚未上线；立即移除将中断真实门店打印（Store Continuity First） |
| 风险说明 | 回执止于 C0（ACCEPTED_BY_PLATFORM），"平台受理"与物理失败可并存（缺纸/卡纸）；无 Command ID、无 Idempotency Key、无审计事件、无重复打印防护；违反唯一执行链路原则 |
| 是否允许扩展 | 禁止（仅安全修复） |
| 迁移触发条件 | HRT Printer 链路（Windows Provider = EHA 演进）真机验证通过（MIGRATION_READY）→ 试点终端闸门切换（进入 MIGRATING） |
| 推荐迁移目标 | HRT Printer Contract + Platform Hardware Provider 链路（ES-HRT-001 19.A） |
| 回退方式 | 终端级闸门一键切回浏览器打印（受控回退，审计） |
| 证据 | SV-02 系列真机验证记录（Phase A 硬件连通、真实门店打印在用）+ 代码证据（Codex 只读核实，2026-07-14）：`app/components/DesktopReceipt.tsx`、`app/components/DayCloseReport.tsx`、`app/components/ShiftReportPrint.tsx`、`app/cashier/page.tsx` |
| 最近核实时间与核实标记 | FACT_VERIFIED · 2026-07-14（真机记录 + 代码证据双重确认） |
| 当前阶段 | CONTAINED |
| 待办 | 等待 HRT Printer 链路真机验证（MIGRATION_READY 条件） |
| 备注 | Milestone B 必须试点替换。迁移期执行以独立 **Legacy Execution Record** 记录，具体字段/状态/存储/UI/退出实现由 Browser Print Legacy Migration Spec 或 Milestone B Development Package 承接（RC1 已裁定，见 5.5）；不进入正式 HRT Command Outcome 统计。试点替换后本链路仅作受控回退并进入退役倒计时。 |

## 4.2 LEG-SCN-001 — 浏览器键盘楔扫码输入链路

| 字段 | 内容 |
| --- | --- |
| Legacy ID | LEG-SCN-001 |
| 名称 | 浏览器扫码输入链路：USB 键盘楔扫码枪 → 浏览器键盘事件 → 独立 Scanner Input 管道（静默窗口 + Focus Policy，SV-01 冻结方案） |
| 当前状态 | 生产在用（SV-01 FINAL FROZEN，真实门店验证） |
| 所属类别 | 设备事件链路 / Scanner 类 |
| 当前 Owner | 治理：创始人 Jason；技术：Desktop Runtime 线 |
| 当前调用方 | Desktop POS 页面扫码输入管道；调用方清单冻结 |
| 当前生产用途 | 商品条码扫描录入 |
| 为什么允许存在 | HRT Scanner 事件链（Provider 设备级识别）尚未建成；本链路是经真机验证的稳定方案 |
| 风险说明 | 无设备级识别（键盘输入与扫码无法从源头区分）；无 Physical Device Identity、无事件 ID/设备序号；焦点依赖；无 Transport Duplicate 治理 |
| 是否允许扩展 | 禁止（仅安全修复） |
| 迁移触发条件 | HRT Provider 事件链真机验证通过 → 至少一个真实终端将新链路设为**唯一业务消费源** |
| 推荐迁移目标 | HRT Scanner Contract 事件链（ES-HRT-001 19.B）；本链路降级为受控降级手段 |
| 回退方式 | 业务消费源切回键盘楔链路（双听架构下的受控降级，审计） |
| 证据 | SV-01 FINAL FROZEN 记录（独立 Scanner Input + 静默窗口 + Focus Policy，真实门店验证）+ 代码证据（Codex 只读核实，2026-07-14）：`app/cashier/page.tsx:2990-3048`、`app/cashier/page.tsx:3555-3594`（条码精确匹配、扫码输入 debounce、扫描结束处理、Scanner Debug、隐藏/专用 Scanner input） |
| 最近核实时间与核实标记 | FACT_VERIFIED · 2026-07-14（冻结记录 + 代码证据双重确认） |
| 当前阶段 | CONTAINED |
| 待办 | 等待 Provider Scanner Event 链真机验证 |
| 备注 | Milestone B 义务：真机验证 + 单终端唯一消费源。双听验证期业务消费源必须唯一，**禁止同一次扫码经两条链路进入业务两次**。SV-01 冻结的 220ms 静默窗口等参数作为 Adapter Spec 输入资产沿用，其变更不属本 Register 治理。**进入 RETIRED 的九项前置判据见 5.8（RC1 冻结）**，观察时长与阈值留 Entry Gate / Scanner Adapter Spec。 |

## 4.3 LEG-DSP-001 — Web Serial 客显页面直写链路

| 字段 | 内容 |
| --- | --- |
| Legacy ID | LEG-DSP-001 |
| 名称 | USB 客显 Web Serial 页面直写链路：POS Shell 页面内桥接组件（UsbCustomerDisplayBridge 路线，轮询会话端点直写串口） |
| 当前状态 | **基础 USB Web Serial 真机能力已验证；最新实时同步行为未 production verified**（RC2 回填） |
| 所属类别 | 设备执行链路 / Customer Display 类 |
| 当前 Owner | 治理：创始人 Jason；技术：Desktop Runtime 线 |
| 当前调用方 | `/desktop/pos?mode=pos` 内挂载的 `UsbCustomerDisplayBridge`；调用方清单冻结 |
| 当前生产用途 | 试点旁路线 / 可试跑能力；**是否为当前生产主链无法确认** |
| 为什么允许存在 | HRT Customer Display 链路未建成；该方案实现时以零冻结文件改动为约束，是过渡期可用解 |
| 风险说明 | **直接违反"POS 页面不得直接写 USB 客显"的冻结禁令**（ES-HRT-001 19.C，属 Grandfathered 豁免而非许可）；无快照 Scope/Expiry 治理（DRAFT/null session 误清屏类缺陷的根源形态）；轮询延迟（约 1.1s 量级）；无审计 |
| 是否允许扩展 | 禁止（仅安全修复） |
| 迁移触发条件 | HRT Customer Display 链路（Provider 写入 + Snapshot 模型）真机验证通过 → 试点终端切换 |
| 推荐迁移目标 | HRT Customer Display Contract（Last-Snapshot-Wins + Session/Transaction Scope + Expiry，ES-HRT-001 19.C） |
| 回退方式 | 终端级闸门切回页面直写链路（受控回退，审计） |
| 证据（已确认事实，Codex 只读核实） | ① `/desktop/pos?mode=pos` 挂载 `UsbCustomerDisplayBridge`；② 链路直接使用 Web Serial：`navigator.serial.requestPort/getPorts`、`SerialPort.writable.getWriter().write()`；③ 不经过 EHA、Electron Provider Contract 或 HRT Provider；④ 基础真机证据：COM3、2400 波特率、成功连接、可显示测试金额、清屏成功 |
| 未确认事实 | ① SV-05B / SV-05C 最新实时购物车同步链路未完成最终真机复验，未达 production verified；② 无法确认 CarGarden 或其他门店是否正式启用；③ 无法确认该链路是否为当前生产主链 |
| 最近核实时间与核实标记 | **PARTIALLY_VERIFIED — BASE USB SERIAL VERIFIED; LATEST REALTIME PATH NOT PRODUCTION VERIFIED** · 2026-07-14 |
| 当前阶段 | CONTAINED |
| 待办 | 补 SV-05B / SV-05C 复验与门店启用事实（**运行事实更新，不阻塞 Register 冻结**）；等待 HRT Display 链路真机验证 |
| 备注 | Milestone B 必须试点替换。显示失败不阻断交易的原则在迁移前后一致适用。`/desktop/display` 网页顾客屏是另一条显示路径，但不是 USB Web Serial 设备执行链，**不创建新的 HRT Legacy 条目**。 |

## 4.4 LEG-EHA-001 — EHA 面向应用的 localhost HTTP API（候选治理记录，RC2 调整）

| 字段 | 内容 |
| --- | --- |
| Legacy ID | LEG-EHA-001（ID 历史保留，不复用） |
| 名称 | EHA（E-Shop Hardware Assistant）面向 Store Applications 的 localhost HTTP API |
| 当前状态 | **在当前可访问仓库、明显项目路径、构建物与日志中，未找到可验证的 EHA 独立工程**（RC2 回填，两轮 Codex 只读核实结论） |
| 所属类别 | 候选治理对象（第二入口防御性记录） |
| 当前 Owner | 治理：创始人 Jason；技术：CTO 监管 |
| 当前调用方 | **无已确认 Consumer** |
| 当前生产用途 | **无法确认** |
| 监听与端点 | 无法确认；文档中的 `127.0.0.1:17802` 仅为历史计划，不是实现证据 |
| Provider Contract | 当前未找到实现证据 |
| 两个必须严格分离的事实 | ① ES-HRT-001 已冻结 EHA 的**未来正式角色**：E-Shop Windows Hardware Provider Host + Executor（该冻结不受本条影响）；② **当前是否真实存在旧 EHA 应用 HTTP API：尚未验证**。不得因为未来角色已冻结，就反推旧 API 当前真实存在 |
| 为什么保留本记录 | 防止未来找回外部仓库、安装包或现场进程后遗漏第二入口治理 |
| 是否允许扩展 | 不适用（无已确认实现）；若确认存在，立即适用"禁止新增 Consumer、禁止新增能力" |
| 后续治理路径 | 若未来找到真实 EHA HTTP API 与 Consumer → 按审批转为 REGISTERED / CONTAINED 并适用 5.7 事件触发式关闭规则；若未来确认从未实现或从未部署 → 关闭候选归类记录；**找回外部资产后的事实更新不要求重新冻结 Register** |
| 证据 | 两轮 Codex 只读核实（2026-07-14）：当前可访问仓库与明显路径中无 EHA 独立工程、无端点实现、无 Consumer 调用点 |
| 最近核实时间与核实标记 | **FACT_VERIFICATION_BLOCKED — EXTERNAL EHA REPOSITORY NOT AVAILABLE** · 2026-07-14 |
| 当前阶段 | **PENDING_CLASSIFICATION** |
| 待办 | 等待外部 EHA 仓库/安装包/现场进程证据（EXTERNAL_EVIDENCE_REQUIRED；运行事实更新，不阻塞 Register 冻结） |
| 备注 | 本条不再作为"已确认 Legacy 正式条目"，调整为待外部证据确认的候选治理对象。 |

## 4.5 LEG-HMF-001 — Electron HMF 控制平面

| 字段 | 内容 |
| --- | --- |
| Legacy ID | LEG-HMF-001 |
| 名称 | Electron Hardware Manager Framework（HMF）控制平面：Desktop Shell 内的设备发现、控制、状态管理能力 |
| 当前状态 | **框架壳已真实加载（Electron Main 加载 Hardware Manager），硬件控制未实现**（RC2 回填）：当前仅实现 DeviceManager 接口、HardwareManager 注册表、placeholder manager、固定 UNAVAILABLE 状态、runtime health / 日志占位；**未实现**真实设备发现、真实设备控制、真实设备状态维护、Provider 管理 |
| 所属类别 | 控制平面豁免类 |
| 当前 Owner | 治理：创始人 Jason；技术：Desktop Runtime 线 |
| 当前调用方 | Desktop Shell 内部模块（Electron Main）；调用方清单冻结 |
| 当前生产用途 | Milestone A 期硬件管理框架壳（HRT 建立前的过渡形态，无真实设备能力） |
| 为什么允许存在 | Milestone A 合法交付物；其退役与代码迁移已由 ES-HRT-001 裁定交 Milestone B 实施计划执行 |
| 风险说明 | **潜在风险，非现实事实**：当前未与 EHA 构成真实双控制平面；风险在于——如果未来继续向 HMF 增加设备发现或控制能力，将违反 ES-HRT-001（同一设备双控制、双发现、双所有权禁令）。当前治理要求：冻结其职责、禁止新增控制能力、Milestone B 中迁移或封存 |
| 是否允许扩展 | **禁止新增任何控制能力**（旧文件/模块名可暂留） |
| 迁移触发条件 | HRT Logic Core 与 DR 内 HRT API 接入门面建立 |
| 推荐迁移目标 | 可复用代码仅迁入三个合法去处：HRT Logic Core / DR 内 HRT API 接入门面 / Provider 管理与进程守护适配（ES-HRT-001 冻结） |
| 回退方式 | 退役过程中旧模块封存不删除，异常时可临时恢复封存模块（受控回退，审计；RETIRED 后不再回退） |
| 证据（Codex 只读核实） | `desktop/src/main/hardware/hardwareManager.ts`、`desktop/src/main/main.ts`（Electron Main 加载 Hardware Manager；模块清单与占位实现如上） |
| 最近核实时间与核实标记 | **FACT_VERIFIED — FRAMEWORK SHELL LOADED; HARDWARE CONTROL NOT IMPLEMENTED** · 2026-07-14 |
| 当前阶段 | CONTAINED |
| 待办 | 等待 HRT Logic Core 与接入门面建立后执行迁移或封存 |
| 备注 | Milestone B 必须退役归一（迁移或封存）。HMF 名称不再用于指代控制平面。 |

## 4.6 LEG-PRT-002 — 云打印链路（已归类移出记录，RC1 裁定）

| 字段 | 内容 |
| --- | --- |
| Legacy ID | LEG-PRT-002 |
| 名称 | 云打印链路：SW-AIOT 云打印机路径（lib/cloudPrinter.ts + app/api/print/**，由顾客 H5 订单触发） |
| 归类裁定（RC1） | **SW-AIOT 云打印不属于门店本地 Hardware Runtime 的本地设备执行链路；它属于 E-Shop Cloud 的远程打印 / 远程执行服务边界。** |
| 当前状态 | 商户侧云打印已按既有产品决策隐藏或停用，**不视为活跃商户能力** |
| 当前 Owner | 治理：创始人 Jason；技术：Cloud 线（后续在 Cloud 侧治理） |
| 当前调用方 | 顾客 H5 订单流程（app/api/print/**，代码存在但商户侧能力已停用）；已知断层：/api/cashier/sales 不触发云打印（SV-02 盘点事实，随条目一并移交 Cloud 治理） |
| 是否允许扩展 | 按既有冻结核心链约束执行（app/api/print/** 属冻结链） |
| 迁移安排 | **不得作为 Milestone B Hardware Runtime Legacy 迁移项** |
| 当前阶段 | **CLASSIFIED_OUT_OF_HRT_SCOPE / TRANSFERRED_TO_CLOUD_GOVERNANCE**（已归类移出，保留为盘点记录） |
| 备注 | 未来若重新启用云打印，需要在 Cloud 侧独立治理远程执行、回执、幂等、权限与安全——本 Register 不展开其架构。本条永久保留为已归类记录，不占用 HRT Legacy 治理容量。 |

## 4.7 新 Legacy 候选结论（RC2 正式关闭）

**本轮未发现需要创建新 Legacy ID 的真实候选。** 第一次盘点提出的三项已全部完成归并，禁止重复登记：

1. 云打印 API / cloudPrinter → 属 LEG-PRT-002，已移出 HRT 范围转 Cloud Governance；
2. window.print 小票、交班、日结 → 全部归入 LEG-PRT-001 Consumer 子清单（共享同一浏览器打印技术链、迁移目标与治理原则，不拆分 Legacy ID）；
3. 键盘/HID 扫码输入 → 归入 LEG-SCN-001。

---

# 第 5 章：迁移原则（继承 ES-HRT-001，此处为治理执行条款）

1. **切换单位**：按"终端 × 设备类别"粒度以配置闸门切换，支持单店单终端试点；闸门互斥——同一时刻同一终端同一设备类别只有一条链路持有执行权，闸门状态审计。
2. **双跑纪律**：命令类（打印、客显、钱箱附带动作）**禁止双发**；事件类（扫码）允许双听验证，但业务消费源唯一，非消费链路事件只进诊断。
3. **回退**：闸门一键切回 Legacy；回退是受控事件，须审计并记录原因；回退不删除新链路注册信息，不使条目阶段自动回退（阶段回退须按 2.4 审批）。
4. **成熟判据**：试点终端在真实营业中达成预定观察期指标（成功率、UNKNOWN 率、Resolution 闭环率——具体数值由 Milestone B Architecture Entry Gate 定义，本 Register 不冻结数值）。
5. **Legacy Execution Record 承接边界（RC1 裁定）**：本 Register 只冻结原则——浏览器打印使用独立 Legacy Execution Record；Legacy Record 不得与正式 HRT Command Outcome 混用；指标必须隔离。具体字段、状态、存储、UI 与退出实现由 **Browser Print Legacy Migration Spec 或 Milestone B Development Package** 承接；**不新增任何"Legacy Execution Baseline"类文件**；本 Register 条目中只记录承接文件、当前状态与证据链接。
6. **退役闭环**：RETIRED 前必须完成：Consumer 清零核实、审计归档、代码移除或封存记录、回退窗口结束；退役后条目与历史永久保留。
7. **第二入口事件触发式关闭规则（适用 LEG-EHA-001，RC1 冻结）**：不冻结固定日历日期，冻结以下事件序列：
   1. 立即禁止新增 Consumer；
   2. 所有现有 Consumer 必须登记入册；
   3. 对应 Provider Contract 新链路真机验收通过后，相关 Consumer 进入迁移（MIGRATING）；
   4. 新链路稳定运行并具备回退能力后，旧 API 进入关闭倒计时（MIGRATING 阶段内的 DECOMMISSIONING 语义）；
   5. 所有登记 Consumer 迁移完成后关闭旧 API；
   6. **出现安全、权限、重复执行、第二入口回流或审计风险时，允许提前强制关闭**（创始人或 CTO 批准）；
   7. 具体日期、负责人与迁移批次属动态字段，不进入冻结规则。
8. **扫码 Legacy 全量退出判据（适用 LEG-SCN-001 进入 RETIRED 的前置条件，RC1 冻结）**——必须同时满足：
   1. Provider Scanner Event 链路完成目标平台真机验证；
   2. 至少一个真实终端已将新链路设为唯一业务消费源；
   3. 完成真实营业观察期；
   4. 相同条码的两次真实扫描不被 Runtime 错误去重；
   5. 单次扫描不经双链路进入业务两次；
   6. 输入丢失、误识别与焦点干扰达到允许范围；
   7. 手工输入兜底可用；
   8. 回退演练通过；
   9. 无剩余登记 Consumer。
   具体观察时长与指标阈值留给 Milestone B Architecture Entry Gate / Scanner Adapter Spec，不在本 Register 规则中写死。

---

# 第 6 章：维护原则

## 6.1 维护职责与两类维护权限（RC1 收口）

维护权限分为两类，边界冻结：

**治理状态变更**（新增正式条目、改变分类、改变风险等级、改变迁移目标、推进至关键治理阶段、宣布 RETIRED）：由创始人 / CTO / 授权架构治理负责人按 2.4 分级批准。

**运行事实更新**（当前 Consumer、当前负责人、当前部署位置、证据路径、测试结果、迁移进度、最近核实时间、当前阻塞项）：由条目 Owner 更新，经 Verifier 核验，**不要求每次创始人批准**。

**Codex 与自动化边界**：Codex 可机械更新已批准内容与事实字段；**Codex 不得自行改变风险等级、迁移目标、分类或治理阶段**；自动化只能追加探测证据与状态建议，不得直接改变治理状态。

维护动作全部留痕（日期、依据、批准人/核验人）。

## 6.2 更新时机

- 发现新 Legacy：**发现即登记**（72 小时内完成登记草案）；
- 阶段变化：事件发生后随下一次工作会话更新；
- 全量复核：每个 Milestone 关键评审点（Entry Gate、Architecture Complete、Production Mature）各执行一次全量复核。

## 6.3 与冻结文件的关系

- 本 Register 的**规则部分**（第 1–3、5–7 章）冻结后按 supersede 机制修订；
- **条目字段值与阶段**是运行数据，按本章更新，不构成文件修订；
- 本 Register 不得被用于变相修改任何上位冻结文件；条目内容与上位文件冲突时以上位文件为准并立即修正条目。

## 6.4 事实核实体系与冻结前置条件（RC2 收口）

两轮 Codex 只读核实已完成（均为只读：未修改文件、未 commit、未 push），结论已按真实证据回填至各条目。**不再进行第三轮搜索**。

**合法、可冻结的诚实登记状态（冻结）**：FACT_VERIFIED、PARTIALLY_VERIFIED、FACT_VERIFICATION_REQUIRED、FACT_VERIFICATION_BLOCKED、PENDING_CLASSIFICATION、EXTERNAL_EVIDENCE_REQUIRED。

核实规则（冻结）：

- **不得把推测写成生产事实**；允许记录预期风险与目标迁移方向；
- 核实必须引用**代码、部署配置、日志或真机证据**；核实动作只读，不得修改生产系统；
- **本 Register 不要求每条记录都达到完全事实确认后才能冻结**：PARTIALLY_VERIFIED / FACT_VERIFICATION_BLOCKED / PENDING_CLASSIFICATION 不构成冻结阻塞，只要被诚实记录且具有明确的后续证据要求与治理路径；
- 冻结后，新证据只更新条目的运行事实字段，**不构成修改 Register 的冻结规则，不要求产生 RC3**；
- 不得因为事实尚未完全确认而继续无限搜索。

**Register 进入 FINAL FROZEN 的前置条件（冻结，取代"三项必须 FACT_VERIFIED"的旧要求）**：

1. 所有已知对象均已登记或归类；
2. 未确认事实均使用诚实核实状态标记；
3. 不把推测写成生产事实；
4. 每个未确认项均有明确的后续证据要求；
5. 不存在未分类的新 Legacy 候选；
6. 治理规则与上位文件一致；
7. 创始人确认 RC2 正文并宣布 FINAL FROZEN。

---

# 第 7 章：冻结边界

## 7.1 本 Register 冻结（待 FINAL FROZEN 后生效）

1. 登记准入判据与"未登记即违规"原则（第 1.3、2.1）；
2. Legacy ID 规则与六阶段最低语义（2.2、2.3）；
3. 阶段推进分级批准机制（2.4，RC1 收口）；
4. "不得扩建"执行细则（2.5）；
5. 登记模板字段结构（第 3 章，含回退方式/证据/核实标记/待办）；
6. 首批治理对象清单（RC2 收口）：五个治理对象，其中四个已确认存在或部分存在（LEG-PRT-001 / LEG-SCN-001 / LEG-DSP-001 / LEG-HMF-001 正式条目），LEG-EHA-001 为待外部证据确认的候选治理对象；LEG-PRT-002 云打印**已归类移出 HRT 范围**并保留为记录（RC1 裁定）；4.7 归并结论（无新 Legacy 候选）；
7. 迁移原则、Legacy Execution Record 承接边界、EHA 事件触发式关闭规则、扫码九项退出判据（第 5 章）；
8. 两类维护权限（治理状态 / 运行事实）、Codex 与自动化边界、诚实核实状态体系与 FINAL FROZEN 七项前置条件（第 6 章，RC2 收口）。

## 7.2 本 Register 不冻结

具体日历日期、负责人与迁移批次（动态字段）；成熟判据的具体指标数值与观察时长（属 Entry Gate / Scanner Adapter Spec）；Legacy Execution Record 的具体字段、状态、存储、UI 与退出实现（属 Browser Print Legacy Migration Spec 或 Milestone B Development Package）；代码路径的实现细节演变；条目字段值与阶段（运行数据）；盘点的具体执行方式。

## 7.3 状态声明

本文件状态为 **FINAL FREEZE CANDIDATE**（V1.0-RC2）。治理规则已收口，两轮 Codex 只读核实的事实已如实回填，6.4 七项冻结前置条件中第 1–6 项已满足；剩余动作仅为第 7 项：创始人确认 RC2 正文并宣布 FINAL FROZEN。PARTIALLY_VERIFIED 与 FACT_VERIFICATION_BLOCKED 条目不构成冻结阻塞（已诚实标记且有后续证据要求）。本文件不自行宣布冻结。

---
---

# 随文提交材料（非 Register 正文）

## 随文材料 1：评审发现与风险提示

1. **事实核实已完成两轮（RC2 更新）**：两轮 Codex 只读核实结论已回填。LEG-DSP-001 为 PARTIALLY_VERIFIED（基础 USB Serial 真机能力已证，最新实时链路未 production verified）；LEG-EHA-001 为 FACT_VERIFICATION_BLOCKED（外部仓库不可访问，无实现证据）；LEG-HMF-001 为 FACT_VERIFIED（框架壳加载、硬件控制未实现）。诚实标记的未确认状态不阻塞冻结（6.4）。
2. **LEG-EHA-001 的真实风险形态已修正（RC2）**：当前无法证明旧 API 真实存在，其风险从"现实第二入口"修正为"防御性候选治理"——防止未来找回外部资产后遗漏第二入口治理。ES-HRT-001 冻结的 EHA 未来角色不受影响；若确认存在即适用 5.7 事件触发式关闭序列。
3. **LEG-SCN-001 的退出可能最慢**：键盘楔识别的平台现实差异（ES-HRT-001 已承认不承诺完全独占）意味着本链路可能长期作为受控降级存在。这不是治理失败，但必须防止"受控降级"滑向"永久默认"——RC1 已将九项退出判据冻结为 5.8，观察时长与阈值留 Entry Gate / Scanner Adapter Spec。
4. **LEG-PRT-002 的归类已裁定（RC1）**：SW-AIOT 云打印不属 HRT 本地设备执行链路，属 E-Shop Cloud 远程打印/远程执行服务边界；商户侧已按产品决策隐藏/停用，不视为活跃能力；已标记 CLASSIFIED_OUT_OF_HRT_SCOPE / TRANSFERRED_TO_CLOUD_GOVERNANCE，不作为 Milestone B HRT 迁移项。
5. **Register 与 Milestone B 的时序**：本 Register 是 Entry Gate 前置资产，但其"待核实"项盘点可与 Entry Gate 起草并行；不应让盘点拖慢 Entry Gate 文本工作。

## 随文材料 2：拍板事项（RC1 已全部裁定）

| # | 事项 | RC1 裁定（已关闭） |
| --- | --- | --- |
| 1 | LEG-EHA-001 关闭规则 | **事件触发式治理（5.7 冻结）**：不冻结日历日期；禁止新增 Consumer → Consumer 登记 → Provider 链路真机验收后迁移 → 稳定且可回退后进入关闭倒计时 → Consumer 清零后关闭；风险事件可触发提前强制关闭；日期/负责人/批次为动态字段 |
| 2 | LEG-PRT-002 云打印归类 | **移出 HRT 范围（4.6 冻结）**：属 E-Shop Cloud 远程打印/远程执行服务边界；商户侧已隐藏/停用，非活跃能力；不作为 Milestone B HRT 迁移项；标记 CLASSIFIED_OUT_OF_HRT_SCOPE / TRANSFERRED_TO_CLOUD_GOVERNANCE |
| 3 | Legacy Execution Record 承接 | **只冻结原则（5.5）**：独立记录、不与正式 Outcome 混用、指标隔离；字段/状态/存储/UI/退出实现由 Browser Print Legacy Migration Spec 或 Milestone B Development Package 承接；不新增 Legacy Execution Baseline；Register 只记录承接文件、状态与证据链接 |
| 4 | Register 维护授权 | **两类权限拆分（2.4、6.1 冻结）**：治理状态变更分级批准（REGISTERED/CONTAINED=CTO；MIGRATION_READY=架构负责人+Verifier；MIGRATING=Milestone Owner；RETIRED/归类/新增=创始人或 CTO）；运行事实由条目 Owner 更新经 Verifier 核验；Codex 不得自行改变治理状态 |
| 5 | LEG-SCN-001 全量退出判据 | **九项前置判据冻结（5.8）**；观察时长与指标阈值留 Entry Gate / Scanner Adapter Spec |

**RC2 已完成事实回填；剩余冻结动作仅一项：创始人确认 RC2 正文并宣布 FINAL FROZEN（6.4 七项前置条件第 1–6 项已满足）。**

## 随文材料 3：FINAL FROZEN 前检查清单

- [x] 随文拍板 1–5 全部有明确结论并回写正文（RC1 完成）
- [x] LEG-PRT-002 归类裁定执行：已移出 HRT 范围并保留记录（RC1 完成）
- [x] 五条正式条目与 ES-HRT-001 第 20.4 章替换义务逐条对齐无冲突
- [x] 与三份上位 FINAL FROZEN 文件无任何再裁定表述
- [x] 事实核实回填完成（RC2）：LEG-DSP-001 = PARTIALLY_VERIFIED；LEG-EHA-001 = FACT_VERIFICATION_BLOCKED（转 PENDING_CLASSIFICATION 候选）；LEG-HMF-001 = FACT_VERIFIED（框架壳）——均引用代码/真机证据，两轮 Codex 核实只读
- [x] 所有已知对象已登记或归类；无未分类新 Legacy 候选（4.7）；未确认事实均诚实标记且有后续证据要求
- [ ] 创始人确认 RC2 正文并宣布 FINAL FROZEN（本文件不自行宣布）
- [ ] Vault 授权恢复后随上位文件一并归档

## 随文材料 4：下一份建议资产

**Milestone B Architecture Entry Gate**（把 ES-HRT-001 20.5 十项条件 + 本 Register 盘点结论固化为可勾选开工闸门；其中第 8 项以本 Register 的 FINAL FROZEN 为满足条件）。其后：必要 ADR（DR↔Provider IPC、macOS Provider 起步与外迁、Provider 打包/升级/守护、EHA 命名迁移）→ Milestone B Development Package（含 Browser Print Legacy Migration Spec 的承接内容）→ 三份 Adapter Spec 随开发进入。本轮不起草。

## 随文材料 5：事实核实状态总结（RC2 最终）

**FACT_VERIFIED**：

- LEG-PRT-001（浏览器打印）——SV-02 真机记录 + 四处代码证据（DesktopReceipt / DayCloseReport / ShiftReportPrint / cashier 页面）；
- LEG-SCN-001（键盘楔扫码）——SV-01 冻结记录 + cashier/page.tsx 代码证据（2990-3048、3555-3594）；
- LEG-HMF-001（HMF）——FRAMEWORK SHELL LOADED; HARDWARE CONTROL NOT IMPLEMENTED（hardwareManager.ts / main.ts）；
- LEG-PRT-002（云打印）——归类与停用状态依据既有产品决策，已移出 HRT 范围。

**PARTIALLY_VERIFIED**：

- LEG-DSP-001——基础 USB Web Serial 真机能力已验证（COM3 / 2400 / 连接 / 测试金额 / 清屏）；SV-05B/05C 最新实时同步链路未 production verified；门店正式启用与生产主链地位无法确认。后续复验为运行事实更新，不阻塞冻结。

**FACT_VERIFICATION_BLOCKED（转 PENDING_CLASSIFICATION 候选）**：

- LEG-EHA-001——外部 EHA 仓库不可访问；当前可访问范围内无可验证的独立工程、端点实现或 Consumer；未来角色（ES-HRT-001 冻结）与旧 API 当前存在性严格分离。等待外部证据（EXTERNAL_EVIDENCE_REQUIRED），不阻塞冻结。

**两轮 Codex 核实均为只读：未修改文件、未 commit、未 push。不再进行第三轮搜索。**

**进入 FINAL FROZEN 的剩余条件**：仅创始人确认 RC2 正文并宣布 FINAL FROZEN（6.4 七项前置条件第 1–6 项已满足）。冻结后新证据只更新运行事实字段，不产生 RC3。

---

# 《ES-LEGACY-REGISTER-001 V1.0-RC1 修订记录》

| 序号 | 修改章节 | 事项 | RC1 裁定/修订 | 影响上位冻结文件 |
| --- | --- | --- | --- | --- |
| 1 | 5.7、4.4、随文 2 | EHA HTTP API 关闭规则 | 冻结为事件触发式治理七条序列（禁增 Consumer → 登记 → 验收后迁移 → 可回退后倒计时 → 清零关闭 → 风险可提前强制关闭 → 日期/负责人/批次为动态字段），不冻结日历日期 | 否 |
| 2 | 4.6、4.0、随文 1/2 | SW-AIOT 云打印归类 | 移出 HRT 范围：属 E-Shop Cloud 远程打印/远程执行服务边界；商户侧已隐藏/停用非活跃能力；不作为 Milestone B HRT 迁移项；标记 CLASSIFIED_OUT_OF_HRT_SCOPE / TRANSFERRED_TO_CLOUD_GOVERNANCE | 否 |
| 3 | 5.5、4.1、7.2 | Legacy Execution Record 承接边界 | Register 只冻结"独立记录、不混用、指标隔离"原则；实现由 Browser Print Legacy Migration Spec 或 Milestone B Development Package 承接；不新增 Legacy Execution Baseline | 否 |
| 4 | 2.4、6.1 | 维护授权拆分 | 治理状态变更（分级批准）与运行事实更新（Owner 更新 + Verifier 核验）两类权限；Codex 可机械更新事实字段但不得改变风险等级/迁移目标/分类/治理阶段；自动化只能追加证据与建议 | 否 |
| 5 | 5.8、4.2 | 扫码 Legacy 全量退出判据 | 九项 RETIRED 前置判据冻结；观察时长与阈值留 Entry Gate / Scanner Adapter Spec | 否 |
| 6 | 2.3、3、4.0–4.5、6.4 | 阶段模型与事实核实收口 | 六阶段最低语义（PENDING_CLASSIFICATION/REGISTERED/CONTAINED/MIGRATION_READY/MIGRATING/RETIRED）；模板新增回退方式/证据/核实标记/待办字段；三项 FACT_VERIFICATION_REQUIRED 强制核实为 FINAL FROZEN 前置条件 | 否 |

修订记录说明：全部修订均为治理规则收口，未修改任何上位 FINAL FROZEN 文件，未重新讨论任何已冻结架构。

---

# 《ES-LEGACY-REGISTER-001 V1.0-RC2 事实核实回填记录》

| 序号 | 条目/事项 | 回填结论（依两轮 Codex 只读核实） |
| --- | --- | --- |
| 1 | LEG-DSP-001 | 代码链确认：`/desktop/pos?mode=pos` 挂载 `UsbCustomerDisplayBridge`，直接使用 Web Serial（`navigator.serial.requestPort/getPorts`、`SerialPort.writable.getWriter().write()`），不经 EHA / Provider Contract / HRT；基础真机验证：COM3、2400 波特率、连接成功、测试金额显示、清屏成功；SV-05B/05C 最新实时同步未 production verified，门店启用与生产主链地位无法确认；状态定为 **PARTIALLY_VERIFIED**，阶段保持 CONTAINED；`/desktop/display` 网页顾客屏不创建新条目 |
| 2 | LEG-EHA-001 | 外部 EHA 仓库不可访问；当前可访问仓库、明显项目路径、构建物与日志中无可验证的 EHA 独立工程、无 Consumer、无端点实现（`127.0.0.1:17802` 仅为历史计划）；调整为 **PENDING_CLASSIFICATION** 候选治理记录，标记 **FACT_VERIFICATION_BLOCKED**；ES-HRT-001 冻结的未来角色与旧 API 当前存在性严格分离；找回外部资产后按审批转 REGISTERED/CONTAINED 或关闭候选记录，不要求重新冻结 |
| 3 | LEG-HMF-001 | 真实代码：`desktop/src/main/hardware/hardwareManager.ts`、`desktop/src/main/main.ts`；Electron Main 加载 Hardware Manager；仅实现 DeviceManager 接口、注册表、placeholder manager、固定 UNAVAILABLE、health/日志占位；无真实设备发现/控制/状态/Provider 管理；未与 EHA 构成真实双控制平面（风险改为潜在）；标记 **FACT_VERIFIED — FRAMEWORK SHELL LOADED; HARDWARE CONTROL NOT IMPLEMENTED**，阶段保持 CONTAINED |
| 4 | LEG-PRT-001 Consumer 归并 | `app/components/DesktopReceipt.tsx`（window.open + win.print()）、`app/components/DayCloseReport.tsx`、`app/components/ShiftReportPrint.tsx`（打印窗口 + window.print()）、`app/cashier/page.tsx`（统一触发小票/交班/日结/自动打印）补入 Consumer 子清单；四类业务用途共享同一技术链与迁移目标，不拆分新 Legacy ID |
| 5 | LEG-SCN-001 证据归并 | `app/cashier/page.tsx:2990-3048`、`app/cashier/page.tsx:3555-3594`（条码精确匹配、扫码 debounce、扫描结束处理、Scanner Debug、隐藏/专用 Scanner input）补入证据；保持单一条目 |
| 6 | 新 Legacy 候选 | 未发现需创建新 Legacy ID 的真实候选；首轮三项候选全部归并（云打印→LEG-PRT-002 移出、window.print 各用途→LEG-PRT-001、键盘/HID 扫码→LEG-SCN-001），禁止重复登记 |
| 7 | 核实方式声明 | 两轮 Codex 核实均为只读：未修改文件、未 commit、未 push；不再进行第三轮搜索；冻结后新证据仅更新运行事实字段，不产生 RC3 |

---

*ES-LEGACY-REGISTER-001 · Legacy Grandfathered Register V1 · V1.0-RC2 · FINAL FREEZE CANDIDATE · 2026-07-14*
*上位文件：ES-CONST-001 / ES-STRAT-001 / ES-HRT-001（均 FINAL FROZEN）*
*版本演进：DRAFT → V1.0-RC1 → V1.0-RC2（FINAL FREEZE CANDIDATE）*
