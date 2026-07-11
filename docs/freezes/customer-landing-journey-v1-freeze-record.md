# Customer Landing Journey Tracking V1 Freeze Record

## 1. 功能名称

Customer Landing Journey Tracking V1

## 2. 冻结日期

2026-07-11

## 3. 开发 Commit

`8bcfcbcdec30d937c767d0f456e9828e0ebcefc7`

## 4. Acceptance Record Commit

`2e34c0956fe78fa4b6599f265c18111e73121370`

## 5. Migration 名称

`20260711090000_add_customer_journey_event`

## 6. 生产部署状态

- 生产部署已包含开发 commit `8bcfcbcdec30d937c767d0f456e9828e0ebcefc7`。
- Vercel 生产部署状态已确认为 `READY`。

## 7. 数据库表与索引状态

生产 migration 已成功执行。

`_prisma_migrations` 已存在：

- `20260711090000_add_customer_journey_event`
- `finished_at` 有值
- `rolled_back_at` 为 `null`

生产数据库已存在：

- `public."CustomerJourneyEvent"`

已确认索引：

- `CustomerJourneyEvent_pkey`
- `CustomerJourneyEvent_eventKey_key`
- `CustomerJourneyEvent_storeId_eventType_createdAt_idx`
- `CustomerJourneyEvent_storeCode_createdAt_idx`
- `CustomerJourneyEvent_visitorId_createdAt_idx`
- `CustomerJourneyEvent_orderId_idx`

## 8. 四类事件验证结果

已通过真实生产数据确认四类事件均可落库：

- `landing_view`
- `landing_cta_click`
- `menu_arrival`
- `order_conversion`

## 9. visitorId 串联结果

已确认同一顾客旅程可通过 `visitorId` 串联。

## 10. orderId 关联结果

已确认 `order_conversion` 能关联真实 `orderId`。

## 11. 最终验收状态

`ACCEPTED WITH KNOWN LIMITATIONS`

## 12. 已知限制

以下限制不阻塞 V1 核心冻结，但必须保留：

1. 尚未专门执行 E-Life 下单不误归因为 landing 的专项回归。
2. 尚未专门执行桌号码下单不误归因为 landing 的专项回归。
3. 尚未专门执行直接菜单下单不误归因为 landing 的专项回归。
4. Bot“再次点单”未做专项归因回归。
5. `source`、`campaign` 未传入时为 `null`。
6. 本轮没有统计 Dashboard。
7. 本轮没有首次访问判断。
8. 本轮没有复访自动跳过逻辑。
9. 本轮没有复杂行业模板差异。
10. 本轮没有 Store 商户资料字段扩展。

## 13. 冻结范围

冻结以下能力：

- `/invite` 顾客码指向 `/m/[storeCode]`
- `/m/[storeCode]` 商户私域中间页
- landing 来源参数透传
- `landing_view`
- `landing_cta_click`
- `menu_arrival`
- `order_conversion`
- `CustomerJourneyEvent`
- `visitorId` 串联
- `orderId` 关联
- `sourcePlatform = landing`
- 生产 migration
- 索引结构
- 当前最小埋点边界

## 14. 冻结后禁止事项

冻结后不得在 V1 内继续：

- 增加 Dashboard
- 增加图表
- 增加首次访问判断
- 增加复访跳过
- 统一所有顾客入口
- 重构 E-Life
- 重构桌号码
- 重构 Bot 再次点单
- 拆分四套行业模板
- 扩展会员体系
- 扩展 Store 商户资料字段
- 改动 POS
- 改动支付
- 改动打印
- 改动 Telegram 绑定
- 改动订单状态机

## 15. 后续变更规则

如未来需要扩展，必须进入：

`Customer Landing Journey Tracking V2`

或作为独立缺陷修复任务处理。

任何后续变更必须重新走设计、实现、生产 migration、验收和冻结记录流程，不得在 V1 冻结范围内继续叠加新能力。

## 16. 最终冻结结论

Customer Landing Journey Tracking V1 已完成核心生产链路真实数据验证，最终状态为：

`ACCEPTED WITH KNOWN LIMITATIONS`

`FINAL FROZEN`
