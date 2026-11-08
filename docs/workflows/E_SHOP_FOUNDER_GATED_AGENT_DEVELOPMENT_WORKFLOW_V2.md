# E-Shop Founder-Gated Agent Development Workflow V2.0

| 项目 | 内容 |
| --- | --- |
| Document ID | E-SHOP-WORKFLOW-V2 |
| 层级 | 操作层，受 Level 0 约束 |
| 批准人 | Founder |
| 生效 | 所需独立审查通过、Founder 批准本次精确候选并合入可信 `origin/main` 后生效。候选分支上的文本仅供审查。 |
| 前版 | [Workflow V1.0](E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md) 保留原文与历史效力。V2 生效后作为当前入口，继续采用 V1 原有条款及以下补充。 |

## §§1–3 · 适用范围与判级

按 V1 §§1–3 执行开工核验和 L1/L2/L3 判级。依次读取当前任务适用的 [AGENTS.md](../../AGENTS.md)、本文件、V1 及现有任务状态。ES-ENG-001、ES-GOV-001、风险分级 Addendum、UI Fast Path、冻结规则及 Release Lineage 按各自权威适用。风险升级时立即切换对应门禁，降级仍由 Founder 批准。

## §4 · 执行和职责

| 角色 | 职责 |
| --- | --- |
| Founder | 决定产品目标、授权范围、风险边界及适用的正式 Gate。按对应规则本人签认。 |
| ChatGPT CTO | 提供架构、优先级和治理裁决建议，处理上报的边界问题。审批和独立审查以各自权威记录为准。 |
| Codex | 在授权内自主实施、测试、修复和取证，准备并直接交接审查材料。获得对应授权后，由 Codex 执行分支推送、PR 创建与正文、检查读回及合并，记录真实结果。 |
| Claude 或适用的独立审查者 | 用新上下文只读审查精确候选，报告结论、证据、阻断和适用范围。命中 ES-ENG-001 的正式 Claude Review 要求时按原规则执行。 |

L1 默认自验，L2 自主协调独立审查，L3 保留适用的 Readiness、独立审查、正式签认及必要 FIELD。范围内普通问题由执行者先行处理，常规进度和证据写入任务状态并事后报告。真正需要决定时，集中呈交可审阅候选、风险、精确动作、证据和最小决策。已经明确授权的同一动作无需重新请求，执行前按 V1 §6.2 复述。候选或授权绑定变化时先重验，再判断是否需要新决定。

## §5.5 · 证据复用

V1 §§5.1–5.4 全部适用。复用仅限证据适用性仍可证明的情况，核对源字节、依赖、配置、环境、工具链、验收范围和期限。要求新上下文审查、实际 FIELD 或精确候选检查时，取得该次证据。新候选 SHA 需要自己的适用检查，旧 SHA 的检查结果只保留为历史证据。

Known Failures 使用下列 JSON v1 格式作为现有 Evidence Pack 的证据附件。人工逐字段核对，并验证日志哈希与失败全集。自动校验入口须另经验证，登记结果仅供取证和归因。正式失败处置仍须依当次适用规则。

```json
{
  "schema_version": 1,
  "baseline": {"sha": "<full SHA>", "tree": "<tree SHA>"},
  "candidate": {"sha": "<full SHA>", "tree": "<tree SHA>"},
  "environment_toolchain_config_sha256": "<SHA-256>",
  "baseline_evidence": {"path": "<raw result>", "sha256": "<SHA-256>"},
  "candidate_evidence": {"path": "<raw result>", "sha256": "<SHA-256>"},
  "raw_status": "BLOCKED",
  "failure_set_sha256": "<SHA-256>",
  "failures": [{
    "test_id": "<suite/test>",
    "assertion": "<file:line or assertion ID>",
    "expected": "<value>",
    "actual": "<value>",
    "diagnostic_or_exit_code": "<code>",
    "fingerprint": "<SHA-256>",
    "attribution": "baseline_reproduced",
    "evidence": {"path": "<raw log>", "sha256": "<SHA-256>"},
    "expires_at": "<UTC timestamp>"
  }],
  "invalidate_on": ["failure_set_change", "result_change", "input_change", "expiry"]
}
```

