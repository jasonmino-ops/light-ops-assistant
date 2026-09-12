# ES-PRINT rc.7 Known Test Failure Baseline

> **本清单必须在每一次合并前校准。**
> 未出现在本清单中的失败一律视为新回归，阻塞合并。

## 规范状态与校准方法

- 本文件是 `TASK-PRINT-RC7-PREFLIGHT-01` Phase 0 的仓库 tracked 规范副本。`.task-state/KNOWN-TEST-FAILURES.md` 仅是原执行 worktree 的会话副本，不再承担持久化职责。
- 本基线记录 `a33b44c1c51223009326c4869526f7de6bd4a89d` 的一次完整首轮结果；它不把历史结果自动继承为未来 SHA 的测试结论。
- 每次合并前必须在当时的候选 SHA 上重新发现并执行适用全量测试，把每个失败精确到测试文件和用例，与本表逐条比对。
- 新失败、失败形态变化、证据失效或超过复核期限均阻塞合并。清单变更必须同时记录新的原始输出位置/哈希、事实归因、处置和复核期限，并接受适用的 Scope Guard 与独立审查。
- `/private/tmp` 日志可能被环境清理；本文件保留其原始哈希作为当次执行凭据。后续复核以新执行产生的新日志与哈希为准，不得用不可访问的旧日志替代重跑。
- 证据保留限制：KTF-20260912-01 的五次专项复跑没有单独保留日志；复跑次数来自原执行记录，当前不可独立复核。其源码计时结构仍支持非确定性归因，但下一次合并校准必须重新复跑并保留新日志与哈希。

## 基线信息

- 基线源码：`a33b44c1c51223009326c4869526f7de6bd4a89d`
- 执行日期：2026-09-12（Asia/Phnom_Penh）
- Node.js：`v24.14.0`
- npm：`11.9.0`
- Prisma Client / CLI：`7.6.0`
- PostgreSQL：`18.3`，一次性本地集群 `127.0.0.1:65432/light_ops_test`
- 全量口径：仓库根 `tests/` 下 81 个 `*.test.ts` 与 1 个 `*.test.cjs`，顺序执行，共 82 个测试文件。
- 首轮结果：75 个测试文件 PASS，7 个测试文件 FAIL。
- 原始完整日志位置：`/private/tmp/TASK-PRINT-RC7-PREFLIGHT-01/root-full-suite.log`
- 原始完整日志 SHA-256：`103b2f581a87e611bc6a021017cbab0c18a46f51869addf89f49365dc8a8f06f`
- 打印数据库 E2E 专项日志位置：`/private/tmp/TASK-PRINT-RC7-PREFLIGHT-01/cashier-network-print-v01.log`
- 打印数据库 E2E 专项日志 SHA-256：`1d9fa5f05f6612e775ad24376f367150e4a08bcbba20f0f40460d2bfe22436c3`

## 失败清单

