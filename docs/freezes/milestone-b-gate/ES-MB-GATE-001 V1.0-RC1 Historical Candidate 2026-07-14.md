# Milestone B Architecture Entry Gate
## Milestone B 架构开工闸门

| 项目 | 内容 |
| --- | --- |
| 文档编号 | ES-MB-GATE-001 |
| 文档名称 | 《Milestone B Architecture Entry Gate》（Milestone B 架构开工闸门） |
| 版本 | V1.0-RC1 |
| 状态 | **FINAL FREEZE CANDIDATE** |
| 起草日期 | 2026-07-14 |
| RC1 收口日期 | 2026-07-14（EHA 路线裁定、Vault 事实拆分、统计地位调整，修订记录见文末） |
| 资产类型 | 架构开工闸门（非 Baseline、非 ADR、非 Development Package、非实施计划） |
| 上位文件 | ES-CONST-001 V1.0、ES-STRAT-001 V1.0、ES-HRT-001 V1.0、ES-LEGACY-REGISTER-001 V1.0（均 FINAL FROZEN） |
| 下位/后续资产 | 必要 ADR 组、Milestone B Development Package、各 Adapter Spec |

---

# 第 1 章：文件定位

本文件只回答一个问题：**Milestone B 是否已经具备进入工程开发的条件？**

本文件不重新讨论或修改任何已冻结架构结论。它只负责：引用冻结结论、检查前置条件、记录证据、标记满足状态、识别真正阻塞项、明确开工前必须关闭与可后置验证的事项、给出最终 Gate 结论。

# 第 2 章：上位冻结资产

| 编号 | 名称 | 版本 | 状态 | 生效日期 |
| --- | --- | --- | --- | --- |
| ES-CONST-001 | Store Operating System Constitution | V1.0 | FINAL FROZEN | 2026-07-14 |
| ES-STRAT-001 | Store Operating System Strategy Baseline | V1.0 | FINAL FROZEN | 2026-07-14 |
| ES-HRT-001 | Hardware Runtime Baseline | V1.0 | FINAL FROZEN | 2026-07-14 |
| ES-LEGACY-REGISTER-001 | Legacy Grandfathered Register | V1.0 | FINAL FROZEN | 2026-07-14 |

本 Gate 完整继承四份文件的全部冻结裁定（七层架构、唯一执行链路、方案 C、EHA 角色、HMF 退役、三分身份模型、三套状态模型、六值 Outcome、C0/C1/C2、Side-Effect Boundary、UNKNOWN/Resolution、Scanner 主动事件、客显 Snapshot、首批三类设备、钱箱/摄像头排除、Legacy 治理规则等），一律只引用、不再裁定。

# 第 3 章：Gate 判定规则

## 3.1 三类条件

- **A 类——开工前必须关闭（HARD BLOCKER）**：未满足则 Milestone B 不得启动开发。
- **B 类——开工时必须有明确承接（REQUIRED BEFORE WORKSTREAM）**：允许总体开工，但对应 Workstream 启动前必须关闭；须有 Owner、承接资产与最迟关闭节点。
- **C 类——可在开发中验证（DEVELOPMENT VALIDATION）**：真机、实现或试点验证事项，不得错误提升为开工阻塞。

## 3.2 状态枚举

条目状态：**PASS / CONDITIONAL / BLOCKED / NOT APPLICABLE**。
Gate 总结论：**PASS / CONDITIONAL PASS / BLOCKED**（不允许模糊结论）。

## 3.3 证据纪律

证据只允许引用：上位冻结文件章节、冻结/修订记录、Codex 只读核实结论、仓库与真机事实。证据不足时如实标记 BLOCKED / CONDITIONAL / FACT VERIFICATION REQUIRED，不得补造事实。

---

# 第 4 章：Gate 检查表（十二个检查域）

字段说明：类型 A=HARD BLOCKER，B=REQUIRED BEFORE WORKSTREAM，C=DEVELOPMENT VALIDATION。证据缩写：CONST=ES-CONST-001，STRAT=ES-STRAT-001，HRT=ES-HRT-001，REG=ES-LEGACY-REGISTER-001，冻结决议=各文件冻结决议/修订记录，Codex=两轮 Codex 只读核实。

## Domain 1：上位资产状态

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-UP-01 | ES-CONST-001 是否 FINAL FROZEN | A | PASS | CONST V1.0 冻结状态 | None | 创始人 | 无 | — | — |
| MB-GATE-UP-02 | ES-STRAT-001 是否 FINAL FROZEN | A | PASS | STRAT V1.0 冻结状态 | None | 创始人 | 无 | — | — |
| MB-GATE-UP-03 | ES-HRT-001 是否 FINAL FROZEN | A | PASS | HRT V1.0 冻结决议（24 项）+ Final Freeze Record | None | 创始人 | 无 | — | — |
| MB-GATE-UP-04 | ES-LEGACY-REGISTER-001 是否 FINAL FROZEN | A | PASS | REG V1.0（RC2 后经创始人确认冻结） | None | 创始人 | 无 | — | — |
| MB-GATE-UP-05a | ES-LEGACY-REGISTER-001 归档是否可核验 | B | PASS | **已真实写入 Vault**：`03-冻结文档/01-正式冻结/ES-LEGACY-REGISTER-001 Legacy Grandfathered Register V1.0 FINAL FROZEN.md`；RC2 历史候选与 Final Freeze Record 亦已归档 | None | CTO | 无 | — | — |
| MB-GATE-UP-05b | ES-HRT-001 归档是否可核验 | B | CONDITIONAL | 本会话证据：Vault 写入未执行（MCP 授权仅限 uploads）；正式版、RC2 存档与 Final Freeze Record 三份文件已在本地工作区生成，目标路径已声明 | Vault 内正式路径尚未写入 | CTO | Vault 补归档任务 | Architecture Complete 前 | 冻结效力不受影响 |
| MB-GATE-UP-05c | ES-CONST-001 / ES-STRAT-001 归档是否可核验 | B | CONDITIONAL | **FACT VERIFICATION REQUIRED**：本 Gate 无两份文件的 Vault 归档证据，不得猜测 | 归档状态未核实 | CTO | 归档状态核实（已归档即关闭；未归档则补做） | Architecture Complete 前 | 逐份按真实证据处置 |
| MB-GATE-UP-05d | 本 Gate 自身归档 | — | NOT APPLICABLE | 本 Gate 尚未冻结，未归档属正常状态 | None | CTO | 冻结后归档 | — | 不计作上位资产缺口 |
| MB-GATE-UP-06 | 是否存在会覆盖正式版的未关闭候选文件 | A | PASS | HRT RC2 已作历史候选存档并声明不覆盖；REG RC 版本按 supersede 链保留 | None | CTO | 无 | — | 历史版本只读保留 |

