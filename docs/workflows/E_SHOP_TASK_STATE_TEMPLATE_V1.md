# E-Shop Task State Template V1.0

> 配套 `docs/workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md` 第 8 节使用。
> 每个 L2 / L3 任务在任务 worktree 的 `.task-state/<TASK-ID>.md` 维护一份本地文件；L1 任务可选。
> 活跃任务状态默认在本地维护，供主代理和子代理读取，不作为每个任务的强制入库文件。
> 任务状态记录是代理之间的交接来源，但不能取代 Git、测试、真实代码和发布证据。接手代理必须用 Git 与真实代码核实其中每一项，再继续。

## 使用规则

- 创建时机：判级之后、修改业务代码之前。
- 更新时机：阶段变化、独立审查结果、Founder Gate 触发、Founder 决策落地、任何交接之前。
- 每个字段都填事实，不填计划性措辞；未知写 `UNKNOWN`，未做写 `NONE`，不适用写 `N/A`。
- SHA 写完整哈希或至少 7 位短哈希；路径写仓库相对路径或绝对路径。
- 不写 secrets、tokens、连接串或敏感用户数据。
- 记录默认不 `git add`、不进入任务 diff 和 commit；建议在创建记录前把 `.task-state/` 加入本机 `.git/info/exclude`（对同一仓库的全部 worktree 生效；不修改仓库 `.gitignore`），以免 clean 检查将其视为 DIRTY。
- 任务完成后的永久证据使用仓库既有的 Acceptance Record、Freeze Record、Evidence Pack 或正式开发记录；本记录不作为永久证据，任务 CLOSED 后可归档到本地或删除。
- 只有任务指令或适用治理记录明确要求时才入库，且按 ES-ENG-001 的 commit 规则单独提交。
- 记录不替代 `AGENTS.md` 第 12 节要求的 Obsidian 开发记录、SOP、冻结材料或验收记录。

## 模板

复制以下内容到任务 worktree 的 `.task-state/<TASK-ID>.md`，替换尖括号中的占位内容。

```markdown
# <TASK-ID> Task State

## Task

- Task ID: <TASK-ID>
- Title: <一句话任务名>
- Requested By: Founder
- Primary Agent: <Codex / Claude Code / Claude Desktop / 其他>
- Created: <YYYY-MM-DD>
- Last Updated: <YYYY-MM-DD HH:MM 时区>

## Task Level

- Level: <L1 / L2 / L3>
- 判定依据: <触及了哪些等级特征；多特征时说明取最高的原因>
- 升级 / 降级记录: <NONE / 何时从 Lx 升到 Ly 及原因；降级须写明 Founder 批准依据>

## Goal

<用户明确目标；明确不做的内容>

## Frozen Boundaries

- 不可改动文件 / 目录: <列表，或 NONE>
- 不可改动能力 / 合同: <列表，或 NONE>
- Scope Guard forbidden paths 是否涉及: <YES（列出）/ NO>
- 冻结资产是否涉及: <YES（列出）/ NO>

## Baseline / Branch / Worktree

- origin/main SHA（创建线路时）: <sha>
- Production SHA: <sha / N/A（Docs-only Exception）/ UNKNOWN>
- Release Lineage Gate: <PASS / BLOCKED / N/A（Docs-only Exception，判定依据）>
- Branch: <codex/...>
- Worktree: <绝对路径>
- 工作期间 origin/main 是否变化: <NO / YES（新 SHA，是否与本任务文件重叠）>

## Current Status

<一段话：当前处于哪个阶段，正在做什么>

## Changes

- 改动文件: <列表>
- 改动范围说明: <一段话>
- 是否改业务代码: <YES / NO>
- 是否改数据库: <YES / NO>
- 是否改公共合同 / 冻结能力: <YES / NO>

## Tests

- 已运行的检查及真实结果: <命令 → PASS / FAIL / N/A 及依据>
- 未运行或未验证的项及原因: <列表，或 NONE>
- Scope Guard: <PASS / BLOCKED / 未运行>

## Independent Review

- Status: <NOT STARTED / IN PROGRESS / PASS / FAIL / NOT PERFORMED（仅自审）>
- Reviewer: <全新上下文子代理 / ES-ENG-001 Claude Review / NONE>
- Reviewer Declaration: <审查者收到的材料清单；是否共享上下文；是否修改过文件>
- Blocking Issues: <列表，或 NONE>
- Non-Blocking Issues: <列表，或 NONE>
- 已修复项: <列表，或 NONE>
- 未采纳项及原因: <列表，或 NONE>

## Authorizations

- 已取得的授权（逐项引用原文或记录路径）: <列表，或 NONE>
- 未取得而需要的授权: <列表，或 NONE>

## Current Blocker

<NONE，或第 6.1 节中的具体 Founder Gate 条目及证据>

## Founder Decision Required

<NONE，或粘贴最近一次 FOUNDER DECISION REQUIRED 块>

## Next Action

<下一步由谁做什么；Founder 决策后的执行路径>

## Stop Point

STOP POINT
Task Level = <L1 / L2 / L3>
Business Code Changed = <YES / NO>
Database Changed = <YES / NO>
Commit = <hash / NONE>
Push = <NONE / branch（依据的授权）>
Merge Main = <NO / YES（依据的授权）>
Deployment = <NO / YES（依据的授权）>
Migration = <NO / YES（依据的授权）>
Production = <NO / YES（依据的授权）>
Other Worktrees Modified = NO
Worktree = <path>（完整保留）

## Handoff Log

- <YYYY-MM-DD HH:MM> <代理>: <一行事实>
```
