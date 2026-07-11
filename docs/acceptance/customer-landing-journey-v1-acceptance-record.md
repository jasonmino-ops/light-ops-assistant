# Customer Landing Journey Tracking V1 Acceptance Record

## 1. 功能名称

Customer Landing Journey Tracking V1

## 2. 验收日期

2026-07-11

## 3. 验收 Commit

`8bcfcbcdec30d937c767d0f456e9828e0ebcefc7`

## 4. 生产部署状态

已执行：

```bash
npm run vercel:current
```

结果：

- Vercel project: `light-ops-assistant`
- Production URL: `https://light-ops-assistant-oaqkwi5bu-sunxiaojian0910-2556s-projects.vercel.app`
- Production commit: `8bcfcbcdec30d937c767d0f456e9828e0ebcefc7`
- Deployment State: `READY`
- Created Time: `2026-07-11T11:42:27.905Z`
- Commit Message: `Add customer landing journey tracking`

结论：

- 生产部署包含目标 commit。
- Vercel 部署状态为 READY。
- Vercel deployment URL 启用了 Vercel Protection，直接 HTTP 访问返回 401/302；公开域名 `https://elifekh.com` 可访问。

## 5. Migration 状态

已执行：

```bash
npx prisma migrate status
```

结果：

- 命令连接到 Supabase PgBouncer 地址后长时间无返回，约 90 秒后人工中止。
- 后续尝试使用 Prisma 只读查询确认 `CustomerJourneyEvent` 表和索引，但非沙箱数据库查询授权被拒绝，未能继续执行。

结论：

- migration 是否已在生产成功执行：无法确认。
- `CustomerJourneyEvent` 表是否真实存在：无法确认。
- 新增索引是否真实存在：无法确认。

## 6. 测试门店和 StoreCode

通过公开接口获取候选门店：

```bash
curl -i https://elifekh.com/api/e-life/featured-stores
```

结果包含：

- 门店名称：`Car Garden`
- storeCode：`STEBD310F2`
- businessType：`GENERAL`
- bannerUrl：`/api/public/stores/STEBD310F2/banner?v=1780285705352`

说明：

- 该门店来自公开 E-Life featured stores API，可作为 ACTIVE 候选门店。
- 未能通过 `/invite` 页面真实二维码确认该门店的顾客二维码，因为 `/invite` 需要商户身份和浏览器操作。

## 7. 测试设备和入口

本轮实际可执行环境：

- 设备：Codex 本地命令行环境
- HTTP 客户端：`curl`
- 公开域名：`https://elifekh.com`
- Vercel deployment URL：启用保护，无法直接作为公开验收入口

未执行：

- 手机真机扫码
- Telegram Mini App 内打开
- `/invite` 页面真实二维码扫描
- 真实顾客下单

## 8. 完整链路结果

### /m 页面

已执行：

```bash
curl -i https://elifekh.com/m/STEBD310F2
```

结果：

- HTTP 200
- 命中路径：`/m/[storeCode]`
- 页面展示 `Car Garden`
- 展示 `店小二 · 商户私域`
- 展示 `营业中`
- 展示业务类型 `通用商户`
- 展示主按钮 `立即下单`
- 主按钮 href 为 `/menu?code=STEBD310F2&from=landing`
- 头图使用 `bannerUrl`
- announcement：当前返回 `null`
- promoText：当前返回 `null`

### /menu 数据

已执行：

```bash
curl -i 'https://elifekh.com/api/public/menu?code=STEBD310F2'
```

结果：

- HTTP 200
- store.name：`Car Garden`
- isOpen：`true`
- businessType：`GENERAL`
- categories：有数据
- products：有数据

### 测试订单

未执行。

原因：

- 本轮没有人工授权创建真实生产测试订单。
- 无法从当前环境完成真机选品、确认下单、支付/订单后续处理验收。
- 不应通过脚本伪造真实顾客订单来制造通过结论。

## 9. 四类事件结果

### landing_view

未能确认数据库写入。

已确认：

- `/m/STEBD310F2` ACTIVE 页面可正常展示。
- 页面 HTML 加载了包含 tracking 逻辑的新 chunk。

未确认：

