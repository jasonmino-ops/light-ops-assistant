# E-Shop Founder-Gated Agent Development Workflow V1.0

## Status

| Item | Value |
| --- | --- |
| Document ID | E-SHOP-WORKFLOW-V1 |
| Title | E-Shop Founder-Gated Agent Development Workflow |
| Version | V1.0 |
| Layer | 操作层工作流：位于 Level 0 之下，受 Level 0 约束，不属于 Level 0 |
| Approval Authority | Founder |
| 生效条件 | 合并进入 `origin/main` 后生效；未合并前仅为草稿 |
| 适用对象 | 在本仓库执行任务的全部开发代理：Codex、Claude Code、Claude Desktop 及其他自动化代理 |
| 配套模板 | `docs/workflows/E_SHOP_TASK_STATE_TEMPLATE_V1.md` |

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

本文档不改写、不削弱任何 Level 0 规则、`AGENTS.md` 规则、Scope Guard、Release Lineage Gate 或冻结资产。它只规定三件事：代理如何按风险分级执行任务、何时必须停下等待 Founder 决策、如何汇报和交接。

## 1. 目的

E-Shop 仓库长期由多个代理并行开发。没有统一的执行模式时，常见问题是：简单任务被套上高风险全流程而反复暂停，高风险任务却在没有基线、没有独立审查、没有证据的情况下宣称完成，以及代理凭对话记忆推翻仓库规则。

本工作流用一套固定规则解决这些问题：

- 开工前固定的读取顺序和判级动作；
- 三个任务等级（L1 / L2 / L3），只对高风险任务施加高风险要求；
- 主执行代理自主推进到真正的 Founder Gate，而不是在阶段编号或普通测试失败上停下；
- 明确列举的 Founder Gate，作为代理唯一必须暂停的条件；
- 固定的简洁汇报格式和任务状态记录，作为代理之间的交接来源；
- 明确的事实优先级，防止漂移。

适用任务：功能开发、Bug 修复、架构设计、工作流或治理规则、仓库审计、Build / 安装包 / 数据库 / 发布。

## 2. 开工前必读与判级

凡属第 1 节适用任务，代理开始工作前必须按以下顺序读取：

1. 仓库根 `AGENTS.md`；
2. 当前目录链中更深层的 `AGENTS.md` / `AGENTS.override.md`（如存在）；
3. 本文档；
4. 当前任务状态记录 `<worktree>/.task-state/<TASK-ID>.md`（本地文件，如存在）。

读取后，代理必须：

- 按第 3 节判定任务等级，并在首次汇报中声明等级和判定依据；
- 按 `AGENTS.md` 第 4 节完成开工前自动检查（Git status、branch / worktree、remote、目标基线、影响面判断）；
- L2 / L3 任务在开工前创建任务状态记录（第 8 节）。

读取顺序不是优先级。冲突时的优先级见第 9 节。

## 3. 任务等级

### 3.1 判级原则

- 等级按改动面与影响面判定，不按任务标题、预计工时或用户口头描述判定。
- 任务同时具有多个等级特征时，按最高风险等级执行。
- 任务进行中发现触及更高等级特征时，立即升级并补齐更高等级的全部要求。升级不需要 Founder 批准；降级必须经 Founder 批准。
- 只读审计任务（用户未要求修改）不产生仓库写入，按 `AGENTS.md` 第 2 节只读规则执行；报告中必须给出“若落地实施，建议任务等级”。
- 任务指令中给出的等级（例如任务标题中的 `L2`）是起点，不是上限；代理核对后若发现应更高，按更高等级执行并在首次汇报中说明。

### 3.2 L1 轻量任务

适用：

- 文案、翻译文本、提示语的修正；
- 样式与布局微调；
- 仓库文档中非行为性的措辞、typo 修正；
- 小范围、低风险 Bug：改动集中在少数文件，不改数据结构、不改接口合同、不改状态流，且不命中 Scope Guard forbidden paths。

执行方式：

- 主代理直接读取真实代码，完成最小实现并自行验证；
- 至少运行与改动面直接相关的检查（按 `AGENTS.md` 第 9 节从代码、package scripts 和已有测试中发现应跑的检查；构建不适用时报告 N/A 及依据）；
- 默认不要求独立审查子代理；
- 任务状态记录可选。

自动升级：实现方案或 diff 触及以下任一项，任务即不再是 L1，至少按 L2 执行；若命中 L3 特征则按 L3 执行：

