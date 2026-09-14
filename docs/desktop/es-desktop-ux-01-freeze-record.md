# ES-DESKTOP-UX-01 — FINAL FREEZE RECORD

```
Code Change          = NO
Production Change    = NO
P0 Started           = NO
Next Authorized Step = NONE
```

> 冻结日期：2026-09-14　·　裁定人：Founder　·　记录人：Claude（Cowork）
> 冻结文档：`es-desktop-ux-01-blueprint-v1-final.md` · `es-desktop-ux-01-roadmap-v1-final.md`

---

## 1. Founder 最终接受

```
Architecture Review           = PASS
Architecture Consistency      = PASS
Scope Discipline              = PASS
Core Business Protection      = PASS
Evidence Semantics            = PASS

Roadmap Phase Sequencing      = PASS
Pilot Strategy                = PASS
Fallback Strategy             = PASS
Printing Isolation            = PASS
Business / Engineering Split  = PASS

Blocking Architecture Issue   = NONE
Blocking Roadmap Issue        = NONE
```

---

## 2. Blueprint Final Status

```
BLUEPRINT STATUS             = FINAL
DESIGN FROZEN                = YES
Implementation Authorization = NO
```

文档：`docs/desktop/es-desktop-ux-01-blueprint-v1-final.md`

### 冻结时并入的三项 wording hardening

**① Browser 原则** —— 不写成绝对形式。最终措辞：**所有不依赖 Desktop 原生环境 / 本地硬件的业务能力，应保持 Browser 可用**。Desktop-only 只能来自明确的 OS 能力、本地硬件能力或 Desktop environment capability；**不得仅因实现方便而把业务能力做成 Desktop-only**。

**② Web / Electron 分层原则** —— 「改一次是否必须重装 Desktop」是**重要判断标准之一，不是唯一标准**；必须同时考虑 OS 权限、安全边界、生命周期、原生能力、故障恢复需求。

**③ Operator PIN 验证** —— 继续冻结：不存明文 · 6 位 · 失败锁定 · 在线 / 服务端验证优先 · 不提前建设复杂本地 Credential 系统。**但不写成「服务端验证永久不可改变」**；最终具体实现由未来 Operator PIN Pre-Development Audit 在 Blueprint 边界内决定。

---

## 3. Roadmap Final Status

```
ROADMAP STATUS               = FINAL
ROADMAP FROZEN               = YES
Implementation Authorization = NO
```

文档：`docs/desktop/es-desktop-ux-01-roadmap-v1-final.md`

### 冻结的施工主线

```
P0  Governance Readiness
P1A Fullscreen Foundation
P1B Display Assignment & Swap
P2  Cashier Minimal Simplification
P3-B Desktop Pilot
     → Founder: Pilot Evidence Sufficient = YES
P4-1 Operator Lock & Local PIN
P4-2 OWNER Single-action Approval & Attribution
P5  Management Center V1
P6A Settings
P6B System Status
P6C Printing Status Integration
P7  Technical Support
P8A Cashier Visual · P8B Management Visual · P8C Settings Visual
```

**默认串行实施。技术上可并行不等于允许代理自行并行；只有 Founder 可显式批准并行。**

---

## 4. P4-1 / P4-2 拆分确认

**已接受。**

**P4-1 — Operator Lock & Local PIN**　解决【现在是谁在操作】。
范围：Operator Lock · OWNER / STAFF 操作人选择 · 6 位本机营业 PIN · PIN 失败锁定 · Lock · Switch Operator · OWNER Operator 状态 · STAFF Operator 状态 · operator attribution 基础正确性 · 锁屏后未完成交易的切换语义设计与验证 · Emergency Bypass。

> **P4-1 FIELD 后，新的 operator attribution 才可以开始被视为真实营业员归属。**

P4-1 **不包含：** OWNER 单次敏感动作授权 · `authorizedByUserId` 全量接入 · 复杂权限调整 · 时间窗授权 · 关闭 legacy device fallback。

**P4-2 — OWNER Single-action Approval & Attribution**　解决【谁批准了敏感动作】。
范围：STAFF 状态下 OWNER PIN 单次批准 · `operatorUserId` 保持 STAFF · `authorizedByUserId = OWNER` · 退款等真实敏感动作的权限映射 · approval attribution 的 FIELD 验证。

P4-2 必须：**独立 Review · 独立 Gate · 独立 FIELD**。

> **P4-2 FIELD 后，approval attribution 才可以被视为可信。**
> **若 P4-2 复杂，不得阻挡已经完成的 P4-1 真实营业员身份能力。**

---

## 5. Emergency Bypass 确认

**已冻结。**

**P4-1 上线时不得依赖尚未完成的 P7 Technical Support Mode 才能回退。P4-1 必须自带 Operator Lock Emergency Bypass。**

**用途仅限：** Operator Lock 自身故障导致门店无法开始营业时，临时回到 legacy 可工作路径。

**必须：** 本机触发 · 明确受控 · 临时 · 有清晰状态提示。

**不得：** 改变业务角色 · 获得 OWNER 管理权限 · 获得 Technical Support 全功能 · 绕过现有业务权限 · 成为长期正常营业模式。

**它只解决：【Lock 坏了，今天还能继续卖。】**

P7 完成后可把该 bypass 纳入完整 Technical Support UX，但 P4-1 自身不得依赖 P7。

---

## 6. Commercial Pilot P3-A 独立确认

**已冻结。**

第一家店业务试点使用现有 **Browser + RC9** 栈，**不等待任何 Desktop Phase**。

> **商业上线不能被 Desktop 重构绑架。**

Desktop 是稳定业务路径之上的升级，不是第一家店开业的硬前置。Browser fallback 必须是真实可用的回退路径，不是纸面方案。

---

## 7. Deferred Programs 确认

以下继续不进入 Roadmap 主线：

0.4.7 Retirement · Restaurant / Table Service · Offline Printing · Active Printer Probe · Local Printing Status Contract producer · Coupon at cashier · Loyalty Points · Complex IAM / ACL · Electronic Menu Desktop introduction。

未来如需进入：**另走 Architecture / Founder Gate。**

---

## 8. Change-Control 已冻结

冻结后，任何后续实现人员 / Agent / Claude / Codex **不得**：

自行修改 Blueprint · 自行修改 Roadmap · 合并 Phase · 调整 Phase 顺序 · 因实现方便扩大范围 · 顺手改 cashier core · 顺手改 printing core · 顺手新增 API · 顺手新增 schema · 把未来能力画成当前能力 · 关闭 legacy fallback · 绕过 Exit Gate。

**发现真实实现与冻结蓝图冲突：**

```
STOP
→ 报告：
   1. Frozen Blueprint / Roadmap 预期
   2. 真实实现
   3. 冲突
   4. 最小解决选项
   5. 是否需要 Blueprint Change
→ 返回 Founder / Architecture Gate
```

**只有显式批准，才能修改冻结设计。**

---

## 9. Implementation Authorization

```
Implementation Authorization = NO
Code Change                  = NO
Production Change            = NO
P0 Started                   = NO
```

---

## 10. Next Authorized Step

```
Next Authorized Step = NONE
```

**只有 Founder 后续单独授权「进入 P0 Governance Readiness」，才允许开始 P0。**

---

## 阅读顺序

```
es-desktop-ux-01-blueprint-v1-final.md   ← 唯一设计基线
        ↓
es-desktop-ux-01-roadmap-v1-final.md     ← 施工顺序与 Gate
        ↓
es-desktop-ux-01-freeze-record.md        ← 本文件：冻结状态与授权边界
```

任何 Desktop 相关任务开工前，按此顺序读取三份文档。
