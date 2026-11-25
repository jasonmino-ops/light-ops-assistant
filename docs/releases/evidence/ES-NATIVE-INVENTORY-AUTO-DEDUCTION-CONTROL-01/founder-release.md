# Founder authorization — verbatim task messages

Recorded by Codex. These are the user's actual task instructions, not an independent or App signature.

## Production Release Authorization

ES-NATIVE-INVENTORY-AUTO-DEDUCTION-CONTROL-01

Founder Production Release Authorization

授权

Founder 批准以下精确候选进入 Production：

Candidate SHA：
1f4e3acb8455a72b2aabd3885c3db161607aad25

封存产品 Tree：
bf43fa367ea658d024d2cc8a7da07091076f523b

批准已签认的11个文件及唯一新增 Migration（80→81）。

接受已正式登记的 CORE 基线非回归限定处置，保留真实 99/103、4 FAIL/BLOCKED 记录。

目标

完成老板端销售自动扣减控制开关及 POS 库存冲正修订的正式生产发布。

发布要求

复用现有可信选择性发布机制和已完成的工程验证证据，不重复建设治理基础设施。

发布前核验实际 Production、release、数据库迁移基线、精确候选及 Diamond 自动扣减 OFF 状态。

确认发布差异不夹带其他未授权功能。

按已验证的顺序执行：

Diamond 保持 OFF → 发布兼容应用 → 执行唯一新增 Migration → 核验应用与数据库最终状态。

必须确保 schema80 至 schema81 过渡期间，老板不能提前开启自动扣减，且销售、退款及库存流水不会产生错误记账。

若无法保证过渡窗口安全，停止发布并报告最小处置方案。

不可破坏

* POS/H5 销售及支付主线
* 已有库存流水和审计记录
* 进货、库存查询及数量纠错
* 门店与租户隔离
* 已执行的历史 Migration
* H5 退款回补关闭状态

禁止

* 擅自开启 Diamond 自动扣减
* 修改其他门店开关
* 执行其他 Migration
* 发布未授权功能
* 扩大产品修改范围
* 新建发布基础设施
* 自动补记历史遗漏流水
* 未经现场验收宣布 FIELD VERIFIED 或 CLOSED

异常处置

优先前向修复，保留库存流水及审计证据。

若需回退旧应用，遵守已确认的 Diamond 退款暂停与对账要求。

不得将整库恢复视为无损回滚，不得擅自执行破坏性恢复。

完成标准

* Production READY，实际 SHA 与正式授权发布候选一致。
* 唯一新增 Migration 成功，迁移记录完整。
* 老板端控制开关正式可用。
* Diamond 自动扣减仍为 OFF。
* 其他门店状态不变。
* 生产基础回归及库存一致性核验通过。

完成后停止，等待 Founder 真实门店 FIELD 验收及启用决定。

最终仅报告 Production SHA、Migration 状态、发布门禁、Diamond 实际开关状态、生产验证结果及剩余 FIELD 事项。

## Existing signer adaptation authorization

ES-NATIVE-INVENTORY-AUTO-DEDUCTION-CONTROL-01

Founder 决策

批准现有受保护签发器针对本候选的最小适配，继续此前已授权的 Production 发布及唯一新增 Migration。

目标

完成老板端自动扣减控制开关交付，不扩大为发布基础设施重构。

边界

* 保持已封存11个产品文件及候选不变。
* 复用现有 Validator、App 5590705 和 release 保护。
* 不重复申请已有产品及发布授权。
* 不新增 CI/CD、GitHub App 或权限体系。
* 不擅自修改 Pilot 绑定及 Feed 状态。
* Diamond 保持 OFF，启用条件未满足时必须可靠拒绝开启。
* 确保应用与 Migration 过渡窗口安全。

完成标准

在满足原发布条件后，完成可信签发、Production 部署、Migration 80→81及生产核验。

如存在必须单独批准的治理合并或新的实质风险，仅报告最小 Founder 决策项。

另外，只读说明：

1. 为什么现有签发器仍绑定旧 ST04 候选？
2. 下一次发布是否仍需要修改签发器代码？
3. 是否可以通过可信的结构化授权记录传入候选参数，实现固定签发器复用？

本轮不实施签发器通用化重构，将相关发现登记为后续平台优化建议。

完成发布后停止，等待真实门店 FIELD 和老板自主启用。
