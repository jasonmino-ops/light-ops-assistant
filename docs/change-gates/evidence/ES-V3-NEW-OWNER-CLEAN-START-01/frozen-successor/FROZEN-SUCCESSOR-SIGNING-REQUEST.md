# ST04C05602 七票冻结后继签认申请

本件供 Founder 本人决定是否接受所列精确冻结后继。签认对象为同目录 `frozen-successor.payload.json` 的原始 UTF-8 字节，SHA-256 为 **`b02015d62df313a0c2c67d3f874a40a611d7ac2a4bbbb70e31341dc58378df6a`**。当前状态为待签、未生效。下列受保护发布和生产处置各有独立授权。审批记录须保留签认人、时间、任务、Product、release tree 和该 SHA-256。任一绑定变化均须重新审查。

## 冻结范围

| 对象 | 绑定 |
| --- | --- |
| 已审 Product / 原证据 | `100826d5b502e55d8726aaa1922b1885ad16afee` / `1ae9fc372ee547361fe0fa3d8461ab207bce8826` |
| 设计 / 七票清单 | `d746925f7b4c69f4cfddf1bafdbdb309def98945673601ef8e1b23ac91eba419` / `5b53783cd4b979ad1370c54a57fad8540f854fe64dec64eb47cddc94afb5611c` |
| 既有冻结文件 | `docs/freezes/ES-DIAMOND-V3-FINALIZE-HELD-UPDATE-OPTIMIZATION-01.md`，SHA-256 `651a95eecb395c4a522ec469fc9d3e954e3bd33fa5290e350aed17bae0d1d5b7` |
| 申请的唯一冻结依赖变更 | `lib/v3-print-job-adapter.ts` 的 `992900c79a0d422e6d7c5359ebc15b628ceee31cbc84e19d5fbbb65076b2fb63` → `b24c4bbf902c145ffef5f48ee52b25a39a87c567f8315f1d42d1ffec3878e22d` |
| 对应既有测试 | `tests/cashier-large-cart-query.test.cjs` 第 81–84 行，原测试 SHA-256 `921e54f9e65ad15cda09a25b7a5e88a3345f5c2928c062997bf35d6166e5795e`。其余五个依赖、完整收银事务、原测试均逐字节核对。 |
| 源码投影和发布草案 | 源 `7831461a` → `f5a1ad5d`，各自唯一映射至 `35575551` → `f33993497c107ad9090b0b64896fac5f2b0934ff`。两条线最终 tree 均为 `57f1cf3d4139011bcb9c6c929b10de212813c094`。完整 SHA、路径、模式和差异指纹见 `projection-mappings.json`。 |

冻结后继仅涵盖封存门店、七张 FRONT 票和 V727 的新任务准入。既有 Owner/Lease/Fence、Ledger/Outbox、HELD 实体化和执行回报函数逐字节核对。七个运行时文件和专项测试与原 Product 一致。仅 integration 清单按各自真实基线登记已有用例。数据库 schema 和 migrations 无差异。Workflow V2 §6 要求新 L3 冻结后继由 Founder 本人精确签认。若正式守卫需登记此后继，按对应正式流程核对 release tree、断言及全部依赖指纹；新树、其他门店、新的失败或任何未匹配指纹均拒绝。本件不将旧断言结果改成 PASS。

## 测试及失败归属

| 检查 | 实际结果与处置 |
| --- | --- |
| 独立源码、投影 | 独立 Codex 从 Git 对象重算原 Product 和逐提交发布投影，均为 PASS。Claude 对运行时代码、清单差异和 PostgreSQL 回执的限定复核为 PASS；Claude 单独重算 Git 哈希为 UNKNOWN。原回执及最终结论见 `review.json`。 |
| 七票专项 | 在实际发布草案上使用隔离 PostgreSQL，UTC、金边各 37/37，无跳过。覆盖并发、事务回滚、迟到回报、回读丢失、跨切换时点阻断及 FRONT/KITCHEN 新任务分流。类型检查和应用构建均 exit 0。 |
| 清单收集 | 主线清单由 24 到 26，含原 Product 登记的七票及本轮补登的大购物车。发布基线 18 项全部保留，另登记七票、大购物车和发布线独有的库存销售 Phase 2，共 21 项。 |
| CORE 全量 | 金边时区开发候选实跑 104 项，99 PASS、5 FAIL。发布草案 103 项，99 PASS、4 FAIL。每条失败在对应干净基线单独复现。UTC 下两条线另有同一模板时间指纹失败。历史失败仍由原守卫报告 BLOCKED，比较回执在 `known-failures.json`。 |
| 既有收银页面冻结失败 | 主线无法识别已进入该线的库存/交班页面后继，release 的旧断言期望 `8cdf50c3…`，而现网及本候选均为 `b1750480…`。原 V3 四套回归 131 PASS、1 FAIL。原用例因该断言中止的两个客户端用例另行运行，在两条线上各 2/2 通过。应在原收银治理线路核对已签后继；本件未申请豁免。 |
| 本候选引入的大购物车指纹失败 | 在同一套未改测试、显式选定源码、真正启用隔离 PostgreSQL 后，现网源码 11/11，候选 10/11；均无跳过。两边 7 个数据库行为用例全部通过，包括正常 54 行现金销售、8 个并发同键请求、付款失败回滚和响应丢失。候选唯一失败是上表的适配器旧指纹。原断言继续执行。 |

