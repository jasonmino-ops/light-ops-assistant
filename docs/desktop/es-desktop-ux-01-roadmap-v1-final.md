# ES-DESKTOP-UX-01 — Implementation Roadmap V1.0 FINAL

```
ROADMAP STATUS               = FINAL
ROADMAP FROZEN               = YES
Implementation Authorization = NO

No phase may start from this document alone.
```

> 冻结日期：2026-09-14　·　裁定人：Founder
> 受治文档：`es-desktop-ux-01-blueprint-v1-final.md`（唯一设计基线）
> 配套文档：`es-desktop-ux-01-freeze-record.md`

---

## 1. Roadmap Purpose

把已冻结的 Blueprint 转成施工顺序图，使每一步范围小、风险可控、可独立验收、未过 Gate 不进入下一阶段。

**本文件不是授权。** 每个 Phase 开工仍需各自的 Founder Gate 与治理授权。

---

## 2. Governing Blueprint

**ES-DESKTOP-UX-01 Development Blueprint V1.0 FINAL** 是唯一设计基线。

本 Roadmap **不新增能力、不重新设计产品、不重开已冻结架构问题**。冲突时以 Blueprint 为准并 STOP。

---

## 3. Phase Dependency Graph

```
P0 治理就绪
 │
 ├─→ P1A 自动全屏 ─→ P1B 显示器分配 ─→ P2 营业页减法
 │                                        │
 │                                        ▼
 │                              P3-B Desktop 试点
 │                                        │
 │                          Founder: Pilot Evidence Sufficient = YES
 │                                        │
 │                                        ▼
 │                              P4-1 Operator Lock & Local PIN
 │                                        │
 │                                        ▼
 │                              P4-2 OWNER Single-action Approval
 │                                        │
 │        ┌──────────────┬────────────────┼──────────────┐
 │        ▼              ▼                ▼              ▼
 │   P5 管理中心      P6A 设置        P6B 系统状态    P7 技术支持
 │                                        │
 │                                        ▼
 │                                   P6C 打印状态整合
 │                                        ▲
 │                                        └─ 外部前置：Contract producer
 │                                           （打印侧独立任务）
 │
 └─→ 【P3-A 业务试点】现有 Browser + RC9 栈　← 不依赖任何 Desktop Phase

                    P8A / P8B / P8C 视觉重做（最后）
```

**默认执行为串行**（见第 17 节）。图中的分支只表示依赖关系，不表示可同时施工。

### 跨 Phase 依赖结论

**Operator Lock 依赖：** 4-0 审计五项结论 + P1A/P1B 稳定 + P3-B 的足够观察（非穷尽观察）。

**Cashier 减法是否等 Operator：** 不必，但默认串行策略下仍排在 P1B 之后。

**Management Center 是否等 Pilot：** 必须。

**System Status 是否依赖 Contract：** Runtime 部分（P6B）不依赖；打印部分（P6C）完全依赖。

**Visual 应等什么：** P1A/P1B（窗口行为定型）、P2（入口定型）、P5/P6（页面存在）。

**0.4.7 / Restaurant / Offline Printing：** 均不进入本 Roadmap（第 16 节）。

---

## 4. Phase 0 — Governance Readiness

**Goal** 只确认是否具备安全开工条件。**不做任何产品代码改动。**

**Why Now** 谱系不清晰时开工，后续每个 Phase 的验收基线都不可信。

**Preconditions** 无。

**IN SCOPE** 确认 `origin/main` / `origin/release` / Production SHA · 运行 Release Lineage Gate · 确认干净工作树可得 · 确认 Scope Guard 与 Protected Paths 现状 · 确认现有 FIELD evidence 清单 · **确认 Browser fallback 基线在目标机器上真实可用** · 引用 Blueprint FINAL 版本 · 确认发布纪律（release 只 fast-forward）。

**OUT OF SCOPE** 任何代码 · 任何 UI · 任何 schema · 任何 Phase 1 的准备性改动。

**Layers Touched** 无（只读 + 治理记录）。

**Protected Areas** 不适用。

**Governance Gate** Founder 确认治理状态。**若需移动 release 分支，属独立的破坏性操作授权，不在本 Phase 自动包含。**

**Tests** 仅只读校验。　**Independent Review** 不需要。　**FIELD** 不需要。

**Exit Criteria**
```
Production ancestor of origin/main = YES
Safe Development Base              = YES
Release Lineage RESULT             = PASS
干净 worktree 可得
Blueprint FINAL 已被引用为基线
Browser fallback 已在目标机器实测可用并记录
```

**STOP Conditions** 谱系仍 BLOCKED · 工作树无法达到 CLEAN · Browser fallback 无法验证。

**Dependencies** 无。
**Technical Parallelism** 与 P3-A 业务试点不冲突。
**Must Not Run In Parallel With** 任何写操作 Phase。

---

## 5. Phase 1A — Fullscreen Foundation

**Goal** 员工营业窗口在激活授权完成后自动进入原生全屏，且全屏状态不污染普通窗口尺寸持久化。

**Why Now** 改动最小、商户可感知、**零 Web 改动、零 Scope Guard 触碰**。同时首次验证 `desktop/` 的交付链路（构建 → 装机 → 冷启动）。

