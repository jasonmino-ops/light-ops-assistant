# AGENTS.md

本文件是 E-Shop 仓库的 Codex 长期执行入口。
用户只需描述“开发什么 / 修什么 / 审计什么”；Codex 自动分类任务、读取权威资产并执行适用门禁。

## 1. 权威来源

- 用户当前任务中的明确指令优先于本文件；本文件负责补齐用户没有重复说明的默认开发纪律。
- 先读取本文件及当前目录链中更深层的 `AGENTS.md` / `AGENTS.override.md`。
- 治理原则以 `docs/governance/ES-GOV-001 Level 0 Governance Baseline V1.0 FINAL.md` 为准。
- 工程流程以 `docs/governance/ES-ENG-001 Engineering Workflow Baseline V1.0 FINAL.md` 为准。
- 具体开发工作流以 `docs/workflows/STORE_ASSISTANT_DEV_WORKFLOW_SKILL_V1.md` 为准。
- 所有开发、工作流、仓库审查、构建和发布任务，开始前必须读取并遵守 E-Shop Founder-Gated Agent Development Workflow V1.0（`docs/workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md`），并先确定任务等级（L1 / L2 / L3）。
- Scope Gate 以 `scripts/guards/check-change-scope.js` 及其当前配置为准。
- Release Lineage Gate 以 `scripts/check-release-lineage.sh` 的当前实现为准。
- 数据库、部署、验收等专项规则，以仓库内当前冻结文档、脚本和 CI 为准。
- 权威资产冲突时：更高层治理优先；同层以更具体且更新的已批准资产优先。
- 不复制权威资产全文，不用本文件中的摘要替代原文。
- FINAL / Freeze 资产不得在普通开发任务中顺手修改；确需变更时走其正式治理流程。

## 2. 自动任务分类

- 收到请求后，先判断属于：只读审计、治理/文档、代码修复、功能开发、数据库/基础设施、发布或 Closure。
- 用户未要求修改时，只读检查并报告，不产生外部写入或状态变化。
- 用户要求“开发”或“修复”时，默认完成最小实现、验证和可审计交付。
- 用户要求发布、迁移、合并或 Closure 时，追加对应高风险门禁。
- 任务类型不明确但可从仓库和真实平台状态判断时，Codex 自行判断并说明。
- 只有会实质改变范围、风险或外部状态的关键歧义，才请求用户决策。
- 不要求用户重复本文件、Release Lineage、Scope、测试、部署或 Closure 提示词。

## 3. Scope 与授权

- 以用户明确目标为唯一业务 Scope，实施满足目标的最小改动。
- 不顺手重构、扩功能、迁移架构、替换依赖、清理邻近代码或修无关问题。
- 若必要改动超出原 Scope，先说明原因、影响、替代方案与所需授权。
- 先检查当前 diff；用户已有改动一律保留，避免覆盖和混入。
- 插件、连接器或工具可用，不构成扩大 Scope 或执行写操作的授权。
- Production deploy、main merge、生产 migration、破坏性操作及其他受控动作，必须取得对应明确授权。
- 不以“完成任务”为由推定高风险授权。
- 不输出 secrets、tokens、连接串或敏感用户数据。

## 4. 开工前自动检查

- 读取相关代码、配置、文档、package scripts、CI 和现有测试，确认真实实现方式。
- 检查 Git status、当前 branch/worktree、remote 与目标基线。
- 判断是否影响 runtime、build、workflow、script、dependency、database、infrastructure 或 deployment。
- 判断是否涉及认证、权限、租户隔离、订单/支付、数据写入或稳定入口。
- 按 ES-GOV-001 / ES-ENG-001 确定 Readiness、Authorization、Review 与 Founder Approval 要求。
- 发现工作区不干净、基线不明或权威资产冲突时，先保护现场并 fail closed。
- 不修改业务代码，直到适用的开工门禁满足。

## 5. 开发线路与 Release Lineage

- 每项实现任务使用独立 `codex/*` branch，并在隔离 worktree 中执行；如果 Codex 当前已经位于安全隔离的独立 worktree，优先复用当前 worktree，不重复创建。
- 开发基线必须来自最新、干净的 `origin/main`，不得从漂移分支继续开线。
- 除第 6 节例外外，开线前主动取得当前 Production Git SHA。
- 执行 `git fetch origin`，并在准备作为基线的干净 worktree 运行：
- `./scripts/check-release-lineage.sh <production_sha>`
- 只有脚本确认安全开发基线后，才可创建线路或开始实现。
- Production SHA 缺失、读取失败、无法判定、工作区脏或 lineage 不通过时，一律 BLOCKED。
- “origin/main 最新”不等于 Production 已进入 main 血统。
- 未经授权，不 push、不建或合并 PR、不合并 main、不部署。

## 6. Governance / Docs-only Exception

- 本例外只豁免“开线前取得 Production SHA 并运行 Release Lineage Gate”。
- 仅当计划 diff 与最终 diff 都是纯文档或治理说明时，才可使用。
- 纯文档指只改变说明性文本，不改变项目可执行行为、自动化实现或线上状态。
- 允许对象限于文档文件及 `AGENTS.md` 一类治理说明。
- 不得仅凭扩展名判断；必须检查完整 diff 和文件用途。
- 任何 runtime、build、workflow、script、dependency、database、infrastructure 或 deployment 影响都会使例外失效。
- 代码、配置、脚本、CI、schema、migration、lockfile、部署描述或平台设置变化均不得使用本例外。
- 若文档变更同时夹带或要求本次配套改变上述非文档资产，也不得使用本例外。
- 混合 diff、影响不明或无法证明纯文档时，按普通 Release Lineage Gate 执行。
- 使用例外仍须 `git fetch origin`，从 clean `origin/main` 建立独立 `codex/*` branch/worktree。
- 使用例外仍须执行 Scope 检查、diff 校验、文档校验和正常交付报告。
- 本例外不授权 main merge、Production deploy、migration 或任何破坏性操作。
- 最终报告必须明确写明是否使用本例外及判定依据。