## Domain 2：Milestone B 范围关闭

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-SCOPE-01 | 首批设备是否仅打印机/扫码枪/USB 客显 | A | PASS | STRAT 首批范围；HRT 第 19 章 | None | 创始人 | 无 | — | — |
| MB-GATE-SCOPE-02 | 钱箱是否仍为 Printer Contract 附带动作 | A | PASS | HRT 19.A、冻结决议第 21 项 | None | CTO | 无 | — | 独立授权/审计/永不自动重试 |
| MB-GATE-SCOPE-03 | 摄像头是否明确排除 | A | PASS | STRAT（Restricted Device Class）；HRT 非目标 6 | None | CTO | 无 | — | — |
| MB-GATE-SCOPE-04 | 是否存在未经批准的第四类设备 | A | PASS | REG 4.7：无新 Legacy 候选；无第四类设备申请 | None | CTO | 无 | — | — |
| MB-GATE-SCOPE-05 | 云打印是否被错误纳入 HRT 本地范围 | A | PASS | REG 4.6：LEG-PRT-002 已 CLASSIFIED_OUT_OF_HRT_SCOPE | None | CTO | 无 | — | 未来重启走 Cloud 治理 |
| MB-GATE-SCOPE-06 | 是否明确不建设第三方 Provider 生态 | A | PASS | HRT 非目标 5 | None | CTO | 无 | — | — |

## Domain 3：宿主与进程边界

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-HOST-01 | 方案 C 是否正式接受 | A | PASS | HRT 5.3 裁定 + 冻结决议第 3 项 | None | 创始人 | 无 | — | — |
| MB-GATE-HOST-02 | HRT Logic Core 是否宿主于 DR 进程域 | A | PASS | HRT 5.3 | None | CTO | 无 | — | — |
| MB-GATE-HOST-03 | Provider 是否默认独立进程 | A | PASS | HRT 5.3、14.8 | None | CTO | 无 | — | — |
| MB-GATE-HOST-04 | 同进程是否仍强制 Contract | A | PASS | HRT 5.3 第 5 条（七项强制约束） | None | CTO | 无 | — | 执法依赖代码评审 + Gate 工具 |
| MB-GATE-HOST-05 | DR 与 HRT 是否禁止直改对方持久化 | A | PASS | HRT 5.3、第 6 章矩阵补充裁定 | None | CTO | 无 | — | — |
| MB-GATE-HOST-06 | Provider 崩溃是否不得摧毁 DR | A | PASS | HRT 14.5 | None | CTO | 无 | — | 崩溃恢复演练属 C 类（真机） |
| MB-GATE-HOST-07 | Windows Provider 是否由 EHA 演进承担 | A | PASS | HRT 14.7（角色冻结） | None | 创始人 | 无 | — | **工程仓库事实见 Domain 11** |
| MB-GATE-HOST-08 | macOS Provider 是否 Contract 同构 + 可外迁 | A | PASS | HRT 14.8（例外边界冻结） | None | CTO | ADR（外迁条件） | macOS WS 前 | 例外不得长期化 |

## Domain 4：控制面归一

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-CTRL-01 | HMF 控制平面退役方向是否关闭 | A | PASS | HRT 20.4；冻结决议第 6 项 | None | CTO | 无 | — | — |
| MB-GATE-CTRL-02 | HMF 当前是否只有框架壳 | A | PASS | REG LEG-HMF-001：FACT_VERIFIED — FRAMEWORK SHELL LOADED; HARDWARE CONTROL NOT IMPLEMENTED（hardwareManager.ts / main.ts） | None | Verifier | 无 | — | 双控制面为潜在风险而非现实 |
| MB-GATE-CTRL-03 | 是否禁止向 HMF 新增发现/控制能力 | A | PASS | REG LEG-HMF-001 扩建禁令 | None | CTO | 无 | — | 违反即架构违规 |
| MB-GATE-CTRL-04 | EHA 是否不构成第二入口 | A | PASS | HRT 14.7；REG LEG-EHA-001：当前无可验证旧 API 实现（FACT_VERIFICATION_BLOCKED），第二入口为防御性候选治理 | None | CTO | REG 运行事实维护 | — | 找回外部资产即适用 5.7 关闭规则 |
| MB-GATE-CTRL-05 | Store Applications 是否禁止直连 EHA | A | PASS | CONST 唯一链路；HRT 14.4 禁令 | None | CTO | 无 | — | — |
| MB-GATE-CTRL-06 | AI 是否禁止直连 EHA/Provider/Adapter | A | PASS | CONST；HRT 5.2、18.3 | None | CTO | 无 | — | — |
| MB-GATE-CTRL-07 | 同一设备是否只允许一个 Provider Ownership | A | PASS | HRT 14.4（Ownership 唯一性冻结） | None | CTO | 无 | — | — |
| MB-GATE-CTRL-08 | 是否禁止双发现/双控制/双发命令 | A | PASS | HRT 14.4；REG 第 5 章双跑纪律 | None | CTO | 无 | — | 命令类禁双发；扫码双听单消费 |