**Preconditions** P0 Exit 全绿 · **目标机器上 Browser fallback 已实测可用**。

**IN SCOPE** 授权完成后触发全屏 · `saveEmployeeState` 在全屏态早退 · 技术支持模式下可临时关闭自动全屏。

**OUT OF SCOPE** 显示器分配 · 互换 · debounce · 任何 Web 改动 · kiosk 化 · **任何 RC9 / Printing Core 改动**。

**Layers Touched** Electron only（`desktop/src/main/`）。Web / API / DB / Printing / Cloud：**无**。

**Protected Areas** 无 forbidden path。须遵守 Electron 安全静态测试。

**Governance Gate** 常规开工授权，**无需 Scope exception**。

**Tests** typecheck · vitest 全量（已知失败须显式清单化校准，不得以「与本次无关」代替）· 安全静态测试必须 PASS。

**Independent Review** 需要（新上下文，只读）。

**FIELD** **必须。** 真机冷启动：整机关机 → 开机 → 不碰设置 → 营业窗口自动全屏；退出全屏后窗口尺寸正常。

**Exit Criteria**
- 冷启动自动全屏成立
- 退出全屏尺寸正确
- 技术支持可关闭自动全屏
- **打印回归证据：过程中至少一笔真实订单双票正常**

> **⚠ 打印回归的性质：** 上述打印项是 **Regression Evidence**，用于证明 Desktop 环境层改动没有破坏已 FIELD VERIFIED 的打印路径。**它不是 P1A 对 Printing Runtime 的所有权。**
>
> 若 FIELD 中出现打印异常：**第一动作是 STOP 并判断因果**。
> 有明确因果 → 当前 Phase BLOCKED，**只修本 Phase 引入的问题**。
> 无证据证明相关 → 记录为独立 Printing issue，**不得在本 Phase 内修改 RC9 / Printing Core**。

**STOP Conditions** 全屏导致窗口状态异常且修法需触碰 Web · 安全静态测试无法通过 · 出现与本 Phase 有因果关系的打印异常 · 需要修改任何打印侧代码。

**现场回退路径（必须在 FIELD 前就位）** 装回上一版 Desktop；期间店员改用 Browser 路径继续营业。

**Dependencies** P0。
**Technical Parallelism** 与 P2 不冲突（不同层）。
**Default Execution** **串行：P1A 必须先于 P1B 与 P2 完成并 FIELD PASS。**
**Must Not Run In Parallel With** P1B（同文件）· 任何打印链改动。

---

## 6. Phase 1B — Display Assignment & Swap

**Goal** 显示器角色分配持久化、互换屏幕、冷启动恢复、匹配失败优雅回退、`display-added` 去抖。

**Why Now** 双屏是门店真实形态，也是 Desktop 相对 Browser 唯一不可替代的环境价值。

**Preconditions** **P1A Exit 全绿且 FIELD PASS**（全屏行为已被真机确认，不再是推断）· 目标机器 Browser fallback 可用。

**IN SCOPE** 分配持久化文件（含 raw fields）· 弱信号打分 + 阈值 + 消歧 · `DISPLAY_LAYOUT_GET` / `DISPLAY_SWAP` 两条 IPC · 互换复用现有「销毁顾客窗口 → 重建 → replay」路径 · `display-added` 去抖 · `assignmentSource` 进健康快照 · 非阻断提示。

**OUT OF SCOPE** kiosk 化 · 顾客屏 Web 页面任何改动 · 历史布局库 / 多候选回溯（Complexity Ceiling）· 自动保存观察到的拓扑 · **任何 RC9 / Printing Core 改动**。

**Layers Touched** Electron only。Web / API / DB / Printing / Cloud：**无**。

**Protected Areas** `app/desktop/display/page.tsx` 是 forbidden path——**必须完全不碰**。新 IPC 通道须同步进白名单表、preload 硬编码字符串与静态断言。

**Governance Gate** 常规开工授权，**无需 Scope exception**（前提是确实不碰 Web）。

**Tests** typecheck · vitest · 新增分配匹配测试（匹配成功 / 失败回退 / 互换后持久化 / 文件损坏）· 安全与白名单静态测试。

**Independent Review** 需要。

**FIELD** **必须。** 冷启动两屏各就各位 · 互换后关机重开仍正确 · 拔副屏不崩不阻断 · 重插自动回位 · 分配文件损坏时静默回退 · 单屏时不提示。

**Exit Criteria** 上述六项真机通过 · 提示为非阻断且非原生对话框 · **打印回归证据（性质同 P1A，见上方 ⚠ 条款）**。

**STOP Conditions** 必须修改 `app/desktop/display/page.tsx` · 匹配算法开始需要第二套恢复机制（撞 Complexity Ceiling）· 顾客屏同步回归 · 出现与本 Phase 有因果关系的打印异常。

**现场回退路径** 装回 P1A 版本（保留自动全屏，失去分配与互换）；期间店员改用 Browser 路径。

**Dependencies** P0 → P1A。
**Technical Parallelism** 与 P2 不冲突。
**Default Execution** **串行：P1B FIELD PASS 后才进入 P2。**
**Must Not Run In Parallel With** P1A · 任何打印链改动 · 任何顾客屏 Web 改动。