每个失败登记一项。归因区分 `baseline_reproduced` 与 `candidate_triggered`，归因不明则阻断复用。按稳定顺序保存完整失败身份与结果清单，保存该清单原字节和哈希以供核对。失败新增、减少、替换、改名、转为 SKIP、未执行或结果变化，或基线、候选、输入、证据、期限变化时，原复用资格失效。重新核对或重跑受影响检查并保留原始 `FAIL`、`BLOCKED`、`SKIP` 与未执行状态。缺失、过期或 `UNKNOWN` 的证据不可复用。

## §6 · Founder Gate 与有限实施授权

V1 §§6.1–6.3 及上位规则全部适用。Founder 可在一次明确的 L1/L2 实施授权中列明封闭 Task ID 清单、允许路径及行为、风险上限、执行人、可信基线、允许的基线推进条件、指定隔离目标、有效期及撤销方式。登记原始批准记录，列明实施、测试、修复、审查协调及隔离集成中的获准动作。各任务的 Readiness、Scope、Lineage、独立审查和硬依赖分别核验。符合 Addendum 的源代码验收后，才可集成到获准的非部署 ref。

隔离集成排除 `main`、`origin/release` 及任何触发 Preview 或 Production 部署的 ref。到期、撤销、新增 Task ID、风险升级、范围或授权绑定变化时停止受影响动作。范围内后继可沿用实施许可，重新验证候选。此授权仅覆盖列明的实施动作。合并 `main`、正式发布、部署及其他受控操作按 V1 §6.2 取得本次明确授权。若 push 或建 PR 触发 Preview，先取得适用授权。

Level 0、FINAL/Freeze 和 Scope Guard forbidden paths 均排除在有限实施授权外。分别适用 ES-GOV-001 Evolution Rule、ES-ENG-001 正式 Founder Approval、可信 `main` 上的精确 `ACTIVE` 例外。上位规则要求 Founder 本人、指定渠道或精确候选签认时，Codex 负责准备材料和核验证据，由本人按要求签认。新 L3 冻结后继须取得绑定该候选的本人正式签认，旧签认不可承继。Diamond PR #38 与 #39 各自适用此原则。冻结、L3 独立审查、必要 FIELD、Owner/Lease/Fence、打印去重、UNKNOWN、支付、权限、数据库和不可逆操作的原有安全门禁全部适用。

## §§7–9 · 汇报、状态和平台证据

复用 [Task State 模板](E_SHOP_TASK_STATE_TEMPLATE_V1.md)，追加原始授权引用、允许动作与隔离目标、候选和证据索引、独立审查状态、实际动作及结果。记录 Founder 决策和人工操作次数、重复审批、审查交接、等待时长、证据复用与重跑原因。未发生或未核实的事项分别记录。

合并、发布和 Closure 分别读回 `main`、`release` 的 Branch Protection、有效 Rulesets、适用 required checks 和实际候选执行状态。配置、检查结果和未取得的证据分开记录。采用本文件时的核验基线显示 `main` 的可见经典 required checks 为空，可见 Rulesets 未覆盖 `main`。有效规则和经典保护管理端点未完整读回，余项为 `UNKNOWN`。空检查或未触发均不可记为 PASS。可见 `release` Ruleset `26426184` 要求 App `5590705` 的 `eshop/selective-release-validator`，并限制删除及非快进更新。平台的 `strict_required_status_checks_policy=false` 与项目 STRICT Lineage 分别核验。

目标、来源或 Production ref 漂移时，停止对应写入，重读并重验授权、候选、树、父链、Scope、STRICT Lineage 和平台 Gate。适用证据为 `UNKNOWN` 时按 AGENTS 和 V1 fail closed。Closure 仍按 AGENTS §11 验证实际合并、生产、验收和回归。验收材料与真实现场结果分别登记。

## §§10–12 · 生效、版本与归档

V2 按 V1 §12 正式修订。仓库入口与本文件随同一候选合入，合入后核验可信 `origin/main` 上的入口和文件内容。V1 保留原文供历史引用，既有规则引用继续指向其历史版本。归档可信基线、候选与合并 SHA、独立审查、Founder 原始授权、GitHub 检查读回及生效核验。企业记录按 AGENTS §12 同步到真实 Obsidian/BOS。