## Domain 5：Device Contract 可开发性

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-DC-01 | Device Contract 十三构件是否冻结 | A | PASS | HRT 10.2 | None | CTO | 无 | — | — |
| MB-GATE-DC-02 | Printer Contract 是否可开发 | A | PASS | HRT 19.A（能力/命令/双模型/边界/防重/钱箱语义完整） | None | CTO | Printer Adapter Spec | 对应 WS 前 | C1/C2 可达性属 C 类真机验证 |
| MB-GATE-DC-03 | Scanner Contract 是否可开发 | A | PASS | HRT 19.B（主动事件/Transport 去重/ENABLE-DISABLE） | None | CTO | Scanner Adapter Spec | 对应 WS 前 | 静默窗口阈值留 Adapter Spec |
| MB-GATE-DC-04 | Customer Display Contract 是否可开发 | A | PASS | HRT 19.C（Snapshot 概念语义 + 覆盖规则） | None | CTO | Display Adapter Spec | 对应 WS 前 | Expiry 参数留 Adapter Spec |
| MB-GATE-DC-05 | Contract 与 Adapter Spec 边界是否清楚 | A | PASS | HRT 10.1、15.5、21.2 | None | CTO | 无 | — | — |
| MB-GATE-DC-06 | 厂商协议是否正确留给 Adapter Spec | A | PASS | HRT 21.2 不冻结清单（ESC/POS、HID、串口、Khmer 等） | None | CTO | 三份 Adapter Spec | 对应 WS 前 | — |
| MB-GATE-DC-07 | macOS 与 Windows 是否共享同一套 Contract | A | PASS | HRT 冻结决议第 7 项 + 八问 Q4 | None | CTO | 无 | — | 禁止 macOS 专属语义 |
| MB-GATE-DC-08 | 是否仍存在迫使开发者自行决定的 Contract 核心语义 | A | PASS | HRT RC1/RC2 修订记录：Outcome/CL、边界、Resolution、Slot SoT、快照 Scope 均已关闭 | None | CTO | 无 | — | 数值门限类均已显式指派承接文件 |

## Domain 6：设备身份与配置真源

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-ID-01 | 三分模型是否关闭 | A | PASS | HRT 第 8 章 | None | CTO | 无 | — | — |
| MB-GATE-ID-02 | Slot Definition SoT 是否为 E-Shop Cloud | A | PASS | HRT 8.1/8.3、冻结决议第 8 项 | None | CTO | 无 | — | HRT 只持本地有效副本 |
| MB-GATE-ID-03 | Physical Device Identity SoT 是否为 HRT | A | PASS | HRT 8.1、冻结决议第 9 项 | None | CTO | 无 | — | — |
| MB-GATE-ID-04 | Assignment Runtime SoT 是否为 HRT | A | PASS | HRT 8.4 | None | CTO | 无 | — | — |
| MB-GATE-ID-05 | Health / Provider Ownership SoT 是否为 HRT | A | PASS | HRT 8.1、14.4、16 章 | None | CTO | 无 | — | — |
| MB-GATE-ID-06 | 新设备是否必须新建 Physical Device ID | A | PASS | HRT 8.2（禁止指纹接续） | None | CTO | 无 | — | — |
| MB-GATE-ID-07 | Device Replacement 是否为 Assignment 变化 | A | PASS | HRT 8.7、9.6 | None | CTO | 无 | — | — |
| MB-GATE-ID-08 | REMOVED 是否不可自动恢复 | A | PASS | HRT 9.1、9.5 第 7 条 | None | CTO | 无 | — | — |
| MB-GATE-ID-09 | ENDED Assignment 是否不可重新激活 | A | PASS | HRT 9.3 | None | CTO | 无 | — | — |
| MB-GATE-ID-10 | 应用是否默认面向 Slot/Capability 寻址 | A | PASS | HRT 8.3、第 11 章 | None | CTO | 无 | — | 直接指定物理设备仅限诊断/管理 |

## Domain 7：Command、Outcome 与幂等模型

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-CMD-01 | Command ID 与 Idempotency Key 是否分离 | A | PASS | HRT 11.2、13.1 | None | CTO | 无 | — | — |
| MB-GATE-CMD-02 | Outcome 是否固定六值 | A | PASS | HRT 12.1、冻结决议第 13 项 | None | CTO | 无 | — | — |
| MB-GATE-CMD-03 | FAILED+NOT_CROSSED 是否替代第七种 Outcome | A | PASS | HRT RC2 修订记录第 3 项 | None | CTO | 无 | — | — |
| MB-GATE-CMD-04 | C0/C1/C2 是否与 Outcome 分离 | A | PASS | HRT 12.2 | None | CTO | 无 | — | 分开统计 |
| MB-GATE-CMD-05 | PRINT_RECEIPT 成功门槛是否 ≥ C1 | A | PASS | HRT 19.A 第 2 条、冻结决议第 15 项 | None | CTO | 无 | — | C1/C2 可达性真机验证属 C 类 |
| MB-GATE-CMD-06 | Side-Effect Boundary 三态是否关闭 | A | PASS | HRT 12.5 | None | CTO | Adapter Spec（检测点） | 对应 WS 前 | — |
| MB-GATE-CMD-07 | UNKNOWN 是否不可改写 | A | PASS | HRT 12.4 | None | CTO | 无 | — | — |
| MB-GATE-CMD-08 | Resolution 是否独立追加 | A | PASS | HRT 12.4、13.6 | None | CTO | 无 | — | — |
| MB-GATE-CMD-09 | UNKNOWN 是否禁止自动重试 | A | PASS | HRT 12.7、13.4 | None | CTO | 无 | — | — |
| MB-GATE-CMD-10 | 钱箱是否永不自动重试 | A | PASS | HRT 12.7、19.A 第 6 条 | None | CTO | 无 | — | — |
| MB-GATE-CMD-11 | Provider 重连是否禁止自动重放未确认命令 | A | PASS | HRT 13.3、14.5 | None | CTO | 无 | — | — |