## 7. 真实状态与工具

- 与任务相关时，主动使用已安装的 GitHub、Vercel、Supabase、Cloudflare、Sentry 等能力读取真实状态。
- 能自行读取的信息，不要求用户手工复制。
- 只读取完成当前任务所需的最小数据，不因工具可用而扩大检查或操作范围。
- 平台读取结果必须区分仓库事实、线上事实与推断。
- 线上读取失败、权限不足或证据冲突时标记 `UNKNOWN`，不得猜测或把缓存当当前状态。
- `UNKNOWN` 若影响安全开工、迁移、发布或 Closure，必须 fail closed。
- 外部写操作仍受 Scope 与授权约束。

## 8. 实施与 Scope Gate

- 遵循现有架构、认证、权限、租户隔离、i18n、API 错误格式和数据约束。
- 以局部修复优先；公共层、稳定流程和数据库变更需有明确必要性。
- 新增依赖、服务、环境变量或平台资源前，先说明必要性和影响并取得授权。
- 实施中持续检查 `git diff`，及时移除无关改动。
- commit 前运行当前 Scope Guard；以其实际输出判定 PASS / BLOCKED。
- Scope Guard 默认拒绝 `gate-config.json` 中的全部 forbidden paths；不传 `--task-id` 时不得应用任何例外。
- task-scoped exception 仅在 `origin/main` 的 `docs/change-gates/exceptions/` 中存在 Founder-approved `ACTIVE` 记录时可用；working-tree exception 与 `gate-config.json` 必须分别和受信 blob 一致，Guard 还必须校验 task ID、当前 Git branch、获批 commit 血统、精确文件路径和已批准内容 SHA-256。
- exception 不得使用目录或 wildcard；feature 合并后必须把记录改为 `CLOSED`，治理记录保留但不得继续放行。
- Scope Guard 通过不替代测试、审查、验收或发布授权。

## 9. 验证

- 从当前代码、package scripts、CI、冻结文档和已有测试中发现应运行的验证，不维护静态测试清单。
- 至少运行与改动面直接相关的测试、类型/静态检查和构建检查。
- 纯文档任务执行权威资产要求的检查；若构建不适用，明确报告 N/A 及依据。
- 发布候选必须执行当前权威资产要求的完整门禁与回归。
- 不跳过已有且与改动或发布相关的检查。
- 测试失败、未运行或受环境阻塞时如实报告；不得表述为 PASS。
- CI 未触发、平台未返回或人工验收未进行，不等于通过。

## 10. 数据库、基础设施与发布

- 数据库与基础设施改动只在用户 Scope 明确包含且治理授权满足时执行。
- schema、migration 与运行时兼容性必须成套审查，build 与 migration 分离。
- 生产 migration、资源变更、密钥变更、流量切换、回滚和部署均需明确授权。
- 发布前重新读取目标平台、commit、环境和 lineage 的真实状态。
- 发布后验证实际部署 commit、健康状态和与本次变更相关的关键路径。
- 无证据不得声称已部署、已迁移、已回滚或线上正常。

## 11. FIELD VERIFIED 与 CLOSED

- Codex 的本地测试、模拟器、自动化浏览器和 Preview 验证均不能自行产生 `FIELD VERIFIED`。
- `FIELD VERIFIED` 只能来自真实设备 / 真实环境的实际验收证据及其明确记录。
- Codex 可以整理证据并报告待验项，但不得代替验收人宣布 `FIELD VERIFIED`。
- `FIELD VERIFIED` 不等于 `CLOSED`。
- `CLOSED` 必须同时有：验收通过、变更进入 `origin/main`、Production 包含对应变更且与 main 血统一致、要求的回归无已知退化。
- Closure 时重新读取 GitHub 与 Production 真实状态并执行适用 lineage 检查。
- 任一证据缺失或为 `UNKNOWN` 时，状态保持 OPEN / BLOCKED，不得宣布 CLOSED。

## 12. 文档与交付

- 按权威治理文档判断是否需要项目文档、Obsidian 开发记录、SOP、冻结材料或验收记录。
- 企业知识沉淀只写入真实 Obsidian Vault；项目技术文档只写入仓库 `docs/`。
- 不得把企业开发记录误写进仓库同名目录。
- 只读审计、方案讨论或未落地草案默认不生成开发完成记录。
- 写入仓库外 Vault 前确认当前权限；无法写入时给出完整待落文内容和目标路径。
- 最终回复只报告事实，并包含：任务类型、改动范围、文件、验证、Git 状态、外部操作、风险和待验项。
- 有 commit 时报告 hash；无 commit 时明确写“未 commit”，不得虚构。
- 明确报告 Production deploy、main merge、migration、FIELD VERIFIED、CLOSED 与 Obsidian 同步的实际状态。
- 若阻塞，给出阻塞证据、当前 `UNKNOWN`、安全停止点和解除条件。

## 13. 默认完成定义

- 目标在授权 Scope 内完成，diff 最小且无无关改动。
- 适用治理、lineage、Scope、测试、构建、文档和审查门禁均有真实结果。
- 未授权的外部状态未被改变。
- 风险、未验证项和人工验收点已明确交接。
- 只有满足本文件与权威资产的全部适用条件，才可称任务完成。
