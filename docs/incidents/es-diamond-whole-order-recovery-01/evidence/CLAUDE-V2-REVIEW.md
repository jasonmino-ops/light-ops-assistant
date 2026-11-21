# ES-DIAMOND-WHOLE-ORDER-RECOVERY-01 — Fresh-context 独立只读最终复核

## 0. 本次复核的实际依据（以及我没有做的事）

实际读取（本 worktree 真实文件）：`REVIEW-DISPOSITION.md`、`IMPLEMENTATION-AND-GATE.md`、`controller.cjs`、`guards.cjs`、`case.ts`、`scripts/diamond-recovery/package-core.cjs`、`packaged-admission.cjs`、`frozen/{recovery-candidate,accounting-clock,admission-evidence}.cjs`、`package-manifest.json`、`app/api/cashier/recovery/diamond-13543/route.ts`、`DiamondRecoveryAction.tsx`、`app/cashier/page.tsx`（1500–6099 全部函数体与全部 JSX 渲染树）、`lib/cashier-hold-orders.ts`、`lib/cashier-environment.ts`、`lib/desktop-pos-client.ts`、`lib/payment-breakdown.ts`、`app/api/summary/route.ts`、frozen 源 `sales/route.ts`、`desktop-pos-auth.ts`、`context.ts`、`pos-request-ledger.ts`、`record-no.ts`、`cashier-network-producer.ts`、`es-tray-relay/service.ts`（enqueue 段）、`v3-print-job-adapter.ts`（enqueue 段）、`v3-print-identity.ts`、`desktop-network-print.ts`；测试 `entry/integration/ui/artifact.test.cjs`、`helpers.cjs`；证据 `source-parity.json`、`entry/integration/ui/artifact-tests-v2.log`、`build-v2.log`、`PAGE-INTEGRATION-SUPPLEMENT.txt`、`candidate-code-sha256-v2.json`。

我**没有**做、因而**不声称**的事：未重算任何 SHA256（无哈希工具，机械核验归 Codex）；未运行任何测试或 build（结论来自日志文本）；未连接生产；未重跑原 17 测试；未读 `page.tsx` 1–1499 行（模块级 import/常量/类型/样式，组件内函数在此不可被引用）；未逐行通读全部 21 个冻结依赖（`session.ts`、`product-unit.ts`、`khqr.ts`、`merchant-config.ts`、`currency.ts`、各 crypto/contract/config 仅凭 manifest 与调用面判断）。

---

## 1. 独立技术最终结论

**技术结论：PASS WITH BLOCKERS（隔离候选件）。正式生产准入：BLOCKED。**

代码语义与首轮处置表（REVIEW-DISPOSITION）在我自己能核验的部分**基本一致，且不是自评式空话**——关键主张都能在实际源码与新增测试里找到对应物理证据。我在本轮**未发现新的 P0**。两条时间轴（SaleRecord 记 Nov20、PaymentIntent.paidAt/幂等/打印/审计记真实时刻）在代码层是**成立的设计**，不是缺陷；真实现金口径消费者确实按 `SaleRecord.createdAt` 取数。

关键可验证事实（带代码出处）：