## Domain 8：Event 与 Snapshot 模型

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-EVT-01 | Scanner 是否为主动事件设备 | A | PASS | HRT 17.5、19.B | None | CTO | 无 | — | — |
| MB-GATE-EVT-02 | Runtime 是否只去重 Transport Duplicate | A | PASS | HRT 17.3 | None | CTO | 无 | — | DUPLICATE_EVENT_DELIVERY 为诊断项 |
| MB-GATE-EVT-03 | 相同条码两次真实扫描是否为两个有效事件 | A | PASS | HRT 19.B 第 3 条 | None | CTO | 无 | — | 业务重复由应用裁量 |
| MB-GATE-EVT-04 | 是否定义 Event ID 与设备单调序号 | A | PASS | HRT 17.2 | None | CTO | 无 | — | — |
| MB-GATE-EVT-05 | 客显是否 Last-Snapshot-Wins | A | PASS | HRT 19.C 第 1 条 | None | CTO | 无 | — | 无命令队列，仅最新快照 |
| MB-GATE-EVT-06 | 是否具备 Session/Transaction Scope | A | PASS | HRT 19.C Snapshot 概念语义 | None | CTO | 无 | — | — |
| MB-GATE-EVT-07 | 是否具备 Expiry / Clear Condition | A | PASS | HRT 19.C | None | CTO | Adapter Spec（参数） | 对应 WS 前 | — |
| MB-GATE-EVT-08 | 旧支付状态是否不得永久压制新交易 | A | PASS | HRT 19.C 第 2 条 | None | CTO | 无 | — | — |
| MB-GATE-EVT-09 | 客显失败是否不得阻断交易 | A | PASS | HRT 19.C 第 4 条 | None | CTO | 无 | — | Store Continuity First |

## Domain 9：Legacy 治理准备度

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-LEG-01 | Legacy Register 是否冻结 | A | PASS | REG V1.0 FINAL FROZEN | None | 创始人 | 无 | — | — |
| MB-GATE-LEG-02 | 所有已知对象是否已登记或归类 | A | PASS | REG 4.0/4.7（五对象 + 一移出记录；无新候选） | None | CTO | 无 | — | 未登记即违规原则生效 |
| MB-GATE-LEG-03 | LEG-PRT-001 是否禁止扩建 | A | PASS | REG 2.5、条目字段 | None | CTO | 无 | — | Consumer 子清单冻结 |
| MB-GATE-LEG-04 | LEG-SCN-001 是否禁止扩建 | A | PASS | REG 条目字段 | None | CTO | 无 | — | — |
| MB-GATE-LEG-05 | LEG-DSP-001 是否禁止扩建 | A | PASS | REG 条目字段（PARTIALLY_VERIFIED 不影响围堵） | None | CTO | 无 | — | SV-05B/C 复验属 C 类 |
| MB-GATE-LEG-06 | LEG-HMF-001 是否禁止扩建 | A | PASS | REG 条目字段（禁止新增控制能力） | None | CTO | 无 | — | — |
| MB-GATE-LEG-07 | LEG-EHA-001 是否保持候选治理 + 外部证据要求 | A | PASS | REG：PENDING_CLASSIFICATION / FACT_VERIFICATION_BLOCKED / EXTERNAL_EVIDENCE_REQUIRED | None | 创始人 | REG 运行事实维护 | — | 不阻塞 Register 效力 |
| MB-GATE-LEG-08 | LEG-PRT-002 是否已移出 HRT | A | PASS | REG 4.6 | None | CTO | 无 | — | — |
| MB-GATE-LEG-09 | 命令类切换是否禁止双发 | A | PASS | REG 5.2；HRT 20.3 | None | CTO | 无 | — | — |
| MB-GATE-LEG-10 | 扫码双听是否唯一业务消费源 | A | PASS | REG 5.2；HRT 19.B/20.3 | None | CTO | 无 | — | 禁止同一扫码双入业务 |
| MB-GATE-LEG-11 | 是否已有回退原则 | A | PASS | REG 5.3 + 各条目回退方式字段 | None | CTO | 无 | — | 回退演练属 C 类真机 |
| MB-GATE-LEG-12 | 浏览器打印 Legacy Execution Record 是否有下位承接 | B | CONDITIONAL | REG 5.5：原则已冻结；承接文件（Browser Print Legacy Migration Spec 或 Dev Package）**尚未起草** | 承接内容未成文 | CTO | Milestone B Development Package | 打印切换 WS 前 | 未关闭则打印试点替换不得切换 |

## Domain 10：ADR 留白清单

判定纪律：只分类，不起草；避免"为了完整而写 ADR"。分类值：开工前必须完成 / 对应 Workstream 前 / 可在开发中关闭 / 不需要 ADR。

| Gate ID | 留白事项 | 判定 | 建议 ADR 归并 | 状态 | Owner | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-ADR-01 | DR ↔ Windows Provider IPC 选型 | 对应 Workstream 前 | **ADR-01（IPC/安全/序列化合并）** | CONDITIONAL | CTO | Windows Provider WS 前 | HRT Logic Core 可先以内部 Contract 抽象开发，不依赖传输选型 |
| MB-GATE-ADR-02 | IPC 身份校验与本地安全边界 | 对应 Workstream 前 | ADR-01 | CONDITIONAL | CTO | Windows Provider WS 前 | 与选型不可分割，合并裁定 |
| MB-GATE-ADR-03 | Provider 注册、握手与版本兼容 | 对应 Workstream 前 | **ADR-02** | CONDITIONAL | CTO | Provider Manager 实现任务前 | 语义已由 HRT 冻结，ADR 只定协议细节 |
| MB-GATE-ADR-04 | Provider 打包、安装、升级与回滚 | 可在开发中关闭 | **ADR-03（打包/升级/守护合并）** | CONDITIONAL | CTO | 真机验收前 | 不阻塞编码 |
| MB-GATE-ADR-05 | Provider 进程守护与崩溃重启 | 对应 Workstream 前 | ADR-03 | CONDITIONAL | CTO | Windows Provider WS 前 | DR 守护策略影响进程模型实现 |
| MB-GATE-ADR-06 | macOS Provider 起步形态与外迁触发条件 | 对应 Workstream 前 | **ADR-04** | CONDITIONAL | CTO | macOS Provider WS 前 | Milestone B 内 macOS 为后置 WS |
| MB-GATE-ADR-07 | EHA 工程命名迁移 | 不需要独立 ADR | 并入 Dev Package 实施说明 | NOT APPLICABLE | CTO | — | HRT 已裁定改名不阻塞架构落地 |
| MB-GATE-ADR-08 | HRT / Provider 本地持久化选型 | 对应 Workstream 前 | **ADR-05** | CONDITIONAL | CTO | HRT Logic Core 持久化实现任务前 | 接口先行，实现任务前关闭选型 |
| MB-GATE-ADR-09 | Provider Contract 序列化与版本协商 | 对应 Workstream 前 | ADR-01 | CONDITIONAL | CTO | Windows Provider WS 前 | 与 IPC 同一决策域 |
| MB-GATE-ADR-10 | Runtime feature gate / Legacy 切换闸门 | 对应 Workstream 前 | **ADR-06** | CONDITIONAL | CTO | Legacy 切换 WS / 首次试点前 | 闸门互斥语义已冻结（REG 5.1），ADR 只定实现机制 |