- 数据库（schema、migration、数据修复脚本）；
- 支付（CASH / KHQR / 余额 / 结算 / 退款路径）；
- 权限（任何角色判断、身份上下文或租户隔离逻辑）；
- 打印（打印 API、打印 provider、桌面打印或 tray 链路）；
- 安装包（桌面安装包、打包脚本、发布用的 GitHub Actions workflow 文件）；
- Production（部署、环境变量、平台配置、生产 migration）；
- Scope Guard forbidden paths 或冻结资产；
- 公共合同（跨进程、跨部署单元或被外部客户端依赖的合同：HTTP API、事件格式、小票格式、离线同步数据格式、桌面端与云端之间的协议；仓库内部函数签名不属于公共合同。任何公共合同变更均为 L3）。

限制：

- L1 不豁免 `AGENTS.md` 第 5 节的独立分支与隔离 worktree 规则、第 6 节的 Docs-only Exception 条件，也不豁免 Scope Guard。
- 未经授权不得合并、不得 push、不得部署。

### 3.3 L2 标准任务

适用：

- 新页面；
- 新 API 或现有 API 的非合同性改动；
- 多文件业务流程；
- 普通权限逻辑：在现有 OWNER / STAFF 模型和 `getContext` 上下文之内新增或调整页面级、接口级的权限判断，不改变身份模型本身；
- 工作流、治理规则、SOP 等文档任务（包括本文档这一类）；
- 不命中 L3 特征的收口与修复任务。

执行方式：

- 主代理自主完成审计、实现、测试和修复，形成闭环；
- 使用全新上下文子代理做独立只读审查（第 5 节）；
- 审查发现的范围内问题由主代理自主修复，必要时再次审查；
- 维护任务状态记录；
- 只在 Founder Gate（第 6 节）暂停。对 L2 任务，最常见的 Founder Gate 是合并 main。

要求：

- 独立任务分支与隔离 worktree（分支命名按 `AGENTS.md` 第 5 节；正式 Engineering Package 按 ES-ENG-001 的 Branch Naming）；
- Release Lineage Gate 通过，或满足 `AGENTS.md` 第 6 节 Docs-only Exception 的全部条件；
- Scope Guard PASS；
- 任务状态记录必须存在并保持最新；
- 命中 ES-ENG-001 “Readiness is mandatory” 触发条件（例如 Permissions change、Multiple business modules are affected、Production paths are affected）或 `docs/workflows/STORE_ASSISTANT_DEV_WORKFLOW_SKILL_V1.md` 第 3 节完整链路、第 7 节先审条件的 L2 任务，开工前先按对应文档形成记录并取得授权，再改业务代码；该开工授权本身是 Founder Gate。L2 等级不豁免这些上位要求。

### 3.4 L3 高风险任务

适用（任一即为 L3）：

- 数据库：schema、migration、数据修复、唯一约束、生产数据操作；
- 支付：CASH / KHQR / 会员余额 / 结算 / 退款 / 离线订单同步；
- 打印：打印 API、打印 provider、QZ / tray / 桌面打印链路、小票内容合同；
- 安装包：桌面安装包、正式发布产物、打包脚本与发布用的 GitHub Actions workflow 文件；
- 身份权限：`lib/session.ts`、`lib/context.ts`、`middleware.ts`、`app/api/auth/`、角色模型、token 体系、Telegram 绑定与身份合并；
- 多租户：tenantId / storeId 隔离、跨门店数据访问；
- 公共合同变更：第 3.2 节定义的公共合同（HTTP API、事件格式、小票格式、离线同步数据格式、桌面端与云端之间的协议）的任何改动，兼容与否都按 L3；
- Production：部署、环境变量、平台配置、流量切换、回滚；
- 可能造成数据损失或不可逆后果的任何操作；
- 修改 FINAL / Freeze 资产、Scope Guard 配置（`docs/change-gates/gate-config.json`）、exception 记录、CI 或发布用的 GitHub Actions workflow 文件。

执行方式：