| 事实 | 证据 |
|---|---|
| 仅 sales route 注入会计时钟，其余 20 个模块真实时钟 | `package-core.cjs:50,58`（仅 `entries[0]` 前置 `const Date = AccountingDate`）；`package-manifest.json.clockDomains` 20×`REAL_EXECUTION_TIME` |
| SaleRecord 落 Nov20、单号 S-20261120 | route `205/208-212/231`（`firstLineMs=ANCHOR-53ms`，54 行跨 53ms）+ `record-no.ts:31-33`（用传入 `recordClock`） |
| paidAt 为真实恢复时刻（覆盖 route 的 `new Date()`） | `recovery-candidate.cjs:30` txFacade 在**未打补丁**模块里 `paidAt:new Date()`；integration 测试 `paid.paidAt ≈ now`（line 50） |
| 真实现金日口径按 SaleRecord.createdAt，不看 paidAt | `lib/payment-breakdown.ts:31-45,51-55`（PI 只用于 method/status 分类）；`app/api/summary/route.ts:100-105,183-184`；交班报表客户端按 `item.createdAt` 过滤（`page.tsx:2957-2968`） → 恢复日交班/日结增量为 0 |
| 打印任务 TTL = Nov20 业务时间 +24h | `v3-print-identity.ts:1,9-13` + `service.ts:161-162` + `accounting-clock.cjs:10`；integration 断言 `job.expiresAt==='2026-11-21T16:13:36.233Z'`（line 51）；`maxAttempts:1/schemaVersion:3`（`v3-print-job-adapter.ts:183-185`） |
| 65s 预算在受理前/事务前/打印前三处硬校验 | `controller.cjs:52`、`admission:33`、`recovery-candidate.cjs:19,39`；entry 测试在 16:13:00Z 即 throw（line 35） |
| 不铸造凭证 | `package-core.cjs:23,72` 导出白名单 Proxy（`signPosDeviceToken/issuePosDeviceSession/signSession` 不可达，entry:38 证明）；`guards.cjs:7` 只读能力；外部依赖白名单 5 个（`package-core.cjs:55`，无 `next/headers`，`context.ts:46` 走 `req.cookies`）；`route.ts:13` + artifact 测试断言无 `set-cookie` |
| 一次性围栏真实有效 | `controller.cjs:151` 先于唯一财务调用提交 `diamond:13543:accepted:v1`；20 并发实测 `{sales:54,payments:1,idem:1,jobs:1,moves:0,acceptance:1}`（integration:40-54）；回滚后围栏永久冻结（:77-81） |
| 受理前拒绝 ≠ UNKNOWN | `controller.cjs:143-148` 仅在确认 FENCE/STOP 皆不存在后返回 `BLOCKED_NOT_ACCEPTED`；integration:38 与 UI:48 实测仅此响应可重置本地闩锁 |
| Origin 固定 | `case.ts:3` + `route.ts:25` + `guards.cjs:24` 绑定签名文档；artifact 测试 `evil.invalid → 403`（:16） |
| 查询源单一化 | `package-core.cjs:82-84` 由冻结 `verifyCurrentBaseline` 的 AST 语句参数化生成 `readDayTotals`，`querySourceSha256/rangeQueryStatementSha256` 入 manifest；controller 无第二份 SQL |
| 不改原打印结果 | `reportPaperFailure` 只写 `STOP_ID`（status FAILED / payload UNKNOWN，`controller.cjs:87,132`）；integration:87 实测 job 行字节不变、`physicalCompletionKnown` 保持 false |

---

## 2. 尚存明确问题（均有具体代码证据）

### P0
**无。** 在我实际读取的 46 个候选文件与页面集成点中，未发现可导致重复入账、重复收款、重复出纸、越权铸权或静默扩大影响面的缺陷。

### P1（仍然有效，分“结构性”和“交付性”）

**P1-A 治理信任根只有一把共享密钥（结构性，条件保留，无法在本任务内消除）**
`controller.cjs:37-39` 用 `AUTH_SECRET` 做 HMAC；`guards.cjs:12-25` 校验的 Founder/review/lineage/scope/source-parity 仅是**自述 JSON 内容**（`helpers.cjs:31-37` 的 fixture 即可证明一份“PASS 文档”就是一段 JSON）。而同一个 `AUTH_SECRET` 也签发 POS 设备 token（`desktop-pos-auth.ts:48-54`）。即：**能启用许可者 = 能铸 token 者**，“Founder 已批准/独立评审 PASS/lineage STRICT”在密码学上不是独立签署，只是流程承诺。负例测试只能证明“写 BLOCKED 会被拒”，不能证明“写 PASS 的人有资格”。本轮不建议改造（会越界），但**必须在最终授权文书里明示这一限制**。

