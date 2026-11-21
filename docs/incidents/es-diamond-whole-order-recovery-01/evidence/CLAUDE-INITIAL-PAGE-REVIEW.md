## 最终审查结论（仅限本 hunk + case.ts 守卫 + DiamondRecoveryAction 组件）

**判定：PASS WITH BLOCKERS**
可见代码中**无已确认 P0**；但存在 1 项**条件性 P0（本上下文无法核验，若成立则立即升级）**，以及 9 项 P1。不推断 Production readiness——现场阻断项与 Scope/Lineage 仍为 BLOCKED。后端幂等/出纸语义归另一独立审查。

---

## 一、已在所提供源码中核验通过的点

| 审查项 | 结论 | 依据 |
|---|---|---|
| 精确 store/hold 路由 | 通过 | `isDiamondRecoveryHold` 为 `storeCode === 'ST883DC00C'` **全等** + `holdIds.some(v => v === id)` **全等成员**；无前缀/包含/正则/大小写归一化，无通配面。`storeCode` 为 `null/undefined` 时返回 `false`（走原分支）。 |
| 其他门店零行为变更 | 通过 | 三元 false 分支内两个按钮的 `style/onClick/文案` 与改前逐字符一致，仅外加一个无 key 需求的静态 `<>…</>`；Fragment 不产生渲染/重挂载差异。 |
| 保留普通 handler | 通过（基于所提供对照） | `handleRestoreHoldOrder` / `handleDeleteHoldOrder` 函数体未改，仍由 false 分支调用。注意：这是**您提供的对照文本**，我无法独立对 Production base 取 diff（见限制 L1）。 |
| 原挂单保全 | 通过 | 组件全程**未调用** `setCart` / `setCheckoutStep` / `removeHoldOrder` / `setHoldOrders` / `handleRestoreHoldOrder`；命中 4 个 id 时 Restore/Delete 按钮被移除，收银员无法在该行删除；另写 `BACKUP_KEY` 快照并做 `sha256(snapshot)` 自校验 + `canonicalCart(backup.cart)` 对账。 |
| 无结账/打印耦合 | 通过 | 组件仅做 `fetch(ENDPOINT)` 与自有两个 localStorage key；未触碰购物车、checkoutStep、`finishPosRequest`/`posRequestKey`、任何打印调用。打印由服务端在 `COMMITTED_WAITING_PRINT` 触发，前端只读状态。 |
| 一次性提交（同设备） | 通过 | `busy` ref + `attempted` ref + **先持久化 `ATTEMPT_KEY` 再发 POST**；`readStatus` 对 `attempted && READY` 强制降级为 `UNKNOWN`，杜绝"查询后重试"回路；POST 任何异常一律 `UNKNOWN` 且不再开放重试。`attempted.current` 的赋值在 `setValid` 之后、首个 `await` 之前同步完成，不存在"已 valid 未 attempted"的可渲染窗口。 |
| 并发闸门 | 通过 | `idle = isDesktopPos && cart.length === 0 && !submitting`，`submit()` 内二次校验 `!idle` 直接 return。 |

---

## 二、条件性 P0（本上下文不可核验，请在合入前以代码确认）

**P0-C1：挂单行父元素/其他渲染点可能仍存在恢复入口。**
本 diff 仅替换了 `<div style={s.sideEventActions}>` **内部**的两个按钮。我看不到其父节点（`s.sideEventRow`/卡片容器）的 props，也看不到 `handleRestoreHoldOrder` 的其他调用点。
若满足以下任一条件，则本方案的"原单不可被还原"前提被击穿，收银员可能把 135.43 单重新拉回购物车并二次收款 → **升级为 P0**：
1. 挂单行容器本身带 `onClick/onDoubleClick/onPointerUp` 调用 `handleRestoreHoldOrder`；
2. 挂单列表在第二处渲染（弹窗/移动端/快捷键面板），该处未经 `isDiamondRecoveryHold` 分流；
3. 存在"恢复最近挂单"快捷键或页面加载自动恢复逻辑。

必须验证命令（我无法执行）：`rg -n "handleRestoreHoldOrder|holdRestoreBtn|sideEventRow" app/ --type ts --type tsx`，要求恢复入口**有且仅有**本 hunk 一处。

---

## 三、P1

**P1-1　校验期必现"原单校验未通过"假告警。**
`message` 计算为 `!valid && selected ? d.changed : …`。点击"选择原挂单"后，`setSelected(true)` 的渲染必然先于 effect 中 `digest()` 的异步 resolve，因此**每次都会闪现**"原单校验未通过，请联系技术人员 / Original hold verification failed"。在本案现场语境下，这条文案等同于"停手并上报"，会直接制造误报与不必要的中止。
修复：引入第三态（`valid: null | boolean`），`null` 时显示"正在校验原单"，仅 `false` 才显示 `d.changed`。

**P1-2　主按钮禁用无原因可见。**
`disabled={!valid || !idle || state !== 'READY' || attempted.current}`，而 `message` 在 `idle=false` 时仍显示 `d.ready`（"现金已收，无需再收款"）。收银员会看到一个"可做但点不动"的按钮，且得不到"请先清空购物车 / 请在桌面端 POS 操作"的提示。现场必然转化为电话求助或反复点击。
修复：当 `valid && state==='READY' && !idle` 时输出明确的前置条件文案（三语）。

