# E-Shop Founder-Gated Agent Development Workflow V2.1

| 项目 | 内容 |
| --- | --- |
| Document ID | E-SHOP-WORKFLOW-V2 |
| 层级 | 操作层，受 Level 0 约束 |
| 批准人 | Founder |
| 生效 | 所需独立审查通过、Founder 批准本次精确候选并合入可信 `origin/main` 后生效。候选分支上的文本仅供审查。 |
| 前版 | [Workflow V1.0](E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md) 保留原文与历史效力。V2 生效后作为当前入口，继续采用 V1 原有条款及以下补充。 |
| 本次修订 | `ES-DEV-WORKFLOW-OPTIMIZATION-01`；在原生效条件满足前，V2.1 增量仅为候选，可信 `main` 上的已生效版本继续适用。 |

## §§1–3 · 适用范围与判级

按 V1 §§1–3 执行开工核验和 L1/L2/L3 判级。依次读取当前任务适用的 [AGENTS.md](../../AGENTS.md)、本文件、V1 及现有任务状态。ES-ENG-001、ES-GOV-001、风险分级 Addendum、UI Fast Path、冻结规则及 Release Lineage 按各自权威适用。风险升级时立即切换对应门禁，降级仍由 Founder 批准。

### §2.1 · 最小方案 Preflight

沿用真实 Obsidian/BOS 的 `04-SOP/ES-REUSE-001 Store OS 借鉴原则与开发前复用检查 V1.0.md` §§2–3；结论写入已有 Readiness 或任务状态，不新增检查表、审批或 Gate。

- 先查现有正常业务路径、成熟能力和历史证据能否安全满足目标；可复用或局部修复时，不另建专用恢复入口或平行业务实现。
- 故障任务先只读保全失败样本和请求时间，对比正常样本，区分数据/本地状态、授权、网络/资源等待与代码/接口缺陷。异常日志不直接等于根因；已证实的因果、复现条件与尚待验证的假设分别记录。
- 选择满足目标的最小安全改动，写明选择理由与验证方法；不得把数据修补当作代码缺陷已修复，也不在事故恢复中搭车做通用优化。确需扩大范围时仍按原 Scope 与授权规则处理。
- 在已有任务状态中先确定最终交付目标：开发基线、实际 Production 基线、最终候选形成方式（main 来源或批准的生产投影）及应验证的最终树。若两基线不同，先检查相关差异和现有发布机制是否支持；不要先对中间候选完成整轮失败处置，再发现需要另一棵发布树。release-first hotfix 仍受 Selective Release §8 限制，本条不新增发布权限。

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

#### Product Candidate 与 Governance Head

任务授权及 Acceptance 草案分别记录：固定的 Product Candidate SHA/tree、Production 基线、实际 Governance Head、证据输入的精确路径/摘要及原始授权引用。产品候选绑定运行时、测试、依赖、配置和验证范围；治理头记录取证和登记时的可信状态，不默认把两者写成同一个候选。授权正文、期限、撤销、冻结边界和失败身份仍是必核输入。

新草案应明确列出允许前进的治理文档精确路径和必要自身登记动作，以及继续有效的条件。只在原授权已覆盖该推进、产品和 Production 未变、证据输入未变、完整差异经审阅确认为无关说明/已授权登记、Scope/Lineage及受影响检查仍有效时，才继续原授权动作。登记后的 Governance Head 如实追加，原批准内容保持不变，不把登记文件自身摘要递归写入其批准身份。

无关治理文档前进本身不改变 Product Candidate。按 §§7–9 暂停受影响写入并完成重验后，复用未变输入的证据，只补受影响检查；不机械重做无关性能实验、全部独审或再次请求同一产品范围授权。实际规则、原授权、Guard、测试、manifest、依赖、配置、环境、失败身份/结果、产品、Production或期限发生变化时，仍按各自原门禁处理。路径白名单和摘要工具只能提供取证事实，不能替代治理语义审查或产生批准。

可用 `node scripts/test/check-governance-evidence-reuse.mjs <repo-root> <input.json>` 比较已有任务中的精确输入清单及治理差异。输入清单的完整性、记录语义、批准来源和继续动作的合法性仍由执行者/独审按原规则核验；工具不接入 CI、不产生准入或授权，也不替代现有失败处置。

本条仅规范新草案和证据适用性，不追溯修改已签精确草案。旧批准若明文规定任何 ref 漂移均失效且没有推进许可，仍需按原授权解决；不得把本条用于静默续接、扩大历史失败豁免或激活另一任务的 Acceptance。RAW CORE、正式失败处置、Acceptance、合并、发布及 FIELD 状态分别保留。

### §5.6 · 影响真实营业的 Production Hotfix

在本工作流内采用：**只读诊断 → 最小修复 → 针对性测试 → 独立审查 → 生产授权 → FIELD**。此顺序是既有门禁内的事故执行顺序，不是新的放行通道；先满足适用的开工 Readiness/Authorization，main 准入、Scope Guard、Release Lineage、受保护发布、完整必需回归与 L3 独立验证仍按原规则执行。

复用 §5.5 中仍有效的证据，补验证本次改动及受影响不变量；不得以“针对性”跳过既有必需检查。若现有正常路径的最小修复已足够，优先恢复该路径，不继续扩展专用功能。依 §4 自主准备可审阅候选，依 §6 提交尚未获授权的受控动作，不增设 hotfix 专属审批。生产部署、实际交易或打印前的真人条件不得代签或由技术 PASS 替代。

## §6 · Founder Gate 与有限实施授权

