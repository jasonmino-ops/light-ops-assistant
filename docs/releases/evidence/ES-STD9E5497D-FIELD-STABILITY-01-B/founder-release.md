# 大东北堂食性能 B 精确发布签认记录

FOUNDER_DECISION_UTC=2026-11-28T17:21:36.158Z

来源为本轮 Founder 本人答复，消息 ID msg_01a2232d-399e-7743-8024-d57d78019cbf。以下为本次决策原文。

> Founder 批准 ES-STD9E5497D-FIELD-STABILITY-01-B 本次精确受控 Web 发布。
>
> 授权范围：
>
> - Release：b7776e703a770ea78632d38ac652d0bad6e7379f
> - App 控制提交：6bb804ba5918e06bc24576525c27de6f92a24ec6
> - 仅包含已审查的 B 堂食性能优化。
>
> 执行要求：
>
> 1. 核对精确发布单、Source、Release、控制提交及当前可信 Production 基线。
> 2. 确认本次精确失败处置与已审查证据一致。
> 3. 完成正式 main 准入及真实文件指纹核验。
> 4. 执行一次受保护 App 签发。
> 5. 全部正式守卫通过后，完成限定范围的受控 Web 发布。
> 6. 任一基线、指纹、Scope、Lineage、签发或发布检查失败，立即停止，不得扩大授权。
>
> 发布后：
>
> - 不修改或重启大东北现场 RC6。
> - 不修改 Owner、Lease/Fence 或未决任务0017。
> - 不修改其他商户数据。
> - 不包含 A 打印修复或 C 区域迁移。
> - 不执行数据库迁移。
>
> 验收重点：
>
> - 大东北堂食桌台加载、开桌、账单读取实际耗时。
> - 账单轮询不重叠。
> - 慢响应能够正常显示。
> - 跨桌台、跨商户及权限隔离正常。
> - 原有收银、订单和打印功能不退化。
>
> 完成后报告 Production SHA、部署状态、现场性能对比及剩余问题。
>
> 授权仅在签认单规定的金边时间 2026-11-29 02:00 前有效；超时或候选变化必须重新签认。

## 对应签认单与执行范围

批准精确堂食性能登记、一次App签发及受保护release快进部署。签认对象为此前提交的签认单，原文 SHA-256 d702e8c69d213818a0c9599a4f9471c4b2f40b75d2c8dabe8b51a90e38271bdf。原始失败仍为 BLOCKED。仅按已核验的精确附件执行处置。

| 对象 | 精确绑定 |
| --- | --- |
| 决定编号 | ES-STD9E5497D-FIELD-STABILITY-01-B-RELEASE-20261129 |
| 可信旧main | 0252e97942dacd32a2aa3790ba92f30e66dca00b |
| Production / 回退部署 | 65a23a780d16d607a0f8f818289e96c886eb1a60 / dpl_EraxN49WoWBSJfKKMJL3ecFPMfNk |
| 原B / 旧投影 | e13f81f330a796350fe8c7412dd443252ab447e3 / cf9b8881a344e64cad4c3f0deb3fe49daed98234 |
| 独立Source | 0829858d04c0ea7a2528ab19fc74293a0d7df0ff |
| 拟main集成 / sourceMainSha | 99ac06b0360fd77739b80558c1c32d4f4c677cb5 |
| Release / tree | b7776e703a770ea78632d38ac652d0bad6e7379f / 9c8f840a84a765f11e0694a634cf3dc89d7a2cc0 |
| 控制前像 → 后继 | 1f86f6eeb951397307d3490583b36ce96555d4ef → 6bb804ba5918e06bc24576525c27de6f92a24ec6 |
| 控制tree | c41a6ffad9bf25a1a09dca9e9aa1d196cb687d80 |
| 四控制文件摘要 | 75ada10762d3d245b7e4b7811712cb0f709c8b111724d2ffc0ffb879570ceffa |
| 签发manifest SHA256 | e50145fe597425ab72655da825e7beb87b45ed5cf901ca42226430d2c6117e6c |
| 技术证据包 SHA256 | 3e8caba088995aac93da8809d78860814cb5db36f1846faaa6121b2bf7fb4f06 |
| 精确边界载荷 SHA256 | 8b6986a770e0d132447ff9aa77ff7f19f2bbcbf19fde42ee841ded99bf377abf |
| 本次失败处置 SHA256 | 1dd5922bbcf578e8b2bc744280a1c49d2daddc00472e570c119c446ba69532a1 |
| 完整覆盖证明 SHA256 | e9d94d59346dea2e3c9743f29c6a3da40146ec89e98846c7ee258b797b38d78d |
| 固定窗口UTC | 2026-11-28T17:00:00.000Z ≤ 实际个人答复和执行时间 < 2026-11-28T19:00:00.000Z |
| 金边窗口 | 2026-11-29 00:00 至02:00（上限不含） |