| 编号 | 测试文件 + 用例名 | 失败形态 | 归因 | 归因证据 | 处置 |
| --- | --- | --- | --- | --- | --- |
| KTF-20260912-01 | `tests/browser-print-readiness.test.ts` — `unstable layout reaches the bounded timeout without printing` | 断言失败：期望 `blocked`，实际 `printed` | 测试本身写错（毫秒级真实计时导致非确定性） | 首轮报错由 `test()` 在 `tests/browser-print-readiness.test.ts:167` 包装；该用例在 `:304`，将 `timeoutMs` 设为 8ms（`:312`），Fake `requestAnimationFrame` 又依赖 1ms 真实 timer（`:104-110`）。原执行记录记载随后连续复跑 5 次：第 1 次在另一用例 `document loading waits until readyState is complete` 的 `frameCalls >= 2` 失败，第 2–5 次全部 18 cases PASS；专项复跑日志未保留，次数现为不可独立复核。源码中的真实毫秒 timer 与失败位置变化仍支持非确定性归因。生产默认 readiness timeout 是 `lib/browserPrintFallback.ts:39` 的 5000ms。 | 待修 `TEST-BROWSER-PRINT-READINESS-FLAKE-01`；本轮不改测试或业务实现。复核期限：2026-09-19，且不得晚于下一次合并前校准。 |
| KTF-20260912-02 | `tests/dashboard-print-settings-mobile.test.ts` — `main`：打开 `/dashboard` 后「门店配置」按钮应可见 | 环境缺失：`page.goto` 报 `net::ERR_CONNECTION_REFUSED`，目标 `http://127.0.0.1:3100/dashboard` | 环境问题 | 默认 URL 位于 `tests/dashboard-print-settings-mobile.test.ts:4`，实际导航位于 `:156`；首轮没有 3100 本地 UI 服务。启动本地 Next 服务后，未设置 OWNER 上下文会被 `middleware.ts:55-72` 重定向；以测试约定的 `DEV_ROLE=OWNER` 启动后复跑输出 `dashboard mobile print settings lifecycle tests passed`。复核日志：`/private/tmp/TASK-PRINT-RC7-PREFLIGHT-01/dashboard-rerun-owner.log`，SHA-256 `4c0ef6408241f35a095640770347ec37f4b0cf0df1619ea173e65e7fd5053fd7`。 | 已修（仅补齐测试运行环境）：本地 Next 服务 + `DEV_ROLE=OWNER`，复跑 PASS；仓库文件未修改。 |
| KTF-20260912-03 | `tests/desktop-pos-write-fallback-runtime.test.ts` — `testAuthorizedRegressionPaths`：`authorized order status update must remain available` | 运行期异常：`after was called outside a request scope`，未到达状态断言 | 测试本身写错（直接调用 Next Route，未建立 request scope） | 测试在 `tests/desktop-pos-write-fallback-runtime.test.ts:384-389` 直接调用 `PATCH`；路由在 `app/api/cashier/orders/[id]/route.ts:65` 调用 Next.js `after()`。首轮原始错误明确指向 `next/src/server/after/after.ts:14`、路由 `:65` 与测试 `:384`。`git blame` 显示直接调用测试来自 `2cbb792e`（2026-07-22），`after()` 后加于 `ba356d2f`（2026-08-22），测试 harness 未同步。 | 待修 `TEST-DESKTOP-POS-REQUEST-SCOPE-01`；本轮不触碰受保护 cashier 路径。复核期限：2026-09-19，且不得晚于下一次合并前校准。 |
| KTF-20260912-04 | `tests/es-tray-desktop-launch-route.test.ts` — runtime 段：`Network FRONT_ONLY reuses the consumed binding session and opens exact cashier opt-in`（进入该段前置） | 环境缺失：`A12_LAUNCH_RUNTIME_BASE_URL is required` | 环境问题 | `tests/es-tray-desktop-launch-route.test.ts:15` 读取 URL，`:219` 明确断言必填；首轮在 12 个静态用例 PASS 后于该断言停止。设置 `A12_LAUNCH_RUNTIME_BASE_URL=http://127.0.0.1:3100`、Chrome 路径并启动本地 Next 服务后，复跑 26 cases PASS。复核日志：`/private/tmp/TASK-PRINT-RC7-PREFLIGHT-01/ui-runtime-rerun.log`，SHA-256 `03ea86096255a3413a218ff8bcd649820b90dc5c792a35c019f7af483f8145b3`。 | 已修（仅补齐测试运行环境），复跑 PASS；仓库文件未修改。 |
| KTF-20260912-05 | `tests/product-sales-browser.test.ts` — `main`：进入 `/product-sales` 并显示「商品销售查询」 | 环境缺失：`page.goto` 报 `net::ERR_CONNECTION_REFUSED`，目标 `http://127.0.0.1:3107/product-sales` | 环境问题 | 默认 URL 位于 `tests/product-sales-browser.test.ts:11`，实际导航位于 `:76`；首轮没有 3107 本地 UI 服务。设置 `PRODUCT_SALES_UI_BASE_URL=http://127.0.0.1:3100` 并启动本地 Next 服务后，复跑 PASS。复核日志及 SHA-256 同 KTF-20260912-04。 | 已修（仅补齐测试运行环境），复跑 PASS；仓库文件未修改。 |
| KTF-20260912-06 | `tests/product-sales-image-browser.test.ts` — `main`：进入 `/product-sales` 后执行 query/history PNG 流程 | 环境缺失：`page.goto` 报 `net::ERR_CONNECTION_REFUSED`，目标 `http://127.0.0.1:3107/product-sales` | 环境问题 | 默认 URL 位于 `tests/product-sales-image-browser.test.ts:13`，实际导航位于 `:76`；首轮没有 3107 本地 UI 服务。设置 `PRODUCT_SALES_UI_BASE_URL=http://127.0.0.1:3100` 并启动本地 Next 服务后，复跑输出完整 PNG/browser 流程 PASS。复核日志及 SHA-256 同 KTF-20260912-04。 | 已修（仅补齐测试运行环境），复跑 PASS；仓库文件未修改。 |
| KTF-20260912-07 | `tests/subscription-expiry-reminder.test.ts` — `testReminderApiIsolation`：OWNER response `displayState` 应为 `REMIND` | 断言失败：期望 `REMIND`，实际 `EXPIRED` | 测试本身写错（固定 fixture 时间随日历失效） | 测试固定 `NOW = 2026-08-19T12:00:00.000Z`，并在 `tests/subscription-expiry-reminder.test.ts:154-156` 返回 `NOW + 4 days`；测试于 `:169` 期望 `REMIND`。实际 route 在 `app/api/subscription/reminder/route.ts:20` 调用 `computeSubscriptionReminder(subscription)`，而 `lib/subscription-reminder.ts:44` 默认使用执行时的 `new Date()`。本次执行日 2026-09-12 已超过该 expiry 与 3 天 grace，因此实际 `EXPIRED` 与现有实现一致。 | 待修 `TEST-SUBSCRIPTION-REMINDER-CLOCK-01`；本轮不改测试或业务实现。复核期限：2026-09-19，且不得晚于下一次合并前校准。 |

## 当前仍为已知失败

- `KTF-20260912-01`：非确定性计时测试。
- `KTF-20260912-03`：缺失 Next.js request scope 的直接 Route 测试。
- `KTF-20260912-07`：固定日期 fixture 已过期。

## 疑似真实回归

NONE。当前 7 条首轮失败中，4 条已通过补齐本地测试运行环境复跑为 PASS；其余 3 条均有可复核的测试 harness / fixture 证据，未发现指向业务实现错误的断言证据。

## 第 0 步打印链路确认

`tests/cashier-network-print-v01.test.ts` 已在新建的一次性 PostgreSQL 集群上真正进入并完成 25 个用例，最终输出 `Network V0.1 database integration PASS (25)`。没有为了测试结果修改任何业务代码、测试断言、schema 或 migration。