- `POST /api/public/landing-events` 是否由浏览器实际发出。
- 数据库是否产生 `landing_view` 事件。

### landing_cta_click

未能执行真实点击。

已确认：

- `/m/STEBD310F2` 主按钮 href 包含 `code=STEBD310F2&from=landing`。

未确认：

- 点击时是否真实写入 `landing_cta_click`。
- 埋点慢请求下是否仍不阻断跳转。

### menu_arrival

未能确认数据库写入。

已确认：

- `/api/public/menu?code=STEBD310F2` 可成功加载门店和商品。

未确认：

- 从 `/m` 点击进入 `/menu` 后是否真实写入 `menu_arrival`。
- `visitorId` 是否与前序事件一致。

### order_conversion

未执行真实订单创建，未能确认。

未确认：

- `CustomerOrder.sourcePlatform = landing`
- `campaignCode / campaignIntent`
- `order_conversion.orderId`
- 同一订单 conversion 去重

## 10. 测试订单结果

未创建测试订单。

原因：

- 当前验收环境无法进行授权真机下单。
- 未获得明确生产下单测试授权。
- 为避免污染真实门店订单，不通过脚本创建生产订单。

## 11. 非 Landing 入口回归结果

### 桌号码

未执行真机回归。

可确认范围：

- 本轮代码未修改 `/table-qrcodes`。
- 本轮线上 HTTP 验收未覆盖 `/menu?code=STEBD310F2&table=...` 下单。

### E-Life 店铺卡

部分确认。

已执行：

```bash
curl -i https://elifekh.com/api/e-life/featured-stores
```

结果：

- API 正常返回 featured stores。

未执行：

- 点击 E-Life 店铺卡进入 `/menu?code=...&from=e-life` 并下单。

### Bot 再次点单

未执行。

原因：

- 当前环境无法操作顾客 Telegram Bot 和 Mini App。

### 直接菜单

部分确认。

已执行：

```bash
curl -i 'https://elifekh.com/api/public/menu?code=STEBD310F2'
```

结果：

- HTTP 200
- 菜单数据正常返回。

未执行：

- 直接菜单下单并确认不保存 `sourcePlatform=landing`。

### 老板码 / 员工码

未执行入口操作。

说明：

- 本轮未修改老板码/员工码代码。
- 未通过 `/invite` 页面生成真实老板码/员工码做线上回归。

## 12. 重复事件验证

未能完成生产真机事件验证。

原因：

- 无法查询生产 `CustomerJourneyEvent`。
- 未进行浏览器自动化或真机操作。

代码层已知设计：

- `landing_view` 使用 `sessionStorage` + `eventKey` 做单页重复防护。
- 页面刷新可能产生新的页面生命周期，但同一天同 visitor/store 的 `landing_view` 使用相同 `eventKey`，服务端唯一键可去重。
- `landing_cta_click` 使用带时间戳的 `eventKey`，连续点击可能记录多次点击，符合“点击次数”语义，但仍会随页面跳转自然收敛。
- `menu_arrival` 使用 `sessionStorage` + `eventKey` 防止同一会话重复写入。
- `order_conversion` 使用 `eventKey = order_conversion:${order.id}` 防止同一订单重复 conversion。

## 13. 异常场景结果

### 不存在的 storeCode

已执行：

```bash
curl -i https://elifekh.com/m/NO_SUCH_STORE_CODE
```

结果：

- HTTP 200
- 页面显示错误文案：`链接不存在或已失效`
- 未能确认是否不记录 `landing_view`，因为无法查询数据库。

### 非法 eventType

已执行：

```bash
curl -i -X POST https://elifekh.com/api/public/landing-events \
  -H 'Content-Type: application/json' \
  --data '{"eventType":"bad_event","storeCode":"NO_STORE"}'
```

结果：

- HTTP 400
- 响应：`{"error":"INVALID_EVENT_TYPE"}`

### 客户端伪造 storeId

未执行生产请求验证。

代码层设计：

- `POST /api/public/landing-events` 不读取 `body.storeId`，只按 `storeCode` 查询 ACTIVE 门店。

### 超长 source / campaign / visitorId

未执行生产请求验证。