---

## 7. Phase 2 — Cashier Minimal Simplification

**Goal** 只做营业页减法，让 Desktop 下的营业页不再显示壳无关控件。

**Why Now** 纯条件渲染，风险极低，却直接决定试点首日的第一印象。

**Preconditions** **P1B Exit 全绿且 FIELD PASS**（默认串行策略）。

**IN SCOPE** Desktop 下隐藏「安装到电脑」· Desktop 下隐藏「打开顾客屏」· 收起商品缓存明细等技术信息 · 顶部保留语言 / 管理中心入口 / 退出全屏 · 保留全部高频营业能力与离线状态显示。

**OUT OF SCOPE** checkout state machine · payment handlers · cart 逻辑 · offline 逻辑 · customer order 逻辑 · **任何视觉改动（那是 P8A）** · 任何组件抽离 · 把「优惠」改成可交互 · 任何 `app/api/cashier/*` 改动。

**Layers Touched** Web UI only。Electron / API / DB / Printing / Cloud：**无**。

**Protected Areas** **`app/cashier/page.tsx` 是 Scope Guard forbidden path。** 本 Roadmap 中第一个触碰它的 Phase。

**Governance Gate** **需要 Scope exception（内容哈希绑定）+ Founder Gate。** 建议同时评估是否先做 Scope Guard 分层，否则后续每次 UI 迭代都要重登记。

**Tests** build · Browser 回归（`/cashier` 主链：扫码 / 加购 / 挂单恢复 / CASH / KHQR / 会员余额 / 离线开单与同步）· Desktop 冒烟。

**Independent Review** **必须**（触碰受保护主链路）。

**FIELD** 不强制完整 FIELD，但需 Desktop 与 Browser 各一次真机冒烟，**证明两条路径都没坏**。

**Exit Criteria** Desktop 下三项已隐藏 · **Browser 下「打开顾客屏」仍然存在且可用** · 收银主链 Browser 回归全绿 · 离线状态与待同步计数仍可见 · 视觉与改动前一致（本 Phase 不做视觉）。

**STOP Conditions** 任何隐藏动作牵连到业务逻辑 · Browser 顾客屏路径受影响 · 需要改动 `app/api/cashier/*` · 出现「顺便调一下样式」。

**现场回退路径** 恢复条件渲染（纯前端回滚）；Browser 路径全程不受影响。

**Dependencies** P0 → P1A → P1B。
**Technical Parallelism** 与 P1A / P1B 不冲突（不同层）。
**Default Execution** **串行。并行需 Founder 显式批准。**
**Must Not Run In Parallel With** 任何其他 `app/cashier/page.tsx` 改动 · P4-1 · P4-2 · P8A。

---

## 8. Phase 3 — First Store Pilot

### P3-A 业务试点（现有 Browser + RC9 栈）—— 不依赖本 Roadmap

**冻结：商业上线不得被 Desktop 重构绑架。**

现有 Browser 路径与 RC9 打印已 FIELD VERIFIED（rc.8 冷启动、rc.9 FRONT/KITCHEN 双端点、真实订单双票）。**第一家店的开张不等待任何 Desktop Phase。**

它对本 Roadmap 的价值：产出真实经营数据与使用观察，喂给 P4-1 / P4-2 与 P5，并作为 P3-B 的对照基线。

### P3-B Desktop 试点

**Goal** 在真实门店验证 Desktop 形态是否可用。

**Why Now** P1A + P1B + P2 之后，Desktop 首次具备「自动全屏 + 双屏就位 + 干净营业页」——这是它第一次比 Browser 更好用。再加东西之前，先看真人怎么用。

**Preconditions** P1A / P1B / P2 Exit 全绿 · P3-A 已在该店运行并有基线 · **Browser 入口在该机器上随时可达且已实测**。

**IN SCOPE** 观察与记录，**不做开发**。

**OUT OF SCOPE** 任何代码改动（缺陷进入待修清单，不当场改）· Operator PIN（本阶段走 legacy 路径）· 任何其他 Phase 的合并上线。

**Layers Touched** 无。

**Governance Gate** Founder 决定试点门店与起止 · **Founder 宣告 `Pilot Evidence Sufficient`**（见 Exit）。

**FIELD** 本 Phase 即 FIELD。

**Exit Criteria**

不追求统计学完备。只需**完成一轮足够支撑最小 Operator 设计的真实观察**，至少得到：

```
实际操作人数
是否存在换班 / 切换操作人
老板本人是否收银
哪些敏感动作真实发生
老板临时批准场景的实际频率
```

加上：第 19 节观察清单已收满 · 无未定性的阻断级缺陷。

**Founder 有权据现场证据宣告 `Pilot Evidence Sufficient = YES`，随即开启 P4-1 / 4-0 Audit。不得以「还想再多观察一点」无限延后。**

**STOP Conditions** 出现阻断收银的缺陷 → **立即回退 Browser 路径** · 试点期间有其他 Phase 上线导致观察无法归因。

**现场回退路径** Browser 入口全程保持可达；回退无需卸载 Desktop，只需改用浏览器打开收银台。