V1 §§6.1–6.3 及上位规则全部适用。Founder 可在一次明确的 L1/L2 实施授权中列明封闭 Task ID 清单、允许路径及行为、风险上限、执行人、可信基线、允许的基线推进条件、指定隔离目标、有效期及撤销方式。登记原始批准记录，列明实施、测试、修复、审查协调及隔离集成中的获准动作。各任务的 Readiness、Scope、Lineage、独立审查和硬依赖分别核验。符合 Addendum 的源代码验收后，才可集成到获准的非部署 ref。

隔离集成排除 `main`、`origin/release` 及任何触发 Preview 或 Production 部署的 ref。到期、撤销、新增 Task ID、风险升级、范围或授权绑定变化时停止受影响动作。范围内后继可沿用实施许可，重新验证候选。此授权仅覆盖列明的实施动作。合并 `main`、正式发布、部署及其他受控操作按 V1 §6.2 取得本次明确授权。若 push 或建 PR 触发 Preview，先取得适用授权。

Level 0、FINAL/Freeze 和 Scope Guard forbidden paths 均排除在有限实施授权外。分别适用 ES-GOV-001 Evolution Rule、ES-ENG-001 正式 Founder Approval、可信 `main` 上的精确 `ACTIVE` 例外。上位规则要求 Founder 本人、指定渠道或精确候选签认时，Codex 负责准备材料和核验证据，由本人按要求签认。新 L3 冻结后继须取得绑定该候选的本人正式签认，旧签认不可承继。Diamond PR #38 与 #39 各自适用此原则。冻结、L3 独立审查、必要 FIELD、Owner/Lease/Fence、打印去重、UNKNOWN、支付、权限、数据库和不可逆操作的原有安全门禁全部适用。

## §§7–9 · 汇报、状态和平台证据

复用 [Task State 模板](E_SHOP_TASK_STATE_TEMPLATE_V1.md)，追加原始授权引用、允许动作与隔离目标、候选和证据索引、独立审查状态、实际动作及结果。记录 Founder 决策和人工操作次数、重复审批、审查交接、等待时长、证据复用与重跑原因。未发生或未核实的事项分别记录。

合并、发布和 Closure 分别读回 `main`、`release` 的 Branch Protection、有效 Rulesets、适用 required checks 和实际候选执行状态。配置、检查结果和未取得的证据分开记录。采用本文件时的核验基线显示 `main` 的可见经典 required checks 为空，可见 Rulesets 未覆盖 `main`。有效规则和经典保护管理端点未完整读回，余项为 `UNKNOWN`。空检查或未触发均不可记为 PASS。可见 `release` Ruleset `26426184` 要求 App `5590705` 的 `eshop/selective-release-validator`，并限制删除及非快进更新。平台的 `strict_required_status_checks_policy=false` 与项目 STRICT Lineage 分别核验。

目标、来源或 Production ref 漂移时，停止对应写入，重读并重验授权、候选、树、父链、Scope、STRICT Lineage 和平台 Gate。适用证据为 `UNKNOWN` 时按 AGENTS 和 V1 fail closed。Closure 仍按 AGENTS §11 验证实际合并、生产、验收和回归。验收材料与真实现场结果分别登记。

### §9.1 · 交易相关 FIELD、UNKNOWN 与通信

沿用现有 Acceptance / FIELD 记录，按实际风险和改动影响面选取验收项；不相关项记 `N/A`，不要求每个任务增加一套记录或现场操作：

- 订单与付款：关联原始样本、唯一订单号、明细/销售数量/金额、支付方法与最终状态、幂等及同步结果；区分账面补记与实际收款，禁止重复收款、入账或库存副作用。
- 打印：把同一订单的前台任务、执行身份/次数与真人确认的完整实体出纸关联。接口成功、任务 ACK、`CROSSED` 或队列受理各自仅证明其边界，不能单独代替实体纸样验收；打印异常不得以重交交易解决。
- 报表/交班受影响时：分别保留真实业务时间、实际收款日期及修复/审计时间，核对真实统计区间和历史已收现金的本班新增实收说明。已签记录保全前后版本及必要补记签认，不静默覆盖。尚未到时或未取得的真实交班单记为待验，不能用数据库推算、计划或局部交易/打印 PASS 代替最终 Closure；通过全部适用条件后才按原规则收口。

交易、支付或打印结果出现超时、丢响应或其他 `UNKNOWN` 时，立即停止该次业务的重复提交、换 key/body/身份重提、再受理或重印，仅只读核对原订单、付款、幂等、同步与执行记录。普通 HTTP 500 不证明事务回滚，同 key 保护也不是重试许可。结果已确定后的处置仍须满足现有事务、幂等、打印与授权规则；本条不自动授权重放或恢复操作。

技术诊断、SQL、Scope/Lineage、提交及审查报告保留在内部。商户只接收已获授权的必要业务通知和简明操作指引，不承担技术门禁操作。对外发送仍遵守既有授权规则；工具可用、hotfix 资格或技术 PASS 均不构成发送授权，未获发送授权时只准备文案。

## §§10–12 · 生效、版本与归档

V2 按 V1 §12 正式修订。仓库入口与本文件随同一候选合入，合入后核验可信 `origin/main` 上的入口和文件内容。V1 保留原文供历史引用，既有规则引用继续指向其历史版本。归档可信基线、候选与合并 SHA、独立审查、Founder 原始授权、GitHub 检查读回及生效核验。企业记录按 AGENTS §12 同步到真实 Obsidian/BOS。