**P1-3　浏览器能力/安全上下文依赖，失败模式为"零服务端接触的永久锁死"。**
`crypto.subtle`（仅 secure context）与 `AbortSignal.timeout`（Chrome 103+/Safari 16+）均无降级分支。
- 若 POS 以 `http://` 局域网 IP 运行：`crypto.subtle` 为 `undefined` → `digest` 抛错 → `valid=false`、`UNKNOWN`。属安全失败（不发 POST），但功能 100% 不可用。
- 更严重：`submit('recover')` 中 **`ATTEMPT_KEY` 先于 `fetch(...)` 写入**，而 `AbortSignal.timeout(85000)` 是在 fetch 实参里求值的。旧 WebView 下该表达式抛 `TypeError`，被 catch → `UNKNOWN`，但 `attempted` 已持久化为 true，**服务端从未收到任何请求，前端却永久拒绝再次提交**，只能靠改代码/清 storage 解锁。
修复：上场前实测该机型（Chrome 版本 + 是否 HTTPS/localhost）；代码侧先构造 `signal`（或做能力探测）成功后再写 `ATTEMPT_KEY`。

**P1-4　防重放是设备本地的，跨设备无保护。**
`ATTEMPT_KEY`/`BACKUP_KEY` 未按 store/hold 作用域命名，且仅存于当前浏览器 profile。换机、清缓存、无痕窗口、第二台 POS 均会重新呈现 `READY` 并允许再发一次 POST。本 hunk 内无法修复——**重复入账的唯一防线是后端以 `holdId + cartSha256` 做幂等**。若后端幂等不成立，此项即为 P0（归属另一审查）。现场流程上应约定"仅限一台指定设备操作"。

**P1-5　终局无退出路径（4 个挂单永久滞留）。**
守卫是硬编码常量，无"已完成即解除"分支：
- 3 个别名挂单永远只渲染 `d.alias` 文本，**既不能恢复也不能删除**（证据保全意图正确，但无移除方案）；
- 原单在 `PAPER_CONFIRMED` 之后依然留在挂单列表，并继续计入 `heldCount` 与侧栏合计金额，显示"原挂单已锁定"。
门店侧栏将长期带 4 条不可消除的挂单与被污染的合计。需在本次变更一并给出下线/清档的具体步骤与负责人，不能留作"以后再说"。

**P1-6　设备头取值应使用已证明常量。**
`posDeviceHeaders(order.storeCode)` 取自本地挂单对象的字段，而守卫判定用的是页面 `storeCode`。两者理论上可因本地存储污染不一致，导致请求头声明的门店与被守卫放行的门店不同。
修复：改为 `posDeviceHeaders(DIAMOND_RECOVERY.storeCode)`（零成本，且与服务端校验口径一致）。

**P1-7　轮询无上限、无退避。**
第二个 effect 依赖 `[selected, status]`，而 `readStatus` 每次都 `setStatus(新对象)`，引用必变 → 只要状态停在 `PROCESSING` 或 `COMMITTED_WAITING_PRINT`，页面开着就**无限 2s 轮询**。单店负载不大，但出纸长期未回执时没有"超时转人工"语义。
修复：累计超过阈值（如 3–5 分钟）后置 `UNKNOWN` 并提示联系技术。

**P1-8　未加样式的原生按钮注入 POS 侧栏。**
其余分支用 `s.holdRestoreBtn` / `s.holdDeleteBtn`，本组件在 `s.sideEventActions`（推测为 flex 行）内塞入 `display:grid; maxWidth:290` 的块与 3 个默认样式 `<button>`。触屏 POS 上命中区偏小、与原布局不一致，存在误触与串行按错风险。需在真机截图验收。

**P1-9　挂单存储的保全性未证。**
本改动只阻断了"收银员手动删除"。若 `loadHoldOrders/removeHoldOrder` 侧存在 TTL、条数上限或启动期清理，原单仍可能被自动淘汰。证据包中已有 `frozen/held-orders.json` 服务端快照（这是正确的缓解），但客户端侧的自动淘汰行为需明确核验并记录。

---

## 四、P2 / 备注（不阻断）

- `PAPER_CONFIRMED` 后"恢复入账并打印"按钮仍以 disabled 状态常驻，建议终态隐藏以降低误解。
- `copy` 以 `lang` 字符串回落 `zh`，安全；但 `lang` 未用联合类型，拼写错误只会静默回落。
- `canonicalCart` 的 key 排序为 UTF-16 码元序且不处理 `undefined`/循环引用；对本案固定载荷无影响，但它与服务端规范化实现必须逐字节一致（属后端审查范围）。

---

## 五、核验限制（本次确实做不到的事）

- **L1**：无任何工具、无法读取仓库。`handleRestoreHoldOrder`/`handleDeleteHoldOrder` 的"未改动"结论完全依赖您粘贴的对照 JSON 与 manifest SHA256 `31bbde37…`，我**未能**自行对 Production base 执行 diff，也未能独立复算该 manifest。
- **L2**：看不到挂单行父元素、`s.sideEventActions` 样式、`HoldOrder<CartLine, DesktopCheckoutStep>` 的实际字段定义。因此 (a) P0-C1 无法排除；(b) 无法确认 `HoldOrder` 结构性兼容组件局部 `Hold` 类型（需 `storeCode: string`、`createdAt: string`，`cart: CartLine[]` → `unknown[]` 可赋值）。您的 `build.log` 若为绿，则 (b) 已被编译器覆盖，但我未读取该日志。
- **L3**：未核验 `posDeviceHeaders`、`removeHoldOrder`、`loadHoldOrders` 的实现，故 P1-6/P1-9 以"须确认"形式给出。
- **L4**：后端 `/api/cashier/recovery/diamond-13543` 的幂等性、状态机与出纸语义不在本次范围；P1-4 的最终定级取决于该审查结果。
- **L5**：未进行真机/浏览器能力验证（P1-3）与视觉验收（P1-8），这些只能在现场设备上完成。