1. 使用隔离 worktree 和任务分支，并记录基线：`origin/main` SHA、Production SHA（如适用）、Release Lineage Gate 结果、worktree 路径。
2. 开工前在任务状态记录中写明：目标、冻结边界（不可改动的文件、能力、合同）、验收门槛（必须通过的测试、必须存在的证据、是否需要 FIELD 验收）。按 ES-ENG-001 需要 Readiness Review 或 Engineering Authorization 的，先形成对应记录并取得授权，再改业务代码；命中 `docs/workflows/STORE_ASSISTANT_DEV_WORKFLOW_SKILL_V1.md` 第 7 节先审条件、第 4.1 节记录范围要求的，同样在此阶段完成。
3. 在授权 Scope 内实现，实施中持续检查 `git diff`。
4. 需要触及 Scope Guard forbidden paths 或冻结资产时，形成 sealed draft：列出精确文件路径与内容 SHA-256，按 `AGENTS.md` 第 8 节的 task-scoped exception 机制交 Founder 精确授权；未授权前不得依赖该改动。
5. 执行安全、可靠性、恢复与兼容审查：安全（认证、权限、租户隔离、密钥、输入校验）、可靠性（失败路径、重试、幂等）、恢复（回滚方案、数据恢复方案、migration 可逆性）、兼容（schema 与 runtime 成套、旧版本客户端、离线数据、已冻结合同）。
6. 独立审查（第 5 节）。命中 ES-ENG-001 Claude Review 强制清单的，按 ES-ENG-001 的 Claude Review 模板与输出要求执行。
7. 治理授权：按 ES-ENG-001 与 `AGENTS.md` 第 8 节取得全部适用的记录（Founder Approval、Engineering Authorization、exception `ACTIVE` 记录），适用者缺一不可。
8. FIELD 验收：按 `AGENTS.md` 第 11 节，只有真实设备 / 真实环境的验收证据才能构成 `FIELD VERIFIED`；代理只整理证据，不代替验收人宣布。
9. 没有证据不得宣称已发布、已迁移、已回滚、`FIELD VERIFIED` 或 `CLOSED`。

L3 任务的 Founder Gate 至少出现在：需要 Readiness / Authorization 时的开工授权、合并 main、migration 与部署、正式安装包或发布。

### 3.5 判级速查

| 任务特征 | 默认等级 |
| --- | --- |
| 文案、翻译、样式微调、文档 typo、单点低风险 Bug | L1 |
| 新页面、新 API、多文件业务流程、页面级 / 接口级权限判断 | L2（命中 ES-ENG-001 Readiness 触发条件时开工授权为 Founder Gate） |
| 新增或实质修改工作流、治理规则、SOP、仓库技术文档 | L2 |
| 只读审计 | 只读执行，报告中给出建议等级 |
| 数据库、支付、打印、安装包、身份权限、多租户、公共合同变更、Production | L3 |
| 修改 FINAL / Freeze 资产、Scope Guard 配置、exception 记录、CI 或发布用的 GitHub Actions workflow 文件 | L3 |
| 同时具有多项特征 | 取最高 |

## 4. 主执行代理模式

主执行代理（通常是 Codex）对任务的推进负全责，不得把可以自主完成的工作转交给用户。主代理负责：

- 阅读真实代码、配置、脚本、CI、已有测试和治理规则，不凭记忆或历史报告下结论；
- 在授权 Scope 内自主选择合理实现，遵循现有架构、认证、权限、租户隔离、i18n、API 错误格式和数据约束；
- 编写和运行必要的测试与检查，并如实报告结果；
- 修复范围内发现的问题，包括自己引入的问题和独立审查发现的范围内问题；
- 调用全新上下文的独立审查子代理（L2 / L3）；
- 创建并维护任务状态记录（L2 / L3 必须，L1 可选）；
- 把工作持续推进到真正的 Founder Gate，然后按第 7 节格式停下。

以下情况不是暂停理由，主代理必须自行处理并继续：

- 阶段编号、批次编号或步骤切换；
- 普通测试失败、类型错误、构建失败、lint 失败，只要可在授权 Scope 内修复；
- 独立审查发现的范围内问题；
- 需要读取更多代码、文档或平台只读状态；
- 工具、插件或连接器可用性变化（不构成授权，也不构成阻断）。

环境阻塞（例如测试无法在当前环境运行）不是 Founder Gate，但必须在汇报中如实标记“未验证”及原因，不得表述为 PASS。

## 5. 独立审查

### 5.1 定义

独立审查是由与实现者不共享对话上下文的全新上下文子代理执行的只读审查。

“全新上下文”指：审查者只接收明确交付的材料，不继承主代理的对话历史、中间推理和结论。交付材料限于：

- 任务目标、Scope 与非 Scope；
- 冻结边界；
- 基线 SHA、任务分支与完整 diff（或可访问的 worktree 路径）；
- 任务状态记录；
- 相关治理资产（`AGENTS.md`、本文档、ES-ENG-001、涉及的冻结文档或合同）。