## 受保护发布顺序

1. readback 验证的 Production 为 `b36c47e137693e067a7d26d40706df8f89610f29`，Vercel `dpl_Enq3R1v2BezAHNh7G1mW6KYdj53g` 为 READY，可信 main 为 `1fe4481dcc64adf48af2c4d5cfff8addf79ed3a1`。STRICT 父链分叉，CONTENT_SUBSET 开发血统通过。生产树与 main 已接纳的 `1dcc8398` 相同。未使用纯文档例外。
2. 先完成精确冻结后继签认及相应治理登记。原始 CORE 和收银守卫仍有失败，必须修复或走正式、逐项、限时的准入裁决。payload 中的已知失败对照仅供审查。签认本件不能替代这些裁决。
3. 取得可信 main 来源准入许可后，保留 main 的专有内容和全部已登记测试，逐项接纳源投影祖先及对应证据，再实读受信 main 并重新生成 release 申请。勿把整个开发分支发布。两对来源指纹或实际 Production 父版本有漂移即停止。
4. 现有控制 ref `45b65b45` 只绑定早先的 Diamond 收银发布；需要针对本次候选的独立控制记录。按既有流程获取 Founder 的精确发布授权并使 GitHub 受保护检查 `eshop/selective-release-validator`（App `5590705`，规则集 `26426184`）对精确 release SHA 返回 SUCCESS。目前实际 validator 返回 `AUTHORIZATION_MISSING`，远端尚无本候选提交及检查成功回执。
5. release 全部 21 项 integration 的全套验收目前没有 PASS 回执。适用发布回归仍须完成。以上通过后，最小生产部署为仅发布 `f3399349`，零 migration。部署后核对实际 Git SHA、READY、别名、健康、普通收银及服务端验签就绪。部署会使本店旧效果入队、V727 领取和普通 FINALIZE 受保护，即使尚未处置七票；安排独占窗口并保留停机恢复路径。若已经处置或已切换 Owner，禁止直接回退至会重新调度旧效果的版本。

## 七票一次性处置 A

原始快照中 7 条均为 FRONT、PENDING，云端领取和执行均为 0，物理结果 UNKNOWN。旧机已由 Founder 确认退役。线上最终状态须在执行窗口重读。精确 ID、三个请求体和只读读回路径见 `seven-ops-request.json`。固定申请号 `2673e734-1728-462a-8be5-16a4bfe7ff29`。

1. 服务器最早允许时间是 **2026-11-24 12:39:31.396 金边时间**。核对租户、门店、原 Owner、epoch 1、stateVersion 4744、租约和批次、全部七个前像、零领取/执行、实际到期、票据、业务键和无额外任务。独占窗口内再次验证 V727 真实用户目录、Ledger/Outbox 和所有线上/离线任务来源均已排空。对已退役机器无需索回本地账本。
2. 独立取得仅限 A 的 Founder 生产处置批准。届时绑定线上 release/deployment ID、实时 `beforeHash`、两名不同且有效的 Ops 及最长 15 分钟的签名授权。当前这些值尚未登记。复核人发送 REVIEW；执行人发送 APPLY。保持既有租户校验、行锁、幂等和 Fence。
3. 严格 READBACK 应验证七票及七个逐票审计、复核和执行汇总。调度状态为 EXPIRED，原因 `V3_OPS_QUARANTINED_PHYSICAL_UNKNOWN`。保全原 PENDING 前像、票面与幂等键，领取/执行计数为零，`completedAt/resultStatus/effectBoundary` 均保持空值；物理结果仍 UNKNOWN。确认 Owner、epoch、stateVersion 与操作前相同。若响应不明，仅以原请求的只读回执查询事务是否已提交；未能验真就停止，禁止重放。
4. 读回 `HANDOFF_PREFLIGHT_OK` 后才能另提 Owner 受控交接。新旧设备、确认号及阶段版本见上级 `PRODUCTION-GATE.md`。B 激活另签，绑定 A 的真实 afterHash、新租约和空队列。厨房开关、FRONT USB003 与 NP330 `192.168.18.229:9100` 的实体 FIELD 各自保留审批。当前生产状态未发生处置、交接或实体打印。