**P1-B 仓库内证据与实际候选不一致（交付性，必须修）**
`docs/incidents/.../evidence/RESULTS.json:33` 仍写 `31bbde37…`（v1）、测试计数 entry 17 / integration 9 / ui 6；而权威候选是 v2 `80f02ac8…`，实际日志为 entry 24 / integration 11 / ui 10 / artifact 4，且只存在于 `/private/tmp/...one-click-implementation/`。**仓库自带证据目前描述的不是仓库里的代码。** 任何发布包组装前必须刷新 RESULTS.json / candidate-code-sha256.json 并把 v2 日志归档进仓库证据目录。

**P1-C source-parity 证明对真实发布无效（交付性，设计上已知但仍 OPEN）**
`source-parity.json` 的 `releaseSha = b0aa38a1… = frozenSourceCommit`，即它是在 **HEAD 仍为生产基线、候选代码未入提交** 的树上生成的。而 `guards.cjs:15,23` + `controller.cjs:42` 要求 `source.releaseSha === g.releaseSha === VERCEL_GIT_COMMIT_SHA`，所以这份证明**永远不可能验证一个包含候选代码的真实发布**。激活前必须对确切发布提交重新跑 `--check-tree`。（此点候选自述已承认，我确认其为事实，不计为“冒称已部署”。）

**P1-D 打印 TTL 的作业边界（保留，不得静默延长）**
TTL `2026-11-21T16:13:36.233Z` 是结构推导出来的（Nov20 业务 createdAt + 24h），不是可调参数，三处硬校验、过期即不受理，**不存在“出生即过期”的任务**。但 65s 预算意味着：若在窗口末端执行，任务入库后留给物理出纸的寿命可能仅剩数十秒，一旦到期未 SUCCEEDED，`controller.cjs:104` 直接判 UNKNOWN（账已入、无补打）。**作业建议（非改码）：设置远早于 16:13:36Z 的人工硬截止**；过期则按既有要求另立授权方案，不得改冻结核心。

### P2（作业前必须逐条核对的真实卡点，全部 fail-closed）

1. `route.ts:36-37`：**认证/入参失败走 409 UNKNOWN**（不是 `BLOCKED_NOT_ACCEPTED`），而组件在 POST 前已写本地 attempt 闩锁（组件:81-82），会导致一键流程在无服务器围栏的情况下被锁死。缓解：按钮仅在 GET 返回 READY（即数秒前刚通过同一 `authenticate`）时可点，窗口极窄。
2. `desktop-pos-client.ts:82-89`：若 sessionStorage 里该店选择为 `ACCOUNT`，则 `controller.cjs:77` 要求账号侧独立通过，且 `triggerUserId` 必须在 `allowedTriggerUserIds` 内。作业前须确认操作员来源与许可名单一致。
3. `controller.cjs:124`：要求 2026-11-19T17:00Z 以来**非 SUCCEEDED 打印任务数为 0**；`:123` 要求 `ownerEpoch===2` 且租约未过期。真实门店这两条极易不满足（桌面重启会改 epoch），须在窗口前现场复核。
4. `admission:33` 新鲜现场证据 <120s，并在事务内由 `assertExecutionWindow` 再校验（`controller.cjs:157,161`）。若在“围栏已插入→事务内再校验”之间过期，会**消耗唯一一次机会并永久冻结（零财务影响）**。作业要求：现场观测后应在前 ~60s 内点击。
5. `controller.cjs:172-173`：提交后比对恢复日合计，**窗口内出现任何普通销售会把一笔已正确提交的恢复判成 UNKNOWN 冻结**。“收银/离线暂停”是技术硬条件而非建议。
6. 原单+3 别名长期保留，交班/日结报表的“未完成挂单”计数会常驻 +4（`page.tsx:3012,3121`）。纯展示、与现金/销售汇总无关，属用户明确要求，不计缺陷。

