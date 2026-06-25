# Dev-Gate-01A Change Scope Guard

## Task

- Task ID: Dev-Gate-01A
- Created: 2026-06-25

Dev-Gate-01A 是店小二项目的只读路径越界检查护栏，用于在开发批次中提前发现是否误改稳定主链。

## Main Chain Protection Scope

The guard protects stable real-store-trial paths and files that should not be changed accidentally during small development batches.

- `/menu` 顾客下单主链：顾客 H5 点单、checkout、订单入口属于真实门店试跑稳定链路。
- `/cashier` 收银主链：电脑收银 CASH / KHQR / 会员余额等收款入口需要避免无关批次误改。
- `/desktop/pos` 电脑端 POS：当前复用 cashier 主逻辑，任何 cashier 主文件改动都会影响桌面 POS。
- `/sale` 销售页：手机端销售页是店员现场销售主链。
- `/records` 销售记录：SaleRecord 展示、订单核对、试跑复盘依赖该页面稳定。
- `app/api/cashier` 收银 API：收银相关读写接口会影响桌面收银和现场业务。
- `app/api/members` 会员 API：会员余额、会员流水和会员识别属于资金相关能力。
- `app/api/sales` SaleRecord 写入相关 API：销售提交、退款和记录写入必须避免误改。
- `app/api/orders` 挂单、KHQR、checkout 相关路径：顾客订单、挂单转收款和支付状态链路需要保护。
- `prisma/schema.prisma`：数据库 schema 变更会影响迁移、线上数据和 Prisma Client。
- `prisma/migrations/**`：迁移目录属于数据库结构变更证据链，不能在非数据库批次中误动。
- `app/api/print/**`：打印 API 会影响小票、厨房单或后续云打印链路。
- `lib/cloudPrinter.ts`：云打印 provider 封装属于打印主链基础能力。
- `lib/session.ts`：会话签名与身份上下文基础文件。
- `lib/context.ts`：API 当前用户、门店、角色上下文基础文件。
- `middleware.ts`：全局请求入口和路由保护相关文件。

## Allowed Paths

- `app/m/[storeCode]`：Customer-PrivateLanding-01A 工作区。
- `docs/change-gates`：护栏配置与文档。
- `scripts/guards`：后续 Batch 2 脚本目录。

`allowed_paths` 不是强白名单；当前规则是“命中 forbidden_paths 即 BLOCKED，否则 PASS”。

## Batch Split

- Batch 1：只新增配置和设计文档。
- Batch 2：只新增 `scripts/guards/check-change-scope.js` 路径越界检查脚本。
- Batch 3：后续再考虑关键词扫描，不在本轮做。
- 后续再考虑 npm script、git hook、shell wrapper，不在本轮做。

## Usage Placeholder

```bash
node scripts/guards/check-change-scope.js --files "app/m/[storeCode]/page.tsx"
```
