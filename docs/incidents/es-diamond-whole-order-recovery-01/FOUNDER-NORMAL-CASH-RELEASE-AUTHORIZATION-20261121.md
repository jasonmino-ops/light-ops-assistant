# Founder normal CASH release authorization receipt

Task: ES-DIAMOND-NORMAL-CASH-QUERY-FIX-01
Authorization ID: FOUNDER-NORMAL-CASH-20261121T151917Z-7FCE45320D08
Collected at UTC: 2026-11-21T15:19:17.000Z (actual first clock observation after user authorization, not invented message send time).
Authority: explicit Founder approval in this Codex conversation. External message ID: unavailable; none fabricated.
Execution GitHub actor: jasonmino-ops (id268623006); this actor records the approval and is not a substitute human field signatory.
Approval window ends 2026-11-21T17:19:17.000Z or current night shift end, whichever earlier.
Main implementation tree: 109d94c6771d0ed0791ed4d9b3e27b363259c45d
Runtime tree: 636e1d0b37bd9bb8adcc5df9a94b5ced926acd3c
Controller commit: 45b65b45af9e0eb594a9b5565449e2a412a0d005
Manifest SHA256: 4b0cd607dd4375c04d0e7337c4a49145848d9ace219f7e266af12448f70dc2a7
Reviewed Gate SHA256: a9c9ca5e6b2d2ef95a35113a7bc3290827dfdcbeb622d367a421f2d851e9f5e2

No permission to change unrelated bytes, database history, scope/rulesets/project settings, repeat unknown transactions or printing. WB human field conditions are mandatory. The Gate fallback was not explicitly included in the latest approval; no traffic rollback is exercised under this receipt.

## Exact approval text

**Founder APPROVED — ES-DIAMOND-WHOLE-ORDER-RECOVERY-01**

批准本次正常 CASH 收银最小修复方案，授权范围：

1. 完成精确 Scope 登记、可信来源准入、必要的单行发布校验修正及受保护签发。
2. 在 Scope、Lineage、构建和独立审查全部 PASS 后，允许最小 Production 部署。
3. 允许发布流程必需的最多3个受保护 Preview 构建尝试，不允许额外业务变更。
4. WB 真人确认现场执行人、接票人、打印纸和有效静默窗口后，允许店员对原 USD135.43 挂单执行**一次正常 CASH 结账**。
5. 允许通过现有打印链路生成并打印一份前台小票。

**必须满足：**

- 54行、92销售单位、USD135.43。
- 只生成一笔销售和一条 CASH/PAID 付款。
- 不再向顾客收取现金。
- 按真实结账时间计入当前夜班。
- 11月20日已收现金，本班新增实际收款为0，交班时注明。
- 明早08:00重新生成交班报表，核对包含该笔销售。
- 任何超时、UNKNOWN或结果不确定，立即停止，先只读核查，不允许重复提交或打印。

**禁止：**

- 不修改无关业务功能。
- 不修改生产数据库历史数据。
- 不拆单、不重复收款。
- 不绕过发布保护或现场确认。
- 不修改原始挂单备份。
- 不扩大生产发布范围。

本次授权仅针对已审查的正常收银查询并发修复及上述必要发布动作。

如实际 Scope、来源映射、发布保护或现场条件与上述事实不一致，立即停止并报告，不得自行扩大授权。

**执行完成后只汇报：**

- Production 部署结果及 SHA
- 唯一销售订单号、CASH/PAID
- 实体小票是否成功
- 当前夜班销售是否包含 USD135.43
- 是否 CLOSED