**结论：必要 ADR 共 6 份（ADR-01…ADR-06）；无任何一份构成 Milestone B 总体开工阻塞；全部为对应 Workstream 前关闭。**

## Domain 11：工程与仓库准备度

诚实区分：架构 Gate（Domain 1–10）已由冻结文件支撑；本域为**工程仓库 Gate 与真机资源 Gate**，不得因文档冻结而假设工程资产存在。

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-ENG-01 | Desktop Runtime 仓库与主分支是否明确 | A | PASS | Codex：`desktop/src/main/*` 存在于主仓库（hardwareManager.ts / main.ts 已核实） | None | CTO | 无 | — | 分支策略见 ENG-06 |
| MB-GATE-ENG-02a | EHA 工程路径方向是否已裁定 | A | PASS | **创始人正式裁定（RC1）：停止搜索旧 EHA 仓库；WS-2 启动前重新初始化正式 E-Shop Windows Hardware Provider 仓库**。新仓库继承 ES-HRT-001 冻结角色（Provider Host + Executor；非 Runtime、非第二入口、不面向应用提供直接硬件调用）；未来找回旧仓库只作受控参考资产（可审计、可选择性迁移，不直接覆盖新仓库，不反向改变冻结架构）；不设日历搜索宽限期 | None | 创始人 | 无 | — | 方向未决已关闭 |
| MB-GATE-ENG-02b | Windows Provider 正式仓库是否已初始化 | B | CONDITIONAL | 裁定为重建，**仓库当前尚不存在**（不得把"授权重建"写成"仓库已存在"） | 仓库未初始化 | 创始人授权，CTO / Milestone Owner 执行 | Dev Package + 仓库初始化任务 | WS-2 编码启动前 | 未初始化则 WS-2 不得开始编码 |
| MB-GATE-ENG-03 | EHA 仓库不可访问是否阻塞 Milestone B 整体开工 | A | PASS（判定：否） | 最小阻塞原则：HRT Logic Core / Contract / 测试挂具 / Dev Package 均不依赖 EHA 工程 | None | CTO | 本 Gate 6.2 裁定 | — | 证据支持的裁定，非假设 |
| MB-GATE-ENG-04 | HMF 当前代码位置是否已核实 | A | PASS | REG LEG-HMF-001 证据（Codex 只读核实） | None | Verifier | 无 | — | — |
| MB-GATE-ENG-05 | 未跟踪目录是否影响开发与提交安全 | B | CONDITIONAL | **FACT VERIFICATION REQUIRED**：本 Gate 无仓库工作区状态证据 | 未核查 | Codex（只读）+ Verifier | Dev Package 前置核查任务 | Dev Package 定稿前 | 只读核查，不改生产 |
| MB-GATE-ENG-06 | 是否需要正式 Milestone B 工作分支 | B | CONDITIONAL | 无既定分支策略证据 | 策略未定 | CTO | Dev Package（分支与提交纪律章节） | Codex 开发启动前 | 继承 Dev-Gate-01A 类护栏经验 |
| MB-GATE-ENG-07 | CI / build / test 是否存在可运行基础 | B | CONDITIONAL | Milestone A 事实：Windows CI 存在；测试基线现状未在本轮核查 | 现状未复核 | Codex（只读）+ Verifier | Dev Package 前置核查任务 | Codex 开发启动前 | — |
| MB-GATE-ENG-08 | 是否已有真实 Windows 测试机与三类设备 | C | PASS | SV 系列真实门店记录：Xprinter XP-N160II、USB 键盘楔扫码枪、USB 客显（COM3/2400 真机证据） | None | 创始人 | Dev Package（测试机与生产机分离安排） | 真机验收前 | 开发用测试位安排由 Dev Package 明确 |
| MB-GATE-ENG-09 | 是否已有真机验收纪律与记录模板 | B | CONDITIONAL | 纪律已有先例（SV 系列 Real Device First、EHA-01B 九项真机清单）；**标准化模板未成文** | 模板未固化 | CTO | Dev Package（验收模板章节） | 首个真机验证点前 | "理论通过"不构成验收 |
| MB-GATE-ENG-10 | 秘密/驱动/安装包/环境依赖是否明确 | B | CONDITIONAL | **FACT VERIFICATION REQUIRED**：未在本轮核查 | 清单未建 | Codex（只读）+ CTO | Dev Package 前置核查任务 | Windows Provider WS 前 | 含打印驱动、串口驱动、签名与分发依赖 |

## Domain 12：Milestone B Development Package 准备度

