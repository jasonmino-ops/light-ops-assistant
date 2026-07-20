# EP-BR-CD-01 Browser Customer Display Persistent Payment & Customer Entry Panel V1 — Evidence Pack

日期：2026-07-21

工程分支：`feat/ep-br-cd-01-customer-display-panel`
起始基线：`origin/main` @ `15dad1aae9972046258857985469ce13e51349e6`

## 1. 范围与基线

- 在隔离 worktree `/Users/jason/worktrees/ep-br-cd-01` 开发。
- 原主工作区 `feat/ep-mb3-06c-activation-pin-console`、其未提交文件及 `stash@{0}` 均未操作。
- 未 merge 或 cherry-pick 06C；本分支起点与 `origin/main` 一致。

## 2. API Boundary Exception Evidence

### 根因

原 `GET /api/pos/session/current` 在 `row && hasActiveItems` 的早期返回中固定输出：

```ts
storeKhqrImageUrl: null
```

因此顾客屏若在现金订单或进行中订单期间首次打开/刷新，右栏没有门店静态 KHQR 来源。纯前端无法取得该门店资料，且不能使用订单级二维码替代。

### 最小修复

仅修改 `app/api/pos/session/current/route.ts`：在活跃订单早期返回之前读取既有门店 KHQR 配置，并把已清洗的 `storeKhqrImageUrl` 填入顶层响应。未配置时仍为 `null`。

### 字段隔离

- `storeKhqrImageUrl`：门店级静态码；无论空闲、现金、KHQR 订单均可返回；顾客屏右栏唯一的二维码来源。
- `session.khqrImageUrl`、`session.khqrPayload`：订单级字段；未修改生成、写入、返回计算或支付语义，且不用于静态码渲染。
- API 路径、请求参数、session 写入、paymentMethod/paymentStatus、KHQR_FOCUS 和动态 KHQR 均未改变。

### 专项测试

`npx tsx tests/customer-display-session-current-static.test.ts`

覆盖：空闲店铺静态码、活跃现金订单、活跃 KHQR 订单、未配置静态码映射为 `null`，以及订单级 `khqrImageUrl`/`khqrPayload` 原有路径保留。

## 3. 页面实现证据

`/desktop/display?storeCode=...` 重构为单一常驻三栏 DOM：

| 区域 | 内容 | 二维码边界 |
| --- | --- | --- |
| 左侧 | 门店推荐、顾客 H5、加入会员、查看商品、手机下单 | 唯一的顾客 H5 二维码，目标为 `/m/<storeCode>` |
| 中间 | 商品名、数量、单价、小计、件数、应付金额 | 付款状态下继续可见 |
| 右侧 | 门店名、应付金额、门店静态 KHQR、付款提示 | 无 H5、会员或在线下单二维码 |

- 常态：22 / 52 / 26 三栏比例，右栏静态 KHQR 常驻。
- KHQR：18 / 42 / 40 三栏比例，右栏与金额放大；不换页、不遮罩。
- 现金：恢复常态比例，右栏继续展示静态 KHQR，并标识现金付款。
- 完成：左侧促活、中央完成金额，保持 5 秒；新订单状态会立即覆盖该状态。
- 取消/超时：仅短暂提示，过期后回 idle，不保留旧订单金额或促活。
- `KHQR_FOCUS` 仍被识别，但只增强既有右栏；没有全屏覆盖。

## 4. KHQR 无新请求证据

- 前端保留唯一既有轮询：`/api/pos/session/current?storeCode=...`。
- `storeKhqrImageUrl` 在每次既有轮询响应中独立更新，不受 session stale-response guard 阻断。
- KHQR/现金切换通过现有 BroadcastChannel 修改 session 状态；右栏始终使用同一 `storeKhqrImageUrl`，不读取订单二维码字段。
- Playwright 本地 mock 验证：切换为 KHQR 后无新增网络请求，新增 KHQR 请求数为 `0`。

## 5. 自动化与静态验证

全部通过：

```text
npx tsx tests/customer-display-session-current-static.test.ts
npx tsx tests/customer-display-panel-state.test.ts
npx tsx tests/customer-display-persistent-panel-static.test.ts
npx tsx tests/customer-display-cart-sync-static.test.ts
npx tsx tests/customer-display-realtime-channel.test.ts
npx tsx tests/customer-display-adapter.test.ts
npx tsc --noEmit --incremental false
npm run build
```

新增测试验证普通、KHQR、现金、完成 5 秒、新订单打断、取消/超时、空购物车、H5 目标、三栏比例、二维码隔离和三语文案。既有轮询、stale guard、BroadcastChannel 与 USB 顾客屏回归测试同样通过。

## 6. 浏览器自验

使用本地 mock 的静态门店 KHQR、现金订单和订单级 KHQR 字段进行验证：

| 验证项 | 结果 |
| --- | --- |
| 1366×768 现金态 | 三栏为约 289 / 682 / 341px，右栏含一个静态 KHQR 图像 |
| 1366×768 KHQR 态 | 三栏为约 256 / 600 / 455px，右栏扩大且金额放大 |
| 右栏二维码隔离 | `img[alt=KHQR] = 1`，右栏 SVG/H5 码数 = 0 |
| 顾客入口 | 左侧链接为 `/m/STORE-A` |
| 800×600 | 无横向溢出；金额、二维码和商品清单仍可读 |
| KHQR 切换网络 | 新增 KHQR 请求 = 0 |

本地 mock 环境中全局 `WorkModeProvider` 对未配置数据库的 `/api/me` 返回 500；这与顾客屏数据无关，页面自身无 runtime exception，production build 通过。

## 7. Windows 真机验收矩阵

| 场景 | Chrome / Edge | 1366×768 | 1920×1080 | 结果 |
| --- | --- | --- | --- | --- |
| 静态门店 KHQR 已配置，空闲 | 待验 | 待验 | 待验 | 右栏静态码可扫 |
| 现金订单中刷新顾客屏 | 待验 | 待验 | 待验 | 静态码仍在右栏，金额可读 |
| KHQR + KHQR_FOCUS | 待验 | 待验 | 待验 | 右栏放大，无遮罩/闪烁 |
| 完成后 5 秒与新订单打断 | 待验 | 待验 | 待验 | 促活与清理正确 |
| 取消、草稿超时、收款超时 | 待验 | 待验 | 待验 | 无旧金额残留 |

## 8. 手机扫码验收

1. 用手机扫描左栏 H5 码，确认进入 `/m/<storeCode>`，可见会员、商品和手机下单入口。
2. 用银行应用扫描右栏 KHQR，确认仅进入门店收款流程；右侧不得出现顾客服务码。
3. 分别在现金订单和 KHQR 订单期间刷新顾客屏，确认右栏静态码不消失。

## 9. 已知限制与回滚

- 门店未配置静态 KHQR 时，右栏明确显示未配置提示，不能替代为订单级二维码。
- 本工程不实现动态 KHQR、支付确认或二维码持久化缓存。
- 回滚方式：对本工程提交执行 `git revert <commit>`，即可同时恢复页面与唯一的读模型例外；不需数据库迁移或数据回滚。

## 10. 冻结边界检查

- 允许且已修改的 API：仅 `app/api/pos/session/current/route.ts`。
- 其他 API、Prisma/schema、desktop POS、cashier、sale、menu、records、打印链、Desktop Runtime、Windows Provider、BroadcastChannel 频道与消息 schema：零改动。