“只读”指：审查者不修改文件、不 commit、不运行会改变仓库或外部状态的命令。审查者发现问题只报告，不修复。

### 5.2 审查输出

审查输出固定包含：

1. PASS / FAIL
2. Blocking Issues
3. Non-Blocking Issues
4. Boundary Violations（Scope、冻结边界、Scope Guard）
5. Missing Evidence
6. Architecture Risks
7. Acceptance Recommendation
8. Reviewer Declaration：实际收到的材料清单；是否与实现者共享对话上下文；是否修改过任何文件

审查者必须区分“已核实”与“推断”，并对无法核实的项标记 `UNKNOWN`。

### 5.3 与 ES-ENG-001 Claude Review 的关系

- 本节的独立审查是 L2 任务的最低审查要求。
- 命中 ES-ENG-001 Claude Review 强制清单的任务，必须按 ES-ENG-001 的 Claude Review Request 模板与输出要求执行审查；本节不替代该要求，也不降低它。
- ES-ENG-001 明确不要求 Claude Review 的情形（例如 typo-only 文档修正）如属 L1，也不要求本节的独立审查。

### 5.4 不构成独立审查的情形

- 主代理自己复查自己的 diff；
- 与主代理共享同一对话上下文的子代理或“换个提示词再问一遍”；
- 只审查摘要或历史报告而未读取真实 diff；
- 审查者同时修改了代码。

以上情形只能记为“自审”。当前平台不支持全新上下文子代理时，主代理必须在任务状态记录与最终汇报中写明“独立审查：未执行（仅自审）”，并把它作为合并前的 Founder Gate 事项交由 Founder 决定：接受自审、指定外部审查者，或暂缓合并。不得把自审称为独立审查。

## 6. Founder Gate

### 6.1 必须暂停的条件

只有以下情况，代理必须暂停并按第 7 节输出 `FOUNDER DECISION REQUIRED`：

- 扩大业务范围：完成任务需要超出用户明确目标的改动；
- 修改数据库：schema、migration、生产数据；
- 修改冻结能力或公共合同：FINAL / Freeze 资产、Scope Guard forbidden paths、第 3.2 节定义的公共合同；
- 降低安全、可靠性或治理约束：放宽认证、权限、租户隔离、幂等、校验、Guard 或本工作流的任何要求；
- 需要新的外部权限或破坏性操作：新依赖、新服务、新环境变量、新平台资源、reset / drop / db push / 删除数据等；
- 合并 main；
- migration、Preview 或 Production 部署；
- 正式安装包或发布；
- 独立审查发现无法在批准范围内修复的问题；
- 无法完成真正独立审查但准备进入合并（第 5.4 节）。

以上清单与下列上位清单取并集，任一命中即为 Founder Gate：

- ES-ENG-001 的 Founder Approval 强制清单；
- ES-ENG-001 的 “Readiness is mandatory” 触发条件（此时开工授权是 Founder Gate）；
- `docs/workflows/STORE_ASSISTANT_DEV_WORKFLOW_SKILL_V1.md` 第 8 节“必须暂停并汇报的高风险情况”。

### 6.2 授权的判定

- 任务指令中逐项明确写出的授权视为已批准，代理不必就同一事项再次请求。本条不适用于 Level 0 资产、FINAL / Freeze 资产和 Scope Guard forbidden paths：Level 0 资产只能按 ES-GOV-001 Evolution Rule 以 V2 / Addendum / 新治理文档演进；FINAL / Freeze 资产只能走其正式治理流程并取得 ES-ENG-001 的 Founder Approval 记录；forbidden paths 只能凭 `docs/change-gates/exceptions/` 中 Founder-approved 的 `ACTIVE` 记录放行。任务指令或对话中的确认都不构成这三类事项的授权。
- 合并 main、migration、Preview / Production 部署、正式安装包或发布这四类动作，每次执行前必须在汇报中复述所依据的授权原文；授权必须指向本任务的本次动作，不得沿用其他任务或以往对话的授权，也不得以“完成任务”为由推定授权。
- push 任务分支的授权不自动等于 Preview 部署的授权；若 push 会触发平台自动 Preview 部署，必须一并取得 Preview 部署授权。
- 工具、插件或连接器可用不构成授权。
- 授权不明时按未授权处理，fail closed。