## 仅三文件Web范围

app/desktop/dine-in/page.tsx、app/desktop/dine-in/readRequests.ts、tests/dine-in-m1-contract.test.ts。Source/R为旧Production语义，M完整树等于已审阅e13；不携带整棵main的其他差异。共享堂食Web会更新所有使用该页面的商户，现场验证仅在大东北进行；不写其他商户数据/配置。

## 原始结果与本次精确失败处置

Build/24项检查按相同完整树及未变输入复用；新增共享浏览器4场景和真实PostgreSQL路由/环境3项通过；精确控制18项通过并独立复审通过。原完整运行仍绑定原SHA：746ead6a CORE102/105，65a23a78 CORE100/104、Integration19/22，RAW均BLOCKED，不冒充本次全量重新执行。

现有规则下，本次覆盖分别由M101个未变PASS+B24同树证据+3个当前失败文件复核，R99个未变PASS+B24+4个当前失败文件复核，RIntegration19个未变PASS+3个当前原失败复核组成。large-cart只重跑原失败命名子用例，其余通过子用例按未变输入保留；Diamond测试保留原loopback库名拒绝，不假称进入其交易体。没有复用旧过期失败授权。

三份完整WorkflowV2 JSONv1附件及环境/原始日志已经绑定在技术包中。各当前失败与各自最新基线一致、无B新失败；本次签认仅覆盖这些逐项精确baseline-reproduced处置。保持RAW FAIL/BLOCKED、未达断言和未执行交易体原样，不放宽冻结测试或金额/Owner/Lease/Fence/UNKNOWN规则。任何新增、改变、恢复、缺失或过期结果均停，不静默借用旧签认。

## 本次批准的有序执行范围

1. 重读main/release/control/生产别名、Rulesets、窗口和证据哈希，任何漂移即停。实际批准来源与真实可核验答复时间须保存，并在正式回执中写唯一FOUNDER_DECISION_UTC行；不以本DRAFT或测试夹具代签。
2. 先办理S精确源码Acceptance及0252e979→M的非部署main精确快进，保留M真实双亲及原树，不另加PR合并包装提交。只在M直接子提交登记四项：docs/releases/ES-STD9E5497D-FIELD-STABILITY-01-B.json，以及同名evidence目录中的founder-release.md/controller-review.json/validation-evidence.json。仅填实际签认/时间/受控权限，不改产品或技术包字节。
3. 读回真实登记main的父、四文件新增与全树；在真实R checkout/真实origin/main上执行原cashier-realtime-integration断言，确认仅已绑定历史FAIL及513路径操作数（原预期仍5）。513夹具及控制器操作数守卫不代替该次真实原始运行；有未知/新失败即停。
4. 建立精确非Production候选引用refs/heads/codex/es-std9-b-release-candidate-01指向R，控制分支仅由P快进至C，允许既有受保护工作流对R一次签发。按原Source/Scope/Lineage/精确证据、权限、时限和签发检查执行，核对原POST ID，不重试未知签发，不绕过App。
5. 只有签认、正式默认校验器、真实App检查和健康条件均有效，才可让release由BASE快进至R并由现有Vercel流程发布Web。读回项目/别名/实际Git及关键页面；在无未决界面操作时受控加载新Web并在大东北做只读页面性能/导航验证，不重启或升级RC6，不提交订单，不操作Owner/0017。
6. 若发布健康回归失败，按本单明确回退授权仅恢复Web alias至同表原部署；不回退数据库、清账本、重放打印、修改Owner或重写受保护release历史。读回并停止后续动作。无新版本或其他部署扩权。

窗口到期不自动续期；不默认授权未来控制后继、通用签发器、A/C、迁移、打印恢复、真实新单或完整商业化验收。实际Production状态、App状态、真实页面可见性与FIELD均在完成后分别记录。