| Gate ID | 检查项 | 类型 | 状态 | 证据 | 缺口 | Owner | 承接资产 | 最迟关闭节点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MB-GATE-DP-01 | Milestone B Development Package 是否为 Codex 正式开发前的必需资产 | A | PASS（判定：是，且**尚未起草**） | 项目既有纪律（小步、可验证、真机验收、Gate before dispatch）；Dev Package 须承载：总目标、Workstream 划分、每 WS 输入/输出/禁止边界、验收标准、真机验证点、回滚策略、Commit 划分、Legacy 切换关系、文档承接清单（含 Legacy Execution Record 内容与真机指标数值）、Freeze/Acceptance 规则 | Dev Package 未成文 | CTO | **Milestone B Development Package（下一份资产）** | Codex 正式开发启动前 | **未批准前 Codex 不得开始正式开发**；真机指标数值在 Dev Package / Adapter Spec 定义，不得由 Codex 自行决定 |

---

# 第 5 章：已满足的硬条件（汇总）

**当前版本统计的 A 类架构硬条件全部 PASS；具体数量是检查表运行统计，不属于不可变架构裁定。** 覆盖范围：四份上位资产 FINAL FROZEN 且无覆盖性候选（UP-01…04、06）；范围关闭（SCOPE-01…06）；方案 C 宿主与进程边界（HOST-01…08）；控制面归一（CTRL-01…08）；三类 Contract 可开发（DC-01…08）；身份与真源（ID-01…10）；命令/Outcome/幂等（CMD-01…11）；事件与快照（EVT-01…09）；Legacy 治理（LEG-01…11）；工程侧 ENG-01/02a/03/04/08 与 DP-01 判定。**架构方向、真源归属、控制面、Contract 语义层面无任何未关闭项。**

# 第 6 章：阻塞项裁定

## 6.1 全局硬阻塞

**0 项。** 不存在未关闭架构方向、真源冲突、第二控制面、关键 Contract 缺失或范围未关闭。

## 6.2 Workstream 级阻塞（1 项）

**WS-2（Windows Provider 实现）仍为 Workstream 级阻塞，但性质已变（RC1 更新）**：

- **方向未决已关闭**：创始人正式裁定停止搜索旧 EHA 仓库，WS-2 启动前重新初始化正式 E-Shop Windows Hardware Provider 仓库（MB-GATE-ENG-02a：PASS）；未来找回旧仓库只作受控参考资产，不重开本裁定；
- **WS-2 编码启动前仍必须完成**：正式仓库初始化（ENG-02b / C2）；ADR-01（IPC/安全/序列化）、ADR-02（注册握手）、ADR-03（打包/守护）；Development Package 中 WS-2 的输入、输出、边界与验收定义（C1）；
- 该阻塞**不影响**：Entry Gate 自身、Dev Package 起草、HRT Logic Core / 内部 Contract / Device Registry / 测试挂具开发、三份 Adapter Spec 起草、ADR 起草；
- 连带影响：WS-3/4/5（打印/扫码/客显链路）的**设备执行段**依赖 WS-2 产出，但其 Contract 测试、Adapter Spec、DR 侧接入与 Legacy 闸门开发可先行。

# 第 7 章：CONDITIONAL PASS 条件清单

| # | 条件 | Owner | 承接资产 | 最迟关闭节点 | 未关闭后果（停止规则） |
| --- | --- | --- | --- | --- | --- |
| C1 | Milestone B Development Package 完成并经创始人批准 | CTO | Dev Package | Codex 正式开发启动前 | 未批准前 Codex 不得开始任何正式开发提交 |
| C2 | **正式 Windows Provider 仓库初始化**（方向已裁定为重建，RC1）；未来找回旧仓库只作参考事实更新，不重开本条件 | 创始人授权，CTO / Milestone Owner 执行 | Milestone B Development Package + 仓库初始化任务 | WS-2 编码启动前 | WS-2 不得开始编码；其余 WS 不受影响 |
| C3 | ADR-01（IPC/安全/序列化）、ADR-02（注册握手）、ADR-03（打包/守护）关闭 | CTO | ADR 组 | Windows Provider WS 前 | WS-2 不得进入对应实现任务 |
| C4 | ADR-05（持久化选型）关闭 | CTO | ADR 组 | HRT Logic Core 持久化实现任务前 | 该任务暂停，接口层工作可继续 |
| C5 | ADR-06（feature gate / 切换闸门机制）关闭 | CTO | ADR 组 | Legacy 切换 WS / 首次试点前 | 任何 Legacy 切换不得执行 |
| C6 | 工程事实核查（工作区与未跟踪项、CI/build/test 现状、驱动/秘密/安装包与环境依赖清单）完成。明确（RC1）：**C6 不阻塞本 Gate 自身 FINAL FROZEN，但阻塞 Dev Package 定稿**；Codex 只能只读核查，核查结果作为 Dev Package 工程输入；**不得顺手清理工作区、修改 CI 或安装依赖** | Codex（只读）+ Verifier | Dev Package 前置核查任务 | Dev Package 定稿前 | Dev Package 不得定稿；Gate 冻结不受影响 |
| C7 | 真机验收记录模板固化 | CTO | Dev Package 验收章节 | 首个真机验证点前 | 真机验证不得开始记账 |
| C8 | Legacy Execution Record 承接内容成文 | CTO | Dev Package（或其打印迁移章节） | 打印切换 WS 前 | 打印试点替换不得切换 |
| C9 | Vault 归档收尾（RC1 按真实状态拆分）：REG **已归档，本项关闭**；ES-HRT-001 待补归档（本地三份文件已备）；ES-CONST-001 / ES-STRAT-001 归档状态核实后处置（已归档即关闭）；本 Gate 冻结后归档 | CTO | 归档/核实任务 | Architecture Complete 前 | 不阻塞开发与 Gate 冻结；知识库断链风险持续 |
| C10 | LEG-DSP-001 SV-05B/05C 复验与门店启用事实 | 创始人 + Verifier | REG 运行事实更新 | 客显试点切换前 | 客显切换判定缺乏基线对照 |

# 第 8 章：Workstream 启动边界