### 6.3 暂停时的行为

- 保持 worktree 与分支完整，不清理、不回滚、不覆盖用户或其他代理的改动；
- 更新任务状态记录的 `Current Blocker` 与 `Founder Decision Required`；
- 输出 `FOUNDER DECISION REQUIRED` 块，然后停止，不预执行任何待批准动作。

## 7. 汇报格式

### 7.1 中间汇报

- 每个阶段结束只输出一段简短状态：当前状态、已经通过、下一步。
- 不重复输出长篇历史报告，不重复粘贴 diff、日志或测试输出全文；过程证据写入本地任务状态记录或 evidence 文件，汇报中给路径。
- 不输出 secrets、tokens、连接串或敏感用户数据。

### 7.2 需要决策时

只输出以下块，不附加其他叙述：

```text
FOUNDER DECISION REQUIRED

当前状态：
已经通过：
真实阻断：
影响：
可选方案：
推荐方案：
需要Founder批准：
```

填写要求：`真实阻断` 必须是第 6.1 节中的具体条目；`可选方案` 至少给出两个并说明各自代价；`需要Founder批准` 逐项列出，便于 Founder 逐项回复。

### 7.3 最终汇报

最终汇报按 `AGENTS.md` 第 12 节只报告事实，并至少包含：

- 任务 ID 与任务等级（含判定依据）；
- 基线 SHA、分支、worktree 路径；`origin/main` 在工作期间是否变化；
- 改动文件与改动范围；
- 验证：实际运行的检查及真实结果；未运行或未验证的项及原因；
- Scope Guard 结果；Release Lineage Gate 结果或 Docs-only Exception 的判定依据；
- 独立审查状态：已执行（PASS / FAIL，剩余问题）/ 未执行（仅自审）；
- Git 状态：commit hash 或“未 commit”；是否 push；
- 外部操作：是否合并、部署、migration、发布，及依据的授权；
- 风险与待验项；
- 停止点声明（第 11 节）。

## 8. 任务状态记录

- 性质：活跃任务的实时状态，默认在本地维护，供主代理和子代理读取；不是每个任务的强制入库文件。
- 位置：任务 worktree 根目录下的 `.task-state/<TASK-ID>.md`。默认不 `git add`、不进入任务 diff 和 commit；Scope Guard 以显式文件列表（`--files`）调用，不把该目录列入。建议在创建记录前把 `.task-state/` 加入本机 `.git/info/exclude`（位于共享的 `.git` 目录，对同一仓库的全部 worktree 生效；不修改仓库 `.gitignore`），否则 `AGENTS.md` 第 4 / 5 节与 Release Lineage Gate 的 clean 检查会把该目录视为 DIRTY 而 fail closed。
- 任务 ID 以任务指令给定的为准；缺失时主代理按 `TASK-<主题>-<序号>` 生成并在首次汇报中声明（不使用 `ES-` 前缀，该前缀保留给 Level 0 与 ES-ENG-001 定义的正式治理记录）。
- 模板：`docs/workflows/E_SHOP_TASK_STATE_TEMPLATE_V1.md`。
- L2 / L3 任务必须创建；L1 任务可选。
- 创建时机：判级之后、修改业务代码之前。
- 更新时机：阶段变化、独立审查结果、Founder Gate 触发、Founder 决策落地、任何交接之前。
- 任务状态记录是代理之间的交接来源，但不能取代 Git、测试、真实代码和发布证据。记录与真实状态冲突时，以真实状态为准并立即修正记录。
- 接手任务的代理必须先读取任务状态记录，再用 Git 与真实代码核实其中的每一项声明，不得直接沿用。
- 永久证据：任务完成后的永久证据使用仓库既有的 Acceptance Record、Freeze Record、Evidence Pack 等 ES-ENG-001 定义的正式记录，或 `AGENTS.md` 第 12 节要求的正式开发记录；本地任务状态记录不作为永久证据，任务 CLOSED 后可归档到本地或删除。
- 只有任务指令或适用治理记录明确要求时，才把任务状态记录入库；此时按 ES-ENG-001 的 commit 规则单独提交，不与 runtime 改动混在同一 commit。

## 9. 防漂移规则

事实与指令的优先级：

```text
系统及用户明确指令
→ 仓库AGENTS.md（含当前目录链中的嵌套 AGENTS.md / AGENTS.override.md）
→ Founder-Gated工作流（本文档）
→ 当前任务状态记录
→ 对话记忆和历史报告
```

