# EP-BR-CD-01 Browser Customer Display Acceptance Record V1.0

## Document Identity

- Engineering Package: `EP-BR-CD-01 — Browser Customer Display Persistent Payment & Customer Entry Panel V1`
- Status: `ACCEPTED`
- Acceptance Date: `2026-07-21`
- Repository: `jasonmino-ops/light-ops-assistant`
- Acceptance Branch: `feat/ep-br-cd-01-customer-display-panel`
- Baseline: `15dad1aae9972046258857985469ce13e51349e6` (`origin/main`)
- Accepted Feature HEAD: `384deb5447b81eb5ce08559300c93b6c9d99c5aa`
- Acceptance Record Commit: assigned by this documentation commit and reported in the final execution record.

## Accepted Scope

- 三栏顾客屏：左侧门店推荐与顾客 H5，中间订单清单，右侧仅门店静态 KHQR 支付区。
- ORDER、CASH、KHQR、COMPLETED、CANCELLED、EXPIRED 与 IDLE 显示状态正确。
- B1 已关闭：完成促活或取消／超时提示到期后，中栏不再显示旧订单商品、金额或件数；新订单可立即打断完成态。
- 顾客 H5 与邀请页统一使用 `publicCustomerEntryUrl(storeCode)`；测试门店手机扫码目标为 `https://elifekh.com/m/ST169E7000`，不再生成 localhost。
- KHQR 图片可用空间扩大、H5 轻度缩小、付款提示三语精简、商品区轻度紧凑。
- CashierPage 两处 React inline-style shorthand 警告已关闭，未改变支付交易语义。

## Acceptance Gates

- Engineering scope complete: `PASS`
- B1 terminal-order privacy regression: `PASS`
- Public customer H5 entry: `PASS`
- Customer display realtime/session behavior: `PASS`
- Cashier inline-style warnings: `PASS`
- TypeScript: `PASS`
- Production build: `PASS`
- Founder Field Validation: `PASS`
- Frozen boundary integrity: `PASS`

## Founder Field Validation Evidence

Founder 在 Mac 现场确认：

- 手机扫描左侧顾客 H5 能打开正式公开域名。
- KHQR 与 CASH 切换通过。
- 完成交易约五秒后旧订单清空通过。
- 顾客屏及员工 POS 的现场验收通过。

此记录是现场确认事实，不替代自动化测试，也未伪造未执行的真机项目。

## Verification Evidence

- 原始测试输出：`docs/milestone-b/evidence/ep-br-cd-01-final-validation/tests.stdout-stderr.log`
- TypeScript 输出：`docs/milestone-b/evidence/ep-br-cd-01-final-validation/typescript.stdout-stderr.log`
- Build 输出：`docs/milestone-b/evidence/ep-br-cd-01-final-validation/build.stdout-stderr.log`

验证命令与退出码均记录在对应日志中。

## Approved API Boundary Exception

`app/api/pos/session/current/route.ts` 是本 EP 唯一批准的 API 例外。

- 根因：活跃订单早期返回把 `storeKhqrImageUrl` 固定为 `null`。
- 修复：在该早期返回前读取并返回门店级静态 `storeKhqrImageUrl`；未配置时仍为 `null`。
- 隔离：`session.khqrImageUrl`、`session.khqrPayload`、`paymentMethod`、`paymentStatus` 与交易写入语义未修改；未生成动态 KHQR。

## Frozen Boundary

- Prisma schema / migration: `unchanged`
- 支付模型、销售记账与 POS 交易业务逻辑: `unchanged`
- BroadcastChannel 名称与 schema、realtime protocol: `unchanged`
- 打印链、Desktop Runtime、Windows Provider、安装包、激活系统: `unchanged`
- Next.js version: `unchanged`
- 顾客屏无广告轮播、门店 Logo、动态 KHQR 或大规模响应式重构。

`app/cashier/page.tsx` 仅含两处 inline-style shorthand 的等价 CSS 属性拆分。

## Deferred Non-blocking Items

- 公共 URL 环境变量配置治理。
- `findKhqrConfig` TTL 与 try/catch。
- 更完整响应式断点、广告轮播、门店 Logo、完成态 H5 强化。
- 动态 KHQR 与 Windows 最终展示效果优化。

## Commit Chain

- `ab8b2facc61f7e47a71c4a668bf9bef7b7733913` — persistent payment panel.
- `9668561d1d47ca0c36a99ef8c24562b50948150e` — B1 old-order clearing fix.
- `38f9558fbf6f59bb0128cce89f66166ea588109e` — public H5 entry and visual refinement.
- `384deb5447b81eb5ce08559300c93b6c9d99c5aa` — Cashier inline-style warning fix.

## Formal Acceptance Decision

- Founder Acceptance: `CONFIRMED`
- Acceptance Decision: `ACCEPTED`
- Remaining Acceptance Blockers: `NONE`
- Ready to Merge: `YES`
- Ready for Final Freeze after main verification: `YES`