---

## 3. 首轮 11 个主 P1 + 页面 P1 的逐项裁决

| 首轮问题 | 本轮裁决 | 依据 |
|---|---|---|
| P1-1 时钟/报表 | **关闭（技术层）**；人工交班补签仍 OPEN（Prisma 无 CashierShift/日结表） | payment-breakdown / summary / 交班过滤均按 `SaleRecord.createdAt`；paidAt 非现金日选择器 |
| P1-2 铸权 | **关闭**；残留共享密钥内部人风险 → 并入 P1-A | 导出白名单 Proxy、只读 DB、5 个外部依赖、无 next/headers、无 Set-Cookie、设备/会话整行前后一致 |
| P1-3 治理内容 | **部分关闭**：语义校验到位且有 5 个签名有效但值为 BLOCKED 的负例；信任根弱点保留 → P1-A | `guards.cjs:12-25`；entry:41-43 |
| P1-4 部署源一致 | **机制关闭 / 产物未关闭** → P1-C | `package-core.cjs:13-18`；`source-parity.json` releaseSha=基线 |
| P1-5 受理前 vs UNKNOWN | **关闭**（附 P2-1 说明） | `controller.cjs:143-148`；integration:38；ui:48 |
| P1-6 Origin | **关闭**，前提是真实发布确实以 `https://elifekh.com` 提供该页面 | `route.ts:25`；artifact:16 |
| P1-7 物理见证/失败 | **关闭（审计语义层）**，物理真相仍属人工 | `controller.cjs:132-139`（`physicalVerificationBySystem:false`）；integration:87；ui:58 |
| P1-8 STOP 审计状态 | **关闭** | `controller.cjs:87` status FAILED / state UNKNOWN，实测断言 |
| P1-9 SQL 重复 | **关闭** | 打包期 AST 派生 + manifest 双哈希，controller 无第二份 SQL |
| P1-10 auth 只读 | **关闭** | `guards.cjs:7`；integration:28-30/41/53 整行 JSON 相等 |
| P1-11 打印 TTL | **按设计保留**（非缺陷），附 P1-D 作业硬截止建议 | 结构推导 + 三处校验 + 过期即拒的实测 |
| 打包 P2 | **关闭** | AST require 改写、动态 require/标识符冲突/外部模块均抛错；字节级可重现；nft 无 /private/tmp、无 typescript |
| 页面 P0-C1（唯一调用点） | **关闭（我亲自核验，不再是假定）** | 定义在 `page.tsx:2847/2862`，与所给 Production 文本逐字一致；唯一调用点在 `5023/5026`，位于 `isDiamondRecoveryHold(...) ? <DiamondRecoveryAction/> : <>…</>` 的 false 分支（5022-5029）；父 `sideEventRow` 无 handler；`holdOrders` 仅由 1700-1706 的 `listHoldOrders` 写入；整棵渲染树（4738-6099）与组件体（1500-4737）内无第二处挂单列表/快捷键恢复路径 |
| 页面 P1-1/2/3/6/7/8 | **关闭** | 组件 `valid: boolean\|null`（:23,99）、能力前置检查（:47）、AbortController 兼容（:30）、固定门店常量头（:34）、2 分钟有界轮询（:67-68）、`minHeight:44`（:11）；ui-tests-v2 全绿 |
| 页面 P1-4 并发 | **关闭** | 跨实例持久围栏 + 真实 PG 20 并发 |
| 页面 P1-5 保留原单/别名 | **按用户要求保留**，不计 P1；仅留 P2-6 计数提示 | — |
| 页面 P1-9 TTL/上限清理 | **关闭** | `lib/cashier-hold-orders.ts` 无 TTL/上限/启动清理，`removeHoldOrder` 仅被两个普通 handler 调用，而目标行不渲染这两个按钮 |