**⚠ 数据读法警告** 试点期间 Operator Lock 未上线，走 legacy device fallback，**`operatorUserId` 全部指向门店 OWNER**（Blueprint C16）。**试点数据不得用于营业员归属、人效或班次分析。**

**Dependencies** P1A · P1B · P2。
**Must Not Run In Parallel With** 任何 Phase 的合并上线。

---

## 9. Phase 4-1 — Operator Lock & Local PIN

**Goal** 解决【现在是谁在操作】。

**Why Now** 试点已回答「几个人、换不换班、老板收不收银、敏感动作真实频次」——这些正是 PIN 设计的输入。

**Preconditions** `Pilot Evidence Sufficient = YES`（Founder 宣告）· **4-0 Pre-Development Audit / Design Gate 通过** · **Emergency Bypass 已就位并演练**。

### 4-0 Pre-Development Audit / Design Gate（强制前置）

未结论不得进入实现：

| 审计项 | 必须回答 |
|---|---|
| 持久化最小结构 | 满足 Blueprint 四项要求的最小形态；**是否需要新 schema** |
| PIN enrollment | 复用哪种现有身份确认形态；OWNER 签发还是员工自设 |
| 服务端验证 | 验证端点形态；`user.status` 失效链路是否覆盖离职场景 |
| Legacy 共存边界 | 新路径与 device fallback 如何共存；何种条件才允许关闭旧路径 |
| Refund 真实权限 | `/refund` 当前 STAFF 是否可用；移入「需 OWNER 批准」是新增保护还是收紧 |
| Operator attribution | `operatorUserId` 的写入点与回填策略 |

**若结论为「必须新增 schema」→ 触发 P4-1 内的独立 Founder Gate，不得自动授权。**

**Audit 的输入是 Pilot 的真人行为，输出是结合真实代码的设计收口。Pilot 只提供场景与频次，不负责给出技术结论。**

**IN SCOPE** Operator Lock · OWNER / STAFF 操作人选择（按门店 `UserStoreRole`）· 6 位本机营业 PIN · PIN 失败锁定 · Lock · Switch Operator · OWNER Operator 状态 · STAFF Operator 状态 · operator attribution 基础正确性 · **锁屏后未完成交易的切换语义设计与验证** · **Emergency Bypass**。

**OUT OF SCOPE** OWNER 单次敏感动作授权（P4-2）· `authorizedByUserId` 全量接入（P4-2）· 复杂权限调整 · 时间窗授权 · **关闭 legacy device fallback** · 离线 PIN credential cache · 手机端 PIN 管理 · Browser PIN · ACL / Policy Engine · 新角色 · session/auth 重构 · 任何视觉重做。

**Layers Touched** Electron · Web UI · API · **DB（可能，需独立 Gate）**。Printing / Cloud：无。

**Protected Areas** `app/api/cashier/*` 与 `prisma/schema.prisma` 均为 forbidden path。

**Governance Gate** Scope exception + Founder Gate；**若涉及 schema，另加独立 migration Gate**。

**Tests** 单元（PIN 校验 / 锁定 / 切换）· Browser 回归（**确认 Browser 无 PIN 门槛且业务照常**）· Desktop 冒烟。

**Independent Review** **必须**（身份与权限）。

**FIELD** **必须。** 冷启动到锁屏 → 选人 + PIN → 营业 · 锁定后 Runtime / 打印 / 顾客屏不中断 · 切换营业员 · 失败锁定生效 · Emergency Bypass 可用且有清晰状态提示。

**Exit Criteria** 上述真机项全通过 · `operatorUserId` 写入正确 · **Browser 路径未被削弱** · legacy fallback 仍在（本 Phase 不关闭）。

> **P4-1 FIELD 通过后，新的 operator attribution 才可以开始被视为真实营业员归属。**

**STOP Conditions** 审计结论要求改 `User` 模型或 session · 出现第二套用户体系倾向 · Browser 被要求实现 PIN · 出现「顺手补一个 API / 加一个字段」。

### Operator Lock Emergency Bypass（冻结）

> **P4-1 上线时不得依赖尚未完成的 P7 Technical Support Mode 才能回退。P4-1 必须自带 Emergency Bypass。**

**用途仅限：** Operator Lock 自身故障导致门店无法开始营业时，临时回到 legacy 可工作路径。

**必须：** 本机触发 · 明确受控 · 临时 · 有清晰状态提示。

**不得：** 改变业务角色 · 获得 OWNER 管理权限 · 获得 Technical Support 全功能 · 绕过现有业务权限 · 成为长期正常营业模式。

**它只解决：【Lock 坏了，今天还能继续卖。】**

P7 完成后可把该 bypass 纳入完整 Technical Support UX，但 P4-1 自身不得依赖 P7。

**现场回退路径（必须在 FIELD 前就位并演练）** 三级：① Emergency Bypass；② 装回 P2 版本 Desktop（legacy 路径仍在）；③ 改用 Browser。**三条必须在真机上演练过。**

**Dependencies** P3-B → 4-0 Audit Gate。
**Must Not Run In Parallel With** P2 / P4-2 / P8A（同碰 cashier）· P5（都改导航与权限显隐）。

---

## 10. Phase 4-2 — OWNER Single-action Approval & Attribution