代码层设计：

- `source` / `campaign` 会清洗截断。
- `visitorId` 必须匹配格式，否则置空。

### 缺少 visitorId

未执行生产请求验证。

代码层设计：

- visitorId 可为空，事件仍可记录。

### 无效 campaign

未执行生产下单验证。

代码层设计：

- landing campaign 不影响商品、价格、支付、门店选择或订单金额。

## 14. 未执行或无法确认项目

- 生产 migration 是否成功。
- `CustomerJourneyEvent` 表和索引是否真实存在。
- `/invite` 页面顾客二维码真实指向。
- 二维码、明文链接、复制链接线上一致性。
- 手机真机扫码。
- landing_view 数据库事件。
- landing_cta_click 数据库事件。
- menu_arrival 数据库事件。
- order_conversion 数据库事件。
- 真实测试订单创建。
- 非 landing 来源下单不误归因。
- Bot 再次点单入口。
- 桌号点餐入口。
- 生产故障注入。

## 15. 已知限制

- Vercel deployment URL 被 Vercel Protection 保护，公开验收需使用 `https://elifekh.com`。
- 当前环境未获生产数据库只读查询能力，无法确认事件落库。
- `npx prisma migrate status` 在 PgBouncer 地址上长时间无返回，无法作为 migration 成功证据。
- 未进行真机扫码和真实订单创建，无法形成 ACCEPTED 结论。

## 16. 是否修改代码

否。本轮未修改业务代码。

本轮仅新增此 Acceptance Record。

## 17. 初次验收结论

`ACCEPTANCE BLOCKED`

阻塞原因：

1. 无法确认生产 migration 与 `CustomerJourneyEvent` 表/索引。
2. 无法查询数据库核对四类事件。
3. 未执行 `/invite` 真实二维码扫码。
4. 未创建真实测试订单，无法验证 `order_conversion` 与订单来源保存。
5. 未完成非 landing 入口真机回归。

## 18. 后续人工验收清单

1. 在生产数据库执行 migration 状态检查，并确认 `CustomerJourneyEvent` 表和索引存在。
2. 使用 OWNER 身份打开 `/invite`，确认顾客二维码、明文链接、复制链接一致且指向 `/m/STEBD310F2` 或选定测试门店。
3. 用手机扫码进入 `/m/[storeCode]`，确认 `landing_view` 落库。
4. 点击主按钮进入 `/menu`，确认 `landing_cta_click` 与 `menu_arrival` 落库且 visitorId 一致。
5. 创建一笔明确标记的测试订单，确认 `CustomerOrder.sourcePlatform = landing` 和 `order_conversion.orderId`。
6. 分别验证桌号码、E-Life 店铺卡、Bot 再次点单、直接菜单不会误记为 landing。

## 19. 最终验收补充记录

补充日期：2026-07-11

初次验收阻塞解除后，已通过生产环境和真实生产数据确认以下事实：

- production migration `20260711090000_add_customer_journey_event` 已成功执行。
- `_prisma_migrations` 已存在该 migration，`finished_at` 有值，`rolled_back_at` 为 `null`。
- 生产数据库已存在 `public."CustomerJourneyEvent"`。
- 预期索引已存在：
  - `CustomerJourneyEvent_pkey`
  - `CustomerJourneyEvent_eventKey_key`
  - `CustomerJourneyEvent_storeId_eventType_createdAt_idx`
  - `CustomerJourneyEvent_storeCode_createdAt_idx`
  - `CustomerJourneyEvent_visitorId_createdAt_idx`
  - `CustomerJourneyEvent_orderId_idx`
- 四类事件均已通过真实生产数据确认可落库：
  - `landing_view`
  - `landing_cta_click`
  - `menu_arrival`
  - `order_conversion`
- 同一顾客旅程可通过 `visitorId` 串联。
- `order_conversion` 可关联真实 `orderId`。
- 已有多组真实生产链路成功写入。
- `source`、`campaign` 在未带参数时为 `null`，属于当前 V1 设计行为。

最终验收状态：

`ACCEPTED WITH KNOWN LIMITATIONS`

最终冻结状态：

`FINAL FROZEN`