---

## 4. 正式准入结论

- **技术（隔离候选）：PASS WITH BLOCKERS。** 可继续作为非发布候选保留在本地分支。
- **正式生产：BLOCKED（强制）。** 阻断项与本次技术结论无关、且不可由任何测试关闭：
  1. Scope Guard = BLOCKED（无本任务可信 main 例外）；
  2. Lineage = BLOCKED / SOURCE_MAPPING_UNKNOWN；
  3. 现场证据 1：已签 Nov20 交班单的记录号/保管人/不可变副本/有授权的补签人与只追加补签计划 —— OPEN；
  4. 现场证据 2：现场协调人、静默执行窗口、指定接收人、纸张与 USB002 空队列 —— OPEN；
  5. P1-B（仓库证据与候选不一致）、P1-C（source-parity 必须对真实发布重出）；
  6. Founder 针对“确切发布 + 确切激活 + 一次恢复 + 一次 FRONT 打印”的最终书面授权尚不存在，且本候选内不含写许可的端点。
- 任何技术 PASS 都不等于 Production READY；在上述 6 项全部关闭前，不得合并、push、部署、启用许可或打印。
- 若 `2026-11-21T16:13:36.233Z` 到期：**硬停**。不得延长、不得改冻结核心、不得为赶窗口降低任一门限；需另立经授权复核的新方案。我不对该窗口是否来得及做任何预测。

---

## 5. Obsidian 开发记录（本轮为只读复核，**未写入任何文件**）

> 说明：本会话仅有 Read 工具，无写入/命令权限，因此以下内容**尚未**落盘到 `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/`，也**未**误写项目仓库 `05-开发记录`。需由有写权限的一方按原文归档。

```markdown
# 2026-11-21 ES-DIAMOND-WHOLE-ORDER-RECOVERY-01 独立只读最终复核

## 问题
隔离一键恢复候选（46 文件，manifest 80f02ac8…）需要在有完整源码/fixture/日志的前提下做独立技术终审，裁决首轮 11 个主 P1 与页面 P1，并给出正式准入结论。

## 原因
首轮复核受“缺源码”限制，存在假定性 P0/P1；且生产口径（现金业务日、paidAt 语义）与真实消费者代码需要以实际文件裁决，不能依赖自评。

## 修改文件
无（只读复核，未修改任何文件，未提交）。

## 修改内容
无。仅产出技术判断：
- 两条时间轴成立；真实现金口径按 SaleRecord.createdAt（payment-breakdown.ts / summary route / 交班过滤）。
- 一次性围栏、受理前拒绝、Origin、只读 auth、导出白名单、查询源单一化、正负物理见证均有实际代码与实测证据。
- 页面集成唯一调用点与普通 handler 未改，已由实际文件核实（page.tsx:2847/2862/5022-5029、1700-1706）。
- 残留：共享 AUTH_SECRET 为唯一治理信任根；仓库证据仍为 v1；source-parity 需对真实发布重出；打印 TTL 作业硬截止。

## Build
通过（依据 build-v2.log “Compiled successfully”，本人未执行）。

## Commit
无（本轮未提交；业务候选 commit 由实现方提供，本复核未产生新 commit）。

## 风险
中（代码侧 fail-closed、无 P0；风险集中在治理信任根、证据版本漂移与现场一次性窗口）。

## 结果
技术结论 PASS WITH BLOCKERS；正式生产准入 BLOCKED（Scope/Lineage + 两项现场证据 + 证据刷新 + 最终授权未闭环）。

## 建议归档
05-开发记录/开发日志（同时在 03-冻结文档/02-冻结过程资料 留存本复核作为准入依据）
```

**分类判定：** 本文属「验收记录 / 独立评审结论」，建议主归档 `05-开发记录/开发日志`，并在 `03-冻结文档/02-冻结过程资料` 留副本作为后续授权的前置依据。