规则：

- 内容冲突时，使用优先级更高且更新的真实来源；不得凭对话记忆或历史报告推翻仓库规则。
- 用户明确指令优先，是因为 Founder 是本仓库的最终批准人。指令若触及本文档的 Founder Gate，代理按第 7.2 节请求明确确认，Founder 的明确确认即为授权（下一条所列三类事项除外）。
- 指令若要求修改 Level 0 资产、FINAL / Freeze 资产或 Scope Guard forbidden paths，对话确认不构成授权：代理必须指出冲突，输出第 7.2 节决策块并停止，只能通过第 6.2 节所列的正式治理记录解决；不得默默执行，也不得默默拒绝。
- `AGENTS.md` 是路由器：它指向的权威资产（Level 0 治理文档、Scope Guard、Release Lineage Gate、冻结文档、脚本与 CI）以原文为准，本文档和 `AGENTS.md` 中的摘要都不替代原文。
- 对话记忆和历史报告只能作为线索；据以行动前必须用仓库、Git 与平台真实状态核实。
- 平台读取结果必须区分仓库事实、线上事实与推断；无法核实的标 `UNKNOWN`，影响开工、迁移、发布或 Closure 的 `UNKNOWN` 一律 fail closed。

## 10. 与现有治理资产的关系

| 资产 | 关系 |
| --- | --- |
| `AGENTS.md` | 保持精简路由器；只增加指向本文档的强制入口。本文档的每一条要求都以 `AGENTS.md` 现有规则为下限，不削弱其任何一条。 |
| ES-GOV-001 / ES-ENG-001（Level 0） | 本文档位于 Level 0 之下。冲突时 Level 0 优先；本文档不定义 Readiness、Authorization、Acceptance、Freeze 的替代流程，只规定何时必须进入这些流程。 |
| `docs/workflows/STORE_ASSISTANT_DEV_WORKFLOW_SKILL_V1.md` | 继续规定具体技术路径：Release Lineage Gate 操作、build / smoke、production migration、Browser 与真机验收、Obsidian 冻结、P0–P3 优先级、必须先审与必须暂停的清单。本文档规定代理执行模式与风险等级，两者并行适用；本文档不放宽该工作流的任何要求，同一事项两者表述不同时按 `AGENTS.md` 第 1 节的同层冲突规则处理。 |
| Scope Guard（`scripts/guards/check-change-scope.js`） | 与任务等级无关的硬门禁。任何等级的任务 commit 前都必须以 Guard 实际输出判定；需要 forbidden paths 时走 exception 机制并构成 Founder Gate。 |
| Release Lineage Gate（`scripts/check-release-lineage.sh`）与 Docs-only Exception | 与任务等级无关。任何等级的新开发线路都必须通过 Lineage Gate 或满足 `AGENTS.md` 第 6 节例外的全部条件。 |
| FIELD VERIFIED / CLOSED（`AGENTS.md` 第 11 节） | 原样适用。任务等级不改变证据要求。 |

本文档没有引入任何新的放行路径。

## 11. 停止点

代理在 Founder Gate 停止时，除第 7.2 节的决策块外，还必须写明停止点声明：L2 / L3 写入任务状态记录并在最终汇报中复述；L1 无任务状态记录时写入最终汇报。

```text
STOP POINT
Task Level = L1 / L2 / L3
Business Code Changed = YES / NO
Database Changed = YES / NO
Commit = <hash> / NONE
Push = NONE / <branch>（依据的授权）
Merge Main = NO / YES（依据的授权）
Deployment = NO / YES（依据的授权）
Migration = NO / YES（依据的授权）
Production = NO / YES（依据的授权）
Other Worktrees Modified = NO
Worktree = <path>（完整保留）
```

任一项在未授权情况下为 YES 或非 NONE，视为违反本工作流，必须在汇报中如实说明。`Other Worktrees Modified` 只允许为 NO。

## 12. 演进

- 本文档为 V1.0。修订通过新的治理文档任务进行（默认 L2），产出 V1.x 或 V2.0，合并进入 `origin/main` 后生效。
- 修订不得削弱 Level 0、`AGENTS.md`、Scope Guard 或 Release Lineage Gate；若需要削弱，属于 Founder Gate 中的“降低治理约束”。
- 本文档与 Level 0 发生真实冲突时，按 ES-GOV-001 的 Conflict Rule 暂停相关工作，以 Level 0 为准，并修订本文档。