| Workstream | 内容 | 当前边界 |
| --- | --- | --- |
| WS-0 治理与文档 | Dev Package、ADR-01…06、三份 Adapter Spec 起草、工程事实核查（只读） | **可立即开始** |
| WS-1 HRT Logic Core | HRT API 内部 Contract、Command Router、Device Registry（三分模型 + 三状态机）、Health Engine、Policy、Audit Emitter、测试挂具 | **Dev Package 批准后可开始**（持久化实现任务待 ADR-05） |
| WS-2 Windows Provider（重建正式仓库，继承 EHA 冻结角色） | Provider 进程、Provider Contract 服务端、三类 Adapter 执行体 | **阻塞**：待 C2（正式仓库初始化）+ C3（ADR-01/02/03）+ C1 中 WS-2 定义 |
| WS-3 Printer 链路 | Printer Adapter、C1/C2 真机验证、试点替换 | Contract/Spec/DR 侧可随 WS-1；执行段待 WS-2；切换待 C5+C8 |
| WS-4 Scanner 事件链 | Scanner 事件链、设备级识别、双听验证 | 同上；业务消费源切换按 REG 5.8 判据 |
| WS-5 Customer Display 链路 | Display Adapter、Snapshot 执行、试点替换 | 同上；切换前需 C10 |
| WS-6 Legacy 切换与退役 | 闸门、双跑纪律执行、HMF 迁移/封存、（若确认存在）EHA 旧 API 关闭 | 待 ADR-06 + 对应链路 MIGRATION_READY |
| WS-7 macOS Provider | 起步形态实现 | 后置；待 ADR-04 |

# 第 9 章：最终 Gate 结论

## **CONDITIONAL PASS**

- **当前版本统计的 A 类架构硬条件全部 PASS**（具体数量为检查表运行统计，不属于不可变架构裁定），**0 项架构阻塞**；
- 全局硬阻塞：**0 项**；
- Workstream 级阻塞：**1 项**（WS-2——EHA 路线已裁定重建，待正式仓库初始化与 ADR-01…03 关闭）；
- Conditional 条件：**10 项**（C1–C10，均有 Owner、承接资产、最迟关闭节点与停止规则；C9 中 REG 部分已关闭）；
- **可立即开始**：WS-0（Dev Package、ADR、Adapter Spec 起草、只读工程核查）；
- **不得开始**：任何 Codex 正式开发（待 C1）；WS-2 编码（待 C2/C3）；任何 Legacy 切换（待 C5/C8）。

本结论不构成对任何冻结架构的修改；条件全部关闭前，Milestone B 不得宣布 Architecture Complete。

# 第 10 章：冻结边界

本 Gate 冻结（待 FINAL FROZEN 后生效）：三类 Gate 条件分类法与状态枚举（第 3 章）；十二检查域结构（第 4 章）；**当前 A 类架构硬条件全部 PASS 与 0 项全局架构硬阻塞的判定**；总结论 CONDITIONAL PASS；EHA 路线裁定（停止搜索、重建正式仓库、旧仓库仅为受控参考）与 Windows Provider Workstream 停止规则（第 6 章）；C1–C10 条件清单及停止规则（第 7 章）；Workstream 启动边界（第 8 章）；Dev Package 是 Codex 正式开发前硬条件（Domain 12）。

本 Gate 不冻结：**检查项的永久数量**（运行统计，随 supersede 版本可变）；条件关闭后的运行状态（按证据更新并留痕，不构成修订）；ADR 的技术结论；Dev Package 内容；具体成功率/UNKNOWN 率/观察天数等真机指标数值（由 Dev Package / Adapter Spec 定义，不得由 Codex 自行决定）；工程核查结果。

---
---

# 随文提交材料（非 Gate 正文）

## 随文材料 1：评审发现

1. **本 Gate 最大的价值是把"EHA 未来角色已冻结"与"EHA 工程当前不存在证据"分开**——若混淆，要么错误全局阻塞（过度保守），要么让 Codex 对着不存在的仓库开发（虚构事实）。（RC1 更新：创始人已正式裁定停止搜索、重建正式仓库，方向未决关闭；WS-2 阻塞转化为明确的仓库初始化 + ADR 关闭条件。）
2. **10 项 Conditional 中只有 C1、C2 具有里程碑分量**，其余为正常工程秩序项；评审时应确认未把 C 类真机验证事项误升为阻塞（本稿已核对：崩溃恢复演练、C1/C2 可达性、回退演练、SV-05B/C 复验均为 C 类）。
3. **全部 A 类 PASS 项均有上位文件章节级证据**，无一项引用"常识"或未成文共识；若评审发现任何一项证据不实，该项应改判并重新评估总结论。（RC1 更新：具体条目数量为运行统计，不作为冻结数字。）
4. 工程侧三项 FACT VERIFICATION REQUIRED（ENG-05/07/10）刻意未假设——文档冻结不等于仓库整洁。

## 随文材料 2：创始人拍板事项（RC1 更新）

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | EHA 工程路径 | **已裁定（RC1）**：停止搜索旧仓库；WS-2 前重建正式 E-Shop Windows Hardware Provider 仓库，继承 HRT 14.7 冻结角色；旧仓库若找回仅为受控参考资产（可审计、选择性迁移，不覆盖新仓库、不反向改变冻结架构）；不设日历搜索宽限期（EHA-01B 架构包资产作为设计输入而非代码基） |
| 2 | Dev Package 批准方式 | 待拍板。建议：创始人一次性批准整包（沿用"完整执行授权"惯例），不做逐批审批 |
| 3 | 本 Gate 的条件关闭记账人 | 待拍板。建议：CTO 维护条件状态，C1/C2 关闭须创始人确认 |

## 随文材料 3：FINAL FROZEN 前检查清单

- [ ] A 类 PASS 项证据抽查无误（至少抽查每域一项；数量为运行统计）
- [x] EHA 路线裁定完成：停止搜索、重建正式仓库（RC1）
- [ ] C1–C10 的 Owner 与节点获确认（C2 已按 RC1 更新；C9 中 REG 部分已关闭）
- [ ] 拍板事项 2–3 关闭
- [ ] ES-CONST-001 / ES-STRAT-001 Vault 归档状态核实（已归档即关闭 C9 对应部分）
- [ ] 创始人确认 RC1 正文并宣布 FINAL FROZEN（本文件不自行宣布）
- [ ] 本 Gate 冻结后归档；ES-HRT-001 三份文件补归档