**Goal** 解决【谁批准了敏感动作】。

**Preconditions** P4-1 Exit 全绿且 FIELD PASS。

**IN SCOPE** STAFF 状态下 OWNER PIN 单次批准 · `operatorUserId` 保持 STAFF · `authorizedByUserId = OWNER` · 退款等真实敏感动作的权限映射 · approval attribution 的 FIELD 验证。

**OUT OF SCOPE** 时间窗授权 · ACL / Policy Engine · 动态 Scope Token · 关闭 legacy device fallback · 新角色 · 任何视觉重做。

**Layers Touched** Web UI · API · Electron（授权弹层承载）。DB：原则上无（字段已存在）。

**Protected Areas** `app/api/cashier/*` 为 forbidden path。

**Governance Gate** **独立 Gate**（不与 P4-1 合并）+ Scope exception。

**Tests** 单元（授权记录正确性）· Browser 回归 · Desktop 冒烟。

**Independent Review** **独立 Review**（不与 P4-1 合并）。

**FIELD** **独立 FIELD。** OWNER PIN 单次授权后 operator 仍为 STAFF · `authorizedByUserId` 正确写入 · 授权即用即销、不改变当前 Session。

**Exit Criteria** 上述真机项全通过 · 单次授权语义成立 · Browser 未被削弱。

> **P4-2 FIELD 通过后，approval attribution 才可以被视为可信。**
>
> **若 P4-2 复杂，不得阻挡已经完成的 P4-1 真实营业员身份能力。**

**STOP Conditions** 授权模型开始出现时间窗 / scope · 需要新增 schema · 需要改后端权限模型。

**现场回退路径** 移除授权入口，退回 P4-1 状态（敏感动作改为 OWNER 本人登录执行）。

**Dependencies** P4-1。
**Must Not Run In Parallel With** P2 / P4-1 / P8A · P5。

---

## 11. Phase 5 — Management Center V1

**Goal** 只重组已有能力入口，形成五组管理中心外壳。

**Preconditions** P3-B Exit 全绿 · 试点中「入口发现性 / 高频动作 / 零点击入口」已归纳。

**IN SCOPE** 新路由外壳（营业 / 商品与数据 / 会员 / 门店 / 系统）· 复用现有页面与 API 接入 · 按 `effectiveRole` 显隐（**同时确认后端真实拦截存在**）· 配置项做跳转入口不做第二实现 · 营业页新增管理中心入口。

**OUT OF SCOPE** 重写任何老板后台页面 · 版式适配 · Dashboard · 会员营销 / 券 / CRM · 钱柜 · TikTok Desktop 实现 · Electronic Menu · **新建任何 API** · 任何视觉重做。

**Layers Touched** Web UI only（新路由）。Electron / API / DB / Printing：**无**。

**Protected Areas** 新路由不在 forbidden path 内。**严禁 import `app/cashier/page.tsx` 内部实现。**

**Governance Gate** 常规授权。**若需新建 API 即触发 STOP，不得顺手建。**

**Tests** build · Browser 回归（管理中心在 Browser 可用且由 OWNER session 授权）· 权限用例（STAFF 看不到 OWNER 项，且后端确实拒绝）。

**Independent Review** 需要。　**FIELD** 不强制；Desktop + Browser 各一次冒烟。

**Exit Criteria** 五组外壳可用 · **Browser 与 Desktop 功能等价** · STAFF 视图受真实后端约束 · **零新建 API** · 零 cashier 内部引用。

**STOP Conditions** 某功能无法通过已有 page / lib / API 接入 → **报告未就绪，不新建 API** · 需要 import cashier internals · 需要改后端权限。

**现场回退路径** 移除入口（新路由，纯加法回滚）。

**Dependencies** P3-B。
**Must Not Run In Parallel With** P4-1 / P4-2。

---

## 12. Phase 6A — Settings

**Goal** 把配置收敛到设置，作为配置的**唯一实现位置**。

**Preconditions** P5 Exit 全绿（跳转目标需存在）。

**IN SCOPE** 门店（门店信息 / 收款设置 / 语言 / 桌号二维码入口）· 设备（打印设备 / 显示器设置（Desktop-only）/ 自动打印）· 系统（Desktop 偏好 / 关于店小二）· **澄清 Blueprint C3（「自动打印」是浏览器打印，与网络打印无关）与 C4（语言三来源）的措辞与语义**。

**OUT OF SCOPE** 系统状态面板（P6B）· 打印状态（P6C）· 桌台管理（Non-Goal，只放二维码入口）· 技术支持入口 · 新增任何配置项 · 任何视觉重做。

**Layers Touched** Web UI only。　**Protected Areas** 无 forbidden path。
**Governance Gate** 常规授权。　**Tests** build · Browser 回归（显示器设置在 Browser 整块不渲染）。
**Independent Review** 建议。　**FIELD** 不强制。

**Exit Criteria** 配置唯一实现位置成立 · Browser 下环境面板不渲染（非灰显）· C3 / C4 语义已澄清。
**STOP Conditions** 需要新增配置项 · 需要改后端配置 API。
**现场回退路径** 移除入口。
**Dependencies** P5。

---

## 13. Phase 6B — System Status（Runtime 部分）

