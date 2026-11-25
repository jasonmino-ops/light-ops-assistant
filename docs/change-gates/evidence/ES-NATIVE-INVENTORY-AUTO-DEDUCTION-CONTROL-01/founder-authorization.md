# Founder authorization — verbatim task message

Source: Founder user message in the current Codex conversation, received 2026-11-25.
Recorded by: Codex (recorder only, not an independent approver).
Scope: engineering signoff, non-regression disposition, candidate commit and Cloud CI. No production permission.

--- BEGIN VERBATIM ---
ES-NATIVE-INVENTORY-AUTO-DEDUCTION-CONTROL-01

目标

完成当前 L3 本地候选的正式工程验证，使其达到 READY FOR RELEASE AUTHORIZATION。

业务功能已实现，不再扩大开发范围。

当前候选

Git Tree：

bf43fa367ea658d024d2cc8a7da07091076f523b

共11个修改文件。

已有专项测试18/18、隔离迁移验证81/81、Build、TypeScript及独立技术审查通过。

授权与要求

1. 完成精确封存包的 Scope/Frozen 签认，核对全部11个文件是否属于此前批准的业务目标及最小库存门禁修订。
2. 完成 CORE 4项既有失败的差异归因与正式处置。
    若能够证明失败原因、诊断及影响范围与可信基线一致，且不涉及本次库存记账、退款冲正、并发或数据完整性风险，则按现有非回归例外机制处理。
    不得将 FAIL 改写为 PASS，不得自行豁免相关核心风险。
3. 在签认和必要门禁满足后，生成正式 Candidate Commit，执行 Cloud CI 和现有适用验证。
4. 复用已有专项测试、迁移验证和独立审查证据。仅在候选内容、基线或验证条件发生实质变化时重新执行相关检查。
5. 准备最小发布及 Migration 执行方案，明确数据库与应用版本兼容性、发布顺序、失败恢复和回滚边界。

不可破坏

* POS/H5 销售与支付核心
* 原生库存账本
* 已执行历史 Migration
* 现有进货及库存纠错
* 门店权限隔离
* H5 退款回补关闭状态

禁止

* 扩大业务范围
* 重构库存系统
* 修复无关历史技术债
* 新建发布基础设施
* 执行 Production Migration
* 部署 Production
* 开启 Diamond 自动扣减

执行原则

在现有授权范围内自主完成签认、测试、提交及候选准备。

优先复用现有工程治理和可信发布机制。

不重复已完成的审计，不为普通执行步骤反复申请 Founder 授权。

如发现超出既有批准范围的文件、真实核心回归或新的业务风险，只报告必要的 Founder 决策。

完成标准

最终仅报告：

* Scope/Frozen 签认结果
* CORE 既有失败处置结果
* Candidate Commit SHA
* Cloud CI 结果
* Migration 与应用发布顺序
* 回滚及恢复方案
* 是否 READY FOR RELEASE AUTHORIZATION
* 剩余 Founder Gate

完成后停止，等待正式生产发布授权。
--- END VERBATIM ---