## 随文材料 4：下一步资产顺序

1. **Milestone B Development Package**（C1，Codex 开发前硬条件；含工程事实核查前置任务、验收模板、Legacy Execution Record 承接、真机指标数值）；
2. **ADR-01…06** 按 Workstream 节奏关闭（ADR-01/02/03 优先，服务 WS-2 解锁）；
3. Codex 正式开发（Dev Package 批准后）；
4. 三份 Adapter Spec 随对应 Workstream 进入；
5. 真机验收（含 Provider 崩溃恢复与 Legacy 回退演练）；
6. Milestone B Architecture Complete / Final Freeze。

---

# 文末必答八问

**1. Milestone B 当前 Gate 总结论是什么？**
**CONDITIONAL PASS**——架构硬条件全部满足，存在 10 项已明确承接的实施条件与 1 项 Workstream 级阻塞。

**2. 哪些架构硬条件已经满足？**
当前版本统计的 A 类架构硬条件全部 PASS（具体数量为检查表运行统计，不属于不可变架构裁定）：四份上位资产冻结、范围关闭、方案 C 边界、控制面归一、三类 Contract 可开发、身份与五项真源归属、六值 Outcome/双模型/边界/Resolution、事件与快照模型、Legacy 治理规则、EHA 工程路径方向（RC1 裁定重建）——逐项见第 4 章检查表。

**3. 是否仍存在全局开工阻塞？**
否。全局硬阻塞 0 项。

**4. 哪些 Workstream 可以立即准备或启动？**
WS-0（Dev Package、ADR、Adapter Spec 起草、只读工程核查）可立即开始；WS-1（HRT Logic Core）在 Dev Package 批准后即可启动；WS-3/4/5 的 Contract 测试与 DR 侧接入部分随 WS-1。

**5. 哪些 Workstream 仍被阻塞？**
WS-2（Windows Provider 实现）——EHA 路线已裁定重建，待正式仓库初始化（C2）、ADR-01/02/03（C3）与 Dev Package 中 WS-2 定义（C1）；WS-3/4/5 的设备执行段连带等待 WS-2；一切 Legacy 切换等待 C5/C8。

**6. 开工前必须完成哪些 ADR？**
作为总体开工阻塞的 ADR：**0 份**。6 份必要 ADR（ADR-01 IPC/安全/序列化、ADR-02 注册握手、ADR-03 打包/升级/守护、ADR-04 macOS 起步与外迁、ADR-05 持久化、ADR-06 切换闸门）全部为"对应 Workstream 前"关闭。

**7. Milestone B Development Package 是否是 Codex 正式开发前的硬条件？**
是（MB-GATE-DP-01 判定）。未经创始人批准的 Dev Package，Codex 不得开始任何正式开发提交；且真机指标数值必须由 Dev Package / Adapter Spec 定义，不得由 Codex 自行决定。

**8. 下一步由谁做什么？**
创始人：确认本 Gate RC1 正文并宣布 FINAL FROZEN、拍板事项 2–3；CTO：起草 Milestone B Development Package（C1）、并行起草 ADR-01…03、核实 CONST/STRAT 归档状态；CTO / Milestone Owner：执行正式 Windows Provider 仓库初始化（C2，创始人已授权）；Codex：执行只读工程事实核查（C6——不修改文件、不清理工作区、不改 CI、不装依赖）；Verifier：核验核查结论。

---

# 《ES-MB-GATE-001 V1.0-RC1 修订记录》

| 序号 | 修改位置 | RC1 修订 | 影响上位冻结文件 |
| --- | --- | --- | --- |
| 1 | ENG-02a/02b、6.2、C2、WS-2 边界、随文 2、八问 | EHA 路线由"寻找或重建"正式收敛为**停止搜索、授权重建正式仓库**（创始人裁定）：新仓库继承 HRT 14.7 冻结角色；旧仓库若找回仅为受控参考资产；不设日历宽限期；方向未决关闭但 WS-2 编码仍待仓库初始化 + ADR-01…03 + Dev Package WS-2 定义 | 否 |
| 2 | UP-05a…05d、C9、检查清单 | Vault 状态按每份资产真实证据拆分：REG **已真实归档**（含 RC2 候选与 Freeze Record）→ PASS；ES-HRT-001 待补归档（本会话证据）→ CONDITIONAL；CONST/STRAT 归档状态无证据 → FACT VERIFICATION REQUIRED，不得猜测；本 Gate 自身未归档属正常，不计缺口 | 否 |
| 3 | 第 5、9、10 章、随文 1、八问 Q2 | "68 项"降为**检查表运行统计**：冻结的是"当前 A 类架构硬条件全部 PASS + 0 项全局架构硬阻塞 + CONDITIONAL PASS + 条件/Owner/节点/停止规则"，不冻结检查项永久数量 | 否 |
| 4 | 第 7 章 C2 | C2 调整为**正式 Windows Provider 仓库初始化**条件（创始人授权，CTO / Milestone Owner 执行；WS-2 编码启动前；未关闭则 WS-2 不得编码）；找回旧仓库仅作参考事实更新，不重开 C2 | 否 |
| 5 | 第 7 章 C6 | C6 明确：**不阻塞本 Gate 自身 FINAL FROZEN，但阻塞 Dev Package 定稿**；Codex 只读核查，结果作为 Dev Package 工程输入；禁止顺手清理工作区、修改 CI 或安装依赖 | 否 |

---

*ES-MB-GATE-001 · Milestone B Architecture Entry Gate · V1.0-RC1 · FINAL FREEZE CANDIDATE · 2026-07-14*
*上位文件：ES-CONST-001 / ES-STRAT-001 / ES-HRT-001 / ES-LEGACY-REGISTER-001（均 FINAL FROZEN）*
*Gate 总结论：CONDITIONAL PASS（全局架构硬阻塞 0；Windows Provider Workstream 阻塞 1；条件 10 项）·下一份资产：Milestone B Development Package*