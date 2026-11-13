# ES-INVENTORY-MERCHANT-PRODUCTION-UI-01

Founder approval was received in the current task conversation. The approval explicitly binds source commit 24528f1e346b2c83913bdfa0a841b5e0ca6a6fd4 and release candidate 1f33d03bcba0bc5d2173be7afe0e3cb0694345c8. This is a transcription of the relevant authorization, not a separate signature.

> Founder 正式批准本轮商品中心四按钮 UI 发布。
>
> 3. 若满足安全快进条件，将指定源提交合入 main。
> 4. 按既有受保护发布流程完成冻结入口变更的精确签认。
> 5. 对四项历史 CORE 失败登记基线例外：必须证明候选与当前 Production 的失败用例、断言及结果一致，无新增失败，不得标记为 PASS。
> 6. 完成绑定发布候选 SHA 的 Release Lineage、Scope Guard、Build 和指定发布校验。
> 7. 全部满足后，将四按钮 UI 发布到正式 E-Shop Production。
> 8. 第四按钮继续指向现有 /inventory，不启用原生进销存，不执行数据库迁移。

The frozen surface approval covers the position, style and label of the product-center inventory entry, as scoped in the approved candidate. The Pilot inventory page and API, tenant access, database, and external ledger remain unchanged. The rollback deployment is dpl_AXvQyPsbGk3nXvARQG3GWLsKABBu.