**Goal** 呈现有真实数据源的系统状态。

**Preconditions** P6A 就绪。

**IN SCOPE** 读 `HEALTH_GET`，呈现本地服务 / 顾客显示屏 / 网络 / 版本 / 显示器数量与 `assignmentSource` · **单一状态源、单一渲染组件，在管理中心与设置两处复用**（Blueprint 第 10 节 ‡）。

**OUT OF SCOPE** 打印状态（P6C）· 任何无数据源的项 · 任何「已连接 / 在线 / healthy」字样 · 视觉重做。

**Layers Touched** Electron（若需扩展 health 字段）+ Web UI。　**Protected Areas** 无。
**Governance Gate** 常规授权。　**Tests** 单元 + Browser 回归（无 Electron health 时降级呈现必须正确）。
**Independent Review** 建议。　**FIELD** 建议一次真机确认降级路径。

**Exit Criteria** 只显示有证据的项 · 两处复用同一实现 · 无 Runtime 时正确降级而非空白或假绿。
**STOP Conditions** 出现需要猜测才能填的状态格。
**现场回退路径** 隐藏状态面板。

---

## 14. Phase 6C — Printing Status Integration

**Goal** 通过 Local Printing Status Contract 呈现打印服务与打印机配置状态。

> **⚠ 外部阻断依赖：** 本 Phase 依赖 **Contract 的 producer 侧实现**，producer 在 RC9——**那是打印链改动，属独立任务、独立授权，绝不得在 Desktop Phase 内顺手实现**（Blueprint 第 14 节）。

**Preconditions** Contract 规格已定（含契约发现方式）· **producer 侧独立任务已完成并 FIELD**。

**IN SCOPE** consumer 侧解析与呈现 · stale 降级 · forward-compatible 解析 · 跨用户证据不足时显示「状态暂时无法确认」（**不得猜测**）· Printing Status Model 四条规则落地。

**OUT OF SCOPE** producer 侧任何实现 · 主动探活 · 直接读 RC9 内部 state · 任何「已连接」表述 · 视觉重做。

**Layers Touched** Electron（读取）+ Web UI（呈现）。**Printing Runtime：不改。**
**Protected Areas** 打印链全部为受保护区；本 Phase 只读契约。
**Governance Gate** 常规授权 + 确认 producer 侧已独立完成。
**Tests** 契约解析单元测试（正常 / 过期 / 更高版本 / 缺失 / 跨用户）。
**Independent Review** **必须**（打印真实性语义）。　**FIELD** **必须**（需真实 Runtime 与真实打印机）。

**Exit Criteria** 绿色只出现在「打印服务运行中」且证据新鲜 · 过期降级为灰 · 跨用户不猜测 · 打印失败不使顶部状态变红。
**STOP Conditions** 需要修改 RC9 · 需要读 RC9 内部结构 · 出现无证据的绿灯。
**现场回退路径** 隐藏打印状态区（回到 P6B 形态）。

---

## 15. Phase 7 — Technical Support Mode

**Goal** 把复杂诊断下沉到隐藏旁路。

**Preconditions** P6B 就绪（状态源已存在）· 解锁 UX 设计 Gate 通过。

**IN SCOPE** Runtime / 版本 / buildChannel · 显示器 raw info 与 `assignmentSource` · 打印诊断（角色 / 端点 / transport / journal / 结果码 / 契约原文）· 身份与绑定诊断码（**不显示密钥**）· 日志与诊断包导出 · 本机恢复动作（重新检测显示器 / 重启本地服务 / 临时关闭自动全屏 / 临时关闭 Operator Lock）。

**解锁 UX 需先过一个小设计 Gate（手势 + 时限 + 自动失效），但不得提前实现复杂方案。**

**OUT OF SCOPE** 任何业务权限 · 财务数据 · 绕过 Operator Lock 进入营业 · 进入 role schema。

**Layers Touched** Electron + Web UI（新路由）。　**Protected Areas** 无 forbidden path。
**Governance Gate** 常规授权 + 解锁 UX 设计 Gate。
**Tests** 权限用例：技术支持态不得触达收银与财务。
**Independent Review** 需要（越权面）。　**FIELD** 建议。

**Exit Criteria** 四项禁止均不可达 · 解锁有时限且自动失效 · 诊断包可导出。
**STOP Conditions** 技术支持态可触达业务数据 · 解锁机制开始需要服务端角色。
**现场回退路径** 移除入口。

> 注：P7 完成后可将 P4-1 的 Emergency Bypass 纳入完整 Technical Support UX。

---

## 16. Phase 8 — Visual Redesign（拆三）

### 目标定义

> **Visual Redesign 的目标是信息层级与交互质量，不是主题换色。**

**必须达成：** 高频动作更快 · 低频能力退出营业主视野 · 正常状态不打扰 · 异常才出现操作 · 触摸目标清晰 · 状态与权限表达不混乱 · 合理留白与明确层级 · 与已确认效果图及 Blueprint IA 一致。

**明确不是：** 深色改浅色 · 圆角加大 · 阴影调整 · 颜色替换。

**验收不能只看「是不是变浅色了」**，必须看：信息密度 · 触摸效率 · 可发现性 · 状态可理解性 · 高低频分层 · 与参考设计的一致性。

