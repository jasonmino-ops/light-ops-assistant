# 优惠券最小闭环 E2E 验收清单

覆盖范围：P1 数据底座 → P2 商户发券 → P3 顾客券页 → P4 结算核销。

不通过任一条都视为发布阻塞。逐项打勾。

## 现状说明

- `CouponRedemption` 仅对 `orderNo` 有唯一约束，**没有** `couponId` 唯一约束。重复核销目前靠：
  1. `CustomerCoupon.updateMany WHERE status='AVAILABLE' …` 的影响行数（事务级单券防护）
  2. `CustomerOrder.orderNo` 唯一 → 同一笔订单不会写出两条 redemption
- 若未来要支持「同一张券分多次扣减」，必须重新评估这个约束。本期为一次性整张使用，足够。

---

## 一、模板 API（P1）

- [ ] **C1**：以 OWNER 身份 `GET /api/coupons/templates`，首次返回 3 张默认满减模板（满 50 减 5 / 满 100 减 10 / 满 200 减 20）；再次调用返回相同 id（不重复 seed）。
- [ ] **C2**：以 STAFF 身份调用同接口返 403 `FORBIDDEN`；未登录返 401。

## 二、商户单人发券（P2）

- [ ] **C3**：`/customers` 顾客 Drawer 点「🎫 发送优惠券」→ 选模板 → 确认；toast 提示「发券成功（已通知顾客）」；该顾客 Telegram 收到「🎫 发券通知」消息。
- [ ] **C4**：对同一顾客同模板再发一次 → 单人接口返 409 `ALREADY_HAS`，前端 toast「该顾客已持有同款可用券」。

## 三、商户批量发券（P2）

- [ ] **C5**：顶部「🎫 批量发券」→ 选模板 → 确认；toast 显示「批量发券完成：成功 X / 跳过 Y / 失败 Z · 已通知 N」。`CouponIssueBatch.totalCount/successCount/failedCount` 与 toast 数字一致。
- [ ] **C6**：临时把 `CUSTOMER_BOT_TOKEN` 置空再批量发券，`CustomerCoupon` 仍正常落盘 success > 0，但 `notified=0`；说明通知失败不影响发券成功。

## 四、顾客 H5 /me 入口（P3）

- [ ] **C7**：Telegram 内打开 `/me?code=<storeCode>`，资产格子「优惠券」数字 = 当前可用券数；点击跳转 `/me/coupons?code=...`。
- [ ] **C8**：普通浏览器（无 `Telegram.WebApp.initData`）打开 `/me`，优惠券数字显示 0，不报错；进入 `/me/coupons` 显示提示「请在 Telegram 内打开」。

## 五、/me/coupons 三分类（P3）

- [ ] **C9**：在 DB 把同一顾客的三张券分别置为 `AVAILABLE / USED / expiresAt < now`，刷新 `/me/coupons`，三 tab 各显示 1 张且 tab 数字正确；过期分类来自响应端按 `expiresAt` 实时判定，`AVAILABLE` 行 DB status 未被改写。
- [ ] **C10**：「去使用」按钮跳转 `/menu?code=...&couponId=<id>`。

## 六、/menu URL 携券（P4）

- [ ] **C11**：通过 C10 的链接进入 `/menu`，加货物到购物车 → 点结算；优惠券行自动选中目标券；「已优惠」和「应付」金额与该券一致。

## 七、/menu 手动选/取消（P4）

- [ ] **C12**：点优惠券行打开抽屉，可在「不使用 / 多张可用」之间切换；选「不使用」时已优惠 = $0，应付 = 商品金额。
- [ ] **C13**：不可用券（未满 minSpend）以灰色显示并标「未满 $X 不可用」，无法被选中。

## 八、minSpend 自动降级（P4）

- [ ] **C14**：选中一张满 100 减 10 的券后，把购物车减到 < $100，确认弹窗内该券自动从选中变为未选；橙色提示「需满足最低消费方可使用」；「应付」回到购物车合计。

## 九、下单成功核销（P4）

- [ ] **C15**：选好可用券、点「确认提交」→ 成功弹层显示金额 = 后端 payable。数据库 3 处一致：
  - `CustomerOrder.totalAmount` = `subtotal − discount`
  - `CustomerCoupon.status='USED'` + `usedAt` + `usedOrderNo=<orderNo>`
  - `CouponRedemption` 1 行（`orderNo / couponId / telegramId / discountAmount` 全填）。

## 十、并发重复核销（P4）

- [ ] **C16**：两个 Tab 同时下单使用同一张券；其一返 200，其二返 409 `COUPON_ALREADY_USED`；DB 只有一条 `CouponRedemption`，`CustomerCoupon.usedOrderNo` 指向成功的那笔订单。

## 十一、过期 / 已用拦截（P4）

- [ ] **C17**：手工把库里某张 `AVAILABLE` 券 `expiresAt` 改到过去 → 下单提交返 400 `COUPON_EXPIRED`，无订单产生。
- [ ] **C18**：把券改为 `USED` → 提交返 400 `COUPON_INVALID`，无订单产生。

## 十二、跨商户拦截（P4）

- [ ] **C19**：把另一商户的 `couponId` 强行写入 `POST /api/public/orders` body → 返 400 `COUPON_INVALID`，无订单产生；事务内 updateMany 由 `tenantId` 兜底再次拦截。

## 十三、非 TG 强行带 couponId 拦截（P4）

- [ ] **C20**：普通浏览器（无 `customerTelegramId`）直接 `POST /api/public/orders` 携 `couponId` → 返 400 `COUPON_NEED_TG`，无订单产生。

---

## 真机最小子集（10 项）

如时间有限，至少覆盖 **C1 / C3 / C5 / C9 / C11 / C14 / C15 / C16 / C17 / C19**。