### 三段拆分

| | 触碰 Scope Guard | 可破坏收入链 | 规模 |
|---|---|---|---|
| **P8A 营业页视觉** | **是**（`app/cashier/page.tsx`） | **是** | 5416 行 + inline 样式 |
| **P8B 管理中心视觉** | 否（新路由） | 否 | 中 |
| **P8C 设置视觉** | 否（新路由） | 否 | 小 |

**共同冻结：Visual redesign 不得改变 business behavior · checkout behavior · permission behavior · printing behavior · offline behavior · data model。**

**P8A Preconditions** P1A / P1B / P2 / P4-1 / P4-2 全部稳定，试点已运行足够时间。
**P8B / P8C Preconditions** P5 / P6A 完成。

**OUT OF SCOPE（全部）** 任何业务口径调整 · **任何入口增删（那是 P2 / P5 的职责，P8A 不得重做 P2 的决定）** · 任何组件抽离顺手带的逻辑搬移。

**Governance Gate** P8A 需 Scope exception + Founder Gate；P8B / P8C 常规。
**Independent Review** P8A 必须。　**FIELD** P8A 必须；P8B / P8C 不强制。

**Exit Criteria** 上述「必须达成」六项经真人使用确认 · 业务 / 权限 / 打印 / 离线行为零变化 · P8A 另需收银主链 Browser 全量回归。
**STOP Conditions** 视觉改动开始牵动 state 或 handler · 出现「顺便优化一下逻辑」· 出现入口增删。
**现场回退路径** 前端回滚；P8A 回滚代价最高，故必须最后且独立。

---

## 17. Deferred Programs（不进入本 Roadmap）

| Program | 处置 |
|---|---|
| **0.4.7 Retirement** | 独立 program；12 条 Gate 全部有证据后才允许立项 |
| **Restaurant / Table Service** | Blueprint Explicit Non-Goal |
| **Offline Printing** | 独立 Founder Decision + 打印链任务 |
| **Active Printer Probe** | 独立任务；「打印机已连接」绿灯的唯一前置 |
| **Local Printing Status Contract producer** | 打印链独立任务，是 P6C 的外部前置 |
| **Coupon at cashier / Loyalty Points** | 独立业务决策 |
| **Complex IAM / ACL** | Blueprint Non-Goal |
| **Electronic Menu Desktop introduction** | 未评估，需另走 Architecture / Founder Gate |
| **Scope Guard 分层** | 治理债；建议在 P2 之前评估 |
| **Release Lineage 修复** | 治理任务；执行属破坏性操作独立授权 |

---

## 18. Parallelism Rules

> **「Can Run In Parallel With」只表示技术上不冲突，不得自动解释为可以同时实施。**
>
> **Default Execution Policy = 串行。** 并行必须由 Founder 显式批准，代理不得自行并行。

### 默认执行顺序（冻结主线）

```
P0 → P1A → P1A FIELD PASS → P1B → P1B FIELD PASS
   → P2 → P2 Regression PASS → P3-B Desktop Pilot
   → Founder: Pilot Evidence Sufficient = YES
   → P4-1 → P4-2 → P5 → P6A → P6B → P6C → P7
   → P8A / P8B / P8C
```

（P3-A 业务试点不在此链上，随时可行。）

### 技术并行性（仅记录，不构成许可）

P2 与 P1A / P1B 技术不冲突 · P8B 与 P8C 技术不冲突 · P6A 与 P7 设计 Gate 技术不冲突。

### 绝不可并行（技术层面即冲突）

P1A ∥ P1B（同文件）· P2 ∥ P4-1 ∥ P4-2 ∥ P8A（同碰 `app/cashier/page.tsx`）· P4-1 ∥ P4-2 · P4-x ∥ P5（同改导航与权限显隐）· 任何 Phase ∥ P3-B 试点期 · 任何 Desktop Phase ∥ 打印链改动。

---

## 19. Stop / Rollback Rules

### 失败必须停止后续

P0 失败 → 全部停止 · P1A 失败 → P1B 不得开始 · P1B 失败 → P2 不得开始 · P3-B 出现阻断级缺陷 → 立即回退 Browser，P4 / P5 暂停 · 4-0 未结论 → P4-1 实现不得开始 · P4-1 未 FIELD → P4-2 不得开始 · producer 未 FIELD → P6C 不得开始。

### 现场回退是硬性要求

> **每个 FIELD Phase 在开始前，必须在那台真实机器上验证 Browser fallback 可用并记录。** 代码回滚不等于门店能继续营业。
>
> **P4-1 必须自带 Emergency Bypass 并演练过**（不得依赖尚未完成的 P7）。
>
> **P3-B 试点期间 Browser 入口必须保持随时可达**，不得因 Desktop 上线而移除。

### Printing Isolation

**Regression check does not expand ownership.**

任何 Phase 的回归发现打印异常：STOP → 判断因果 → 有因果则该 Phase BLOCKED 并只修自身引入的问题 → 无证据则记录为独立 Printing issue，**不得在该 Phase 内修改 RC9 / Printing Core**。

同一原则适用于回归中发现的其他系统问题。

### 不得在谱系不清晰时开工

**全部 Phase。** 均要求 P0 的 `Safe Development Base = YES`。

### 触碰 Scope Guard 的 Phase

**P2 · P4-1（若碰 `app/api/cashier` 或 schema）· P4-2 · P8A。其余全部不触碰。**

### 需要 Founder Gate 的 Phase

P0 · P2（exception）· P3-B（试点起止 + Pilot Evidence Sufficient）· P4-1（exception + 若有 schema 另加 Gate）· P4-2（独立 Gate + exception）· P8A（exception）· 任何并行授权。

### 必须真机 FIELD

P1A · P1B · P3-B · P4-1 · P4-2 · P6C · P8A。

### 可只靠 CI / Browser 回归

P5 · P6A · P6B · P7 · P8B · P8C（各自仍建议一次冒烟）。

### 不得与打印改动同期

P1A · P1B · P3-B · P6C（试点期一律冻结）。

### 不得与 cashier 主链改动同期

P2 · P4-1 · P4-2 · P8A 互斥，且都不得与任何其他 `app/cashier/page.tsx` 改动同期。

---

## 20. Pilot Observation Plan

### 试点位置（冻结）

**Desktop 试点在 P1A + P1B + P2 之后，Operator PIN 之前。**
**业务试点 P3-A 不等待任何 Desktop Phase。**

### 必须记录的观察

**FIELD** 冷启动到可营业的耗时与步骤数 · 两屏是否每天自动就位 · 是否出现需人工干预的早晨 · 打印与 Desktop 是否互相干扰 · 断网时店员实际怎么做。

**Issues** 阻断级 / 影响体验 / 仅记录 三档，每条附现场证据（截图 / 错误码 / 时间戳）。

**User confusion** 第一次不会用的地方 · 需要解释才懂的文案 · 误触 · 反复点同一个没反应的东西。

**Unused entries** 一周内零点击的入口 —— **管理中心分组的直接依据**。

**High-frequency actions** 每日 Top 10 动作及次数 —— 决定营业页保留什么，也是 P8A 的验收依据。

**Unexpected workflow** 自创用法 · 绕过设计的做法 · 用纸笔补的环节。

**Operator（为 P4-1 / P4-2）** 实际几人操作 · 是否换班 · 老板本人是否收银 · 谁做退款 · 是否共用账号 · 「需要老板过来一下」的时刻与频次。

**Management（为 P5）** 老板在店里用不用电脑看数据 · 还是继续用手机 · 改价上下架在哪做。

### 必须等试点后才能冻结

管理中心最终分组与排序 · 是否需要 Dashboard · 商品报表与经营数据是否合并 · 营业页还能减到什么程度 · Operator PIN 的 enrollment 与切换 UX · 锁屏后未完成交易的切换语义 · 通知打扰阈值 · 顾客屏是否 kiosk 化 · 触摸密度与字号 · Electronic Menu 是否进 Desktop。

---

## 21. Roadmap Change-Control Rule

### Default Serial Execution

除非 Founder 显式批准，后续 Phase **默认按 Exit Gate 串行推进**。
**技术上可并行 ≠ 默认允许并行实施。** 代理不得自行并行。

### Regression Does Not Expand Scope

某 Phase 的回归发现其他系统问题：**不得自动接管该系统**。必须先判断是否由本 Phase 引入、是否属 Blueprint 当前范围。无因果证据 → 单独记录，**不顺手修**。

### Pilot Evidence Sufficiency

Pilot 不追求统计学完美，目标是为下一阶段提供足够真实的产品事实。
**Founder 有权据现场证据宣告 `Pilot Evidence Sufficient = YES`**，随即进入下一 Design Gate。**不得以「再多观察一点」无限延后。**

### Visual Fidelity

P8 验收不能只看「是不是变浅色了」。必须看信息密度 · 触摸效率 · 可发现性 · 状态可理解性 · 高低频分层 · 与已确认参考设计的一致性。

### 通用条款

1. **本 Roadmap 不得自行改变 Blueprint。** 冲突时以 Blueprint 为准并 STOP。
2. **Phase 不得合并，不得调整顺序。**
3. **Phase 不得扩范围。**
4. **未过 Exit Gate 不进入下一 Phase**，不得以「基本完成」代替。
5. **不得以「顺手」新建 API、新增 schema 或修改不相关业务。**
6. **不得在试点期推进其他 Phase。**
7. **不得在 Operator Login FIELD 之前关闭 legacy device fallback。**
8. **不得在 Desktop Phase 内实现打印侧 producer。**
9. **每个 Phase 的 FIELD 结论必须有独立记录**，不得以推断代替实测。
10. **每个 FIELD Phase 开始前必须验证现场回退路径可用。**
11. **Roadmap 修订与功能实现不得在同一 change set 中。**

**冲突处理：** STOP → 报告（Roadmap 预期 / 真实情况 / 冲突 / 最小选项）→ 返回 Founder / Architecture Gate。

---

```
ROADMAP STATUS               = FINAL
ROADMAP FROZEN               = YES
Implementation Authorization = NO
Code Change                  = NO
Production Change            = NO

No phase may start from this document alone.
```

**只有 Founder 后续单独授权「进入 P0 Governance Readiness」，才允许开始 P0。**
