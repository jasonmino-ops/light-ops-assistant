# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # 启动开发服务 → http://localhost:3000
npm run build        # 生产构建（Vercel 部署触发此命令，不执行迁移）
npx prisma generate  # 重新生成 Prisma Client（改 schema 后运行）
npx prisma migrate dev --name <描述>   # 本地创建迁移文件
npm run migrate:prod  # 生产迁移（需先 export DIRECT_URL=<supabase直连串>）
npx prisma db seed   # 注入种子数据（幂等）
```

无测试框架，验收靠 `npm run build` 通过 + 手动真机验证。

## 身份认证与上下文

**两种身份来源（按优先级）：**

1. **生产：** Telegram WebApp `initData` → `POST /api/auth/telegram` 验签 → `auth-session` 签名 Cookie（`lib/session.ts` HMAC-SHA256）
2. **本地开发：** `x-tenant-id / x-user-id / x-store-id / x-role` headers，由 `lib/api.ts` 的 `apiFetch()` 自动注入

所有 API 路由通过 `lib/context.ts` 的 `getContext(req)` 读取当前用户。返回 `null` 则 401。`role` 只有 `OWNER` 和 `STAFF` 两种。

**本地切换身份：** `.env` 中设 `DEV_ROLE=OWNER` 或 `DEV_ROLE=STAFF`；`lib/api.ts` 的 `STAFF_CTX` / `OWNER_CTX` 常量写死了种子账户，前端直接用 `apiFetch()` 调用。

## 前端架构

**框架：** Next.js 15 App Router，全部页面为 `'use client'`（除 `app/layout.tsx` 这一个 Server Component）。

**全局 Provider 嵌套（`app/layout.tsx`）：**
```
LangProvider → WorkModeProvider → {children} + BottomNav
```

- `LangProvider`：中/柬双语，`t('sale.xxx')` 查 `lib/i18n/zh.ts` 或 `km.ts`，`localStorage` 持久化
- `WorkModeProvider`：从 `/api/me` 获取 `tier`（`LITE` / `STANDARD` / `MULTI_STORE`）和 `checkoutMode`；OWNER 可切入 STAFF 模式；`useWorkMode()` 全局可用

**商品档次（tier）驱动扫码行为：**
- `LITE`：仅摄像头扫码，无蓝牙扫码枪（HID）支持
- `STANDARD` / `MULTI_STORE`：HID 蓝牙扫码枪优先，摄像头作为备用

**样式：** 纯 inline `CSSProperties` 对象（无 CSS Modules / Tailwind），统一使用 `var(--blue)` / `var(--red)` / `var(--card)` 等 CSS 变量（定义在 `app/globals.css`）。

## 数据库

**ORM：** Prisma 7 + `@prisma/adapter-pg`（PgBouncer 连接池兼容适配器），单例在 `lib/prisma.ts`。

**关键模型关系：**
```
Tenant → Store → User（UserStoreRole 多对多）
Tenant → Product（含 ProductCategory 两级分类）
Store → SaleRecord（recordNo 唯一，orderNo 同一笔订单共享）
SaleRecord ←→ PaymentIntent（orderNo 关联）
SaleRecord → SaleRecord（退款自引用，originalSaleRecordId）
```

**结账模式（`Store.checkoutMode`）：**
- `DIRECT_PAYMENT`：扫码选品 → 立即选支付方式 → 完成
- `DEFERRED_PAYMENT`：扫码选品 → 先挂单（`PENDING_PAYMENT`）→ 后续结账

**Supabase 部署注意：** `DATABASE_URL` 用 PgBouncer 端口 6543（运行时），`DIRECT_URL` 用直连端口 5432（迁移专用）。迁移与 build 分离，`npm run migrate:prod` 单独手动执行。

## API 路由约定

- 所有路由从 `getContext(req)` 取 `{ tenantId, userId, storeId, role }`，再做权限判断
- STAFF 只能读/写自己 storeId 的数据；OWNER 可访问 tenantId 下全部数据
- 错误响应格式：`{ error: 'ERROR_CODE', message?: string }`

**核心端点：**
| 端点 | 说明 |
|------|------|
| `GET /api/me` | 当前用户的 tier / storeName / checkoutMode |
| `GET /api/products?barcode=xxx` | 按条码查单品；无参数返回全部 ACTIVE 商品（最多 500） |
| `POST /api/sales` | 销售提交（`saleType: SALE/REFUND`，`paymentMethod: CASH/KHQR/DEFER`） |
| `POST /api/orders/[orderNo]/checkout` | 挂单转收款 |
| `GET /api/sales/lookup?recordNo=xxx` | 查原销售单（退款第一步） |

## i18n 规范

翻译 key 定义在 `lib/i18n/zh.ts`（主语言），同步更新 `lib/i18n/km.ts`（柬埔寨语）。新增 key 必须两个文件同时加，否则 Khmer 用户会看到 key 字符串而非翻译文本。`t()` 函数支持点路径（如 `t('sale.notFound')`）。

## /sale 销售页关键逻辑

- `allProducts`：页面加载时一次性拉取全部 ACTIVE 商品，用于前端下拉过滤（不按条码逐个查询）
- `barcodeInput` 的变化触发 suggestions 过滤；Enter 键触发 `queryProductByBarcode()` 走 API
- 两个失败计数：`cameraFailCount`（摄像头失败）和 `hidFailCount`（HID 不匹配），≥5 显示对应提示条
- `isHidTier = tier === 'STANDARD' || tier === 'MULTI_STORE'` 控制 HID 提示是否出现
- `selectProduct(p)` 是商品选中的统一入口（下拉选、suggestion 点击均调用此函数）

---

# 店小二 / light-ops-assistant 项目开发约束

## 1. 当前主线

本项目当前处于 CarGarden 真实门店试跑前收口阶段，最高优先级是：

- 保持现有主流程稳定；
- 不破坏手机端 Telegram Mini App；
- 不破坏顾客 H5 点单；
- 不破坏电脑收银台 `/cashier`；
- 不破坏邀请码、桌号二维码、顾客点单链接；
- 不随意扩功能；
- 先最小可用，再逐步增强。

## 2. 修改边界原则

每次任务只允许修改用户明确要求的页面、接口或文件。

如果为了完成任务必须改动其他页面、接口、数据库结构或公共组件，必须先在回复中说明：

- 为什么必须改；
- 会影响哪些页面；
- 是否有替代方案；
- 是否需要用户确认。

未经用户明确确认，不允许顺手扩大修改范围。

## 3. 严禁顺手改动的稳定模块

除非用户明确要求，不得改动以下模块的业务逻辑：

- `/home` 首页主流程；
- `/invite` 老板码 / 员工码生成逻辑；
- `/table-qrcodes` 桌号二维码生成逻辑；
- `/m/[storeCode]` 顾客点单短链；
- `/menu` 顾客 H5 点单主流程；
- `/cashier` 电脑收银台核心结算逻辑；
- `/records` 销售记录；
- `/products` 商品管理；
- Telegram auth / TelegramInit / relogin 逻辑；
- 订单状态流；
- 销售记录写入接口；
- 数据库 schema / Prisma migration。

如需改动，必须先说明并等待确认。

## 4. 入口整理规则

入口可以调整展示位置，但不得改变原有功能归属：

- `/home` 只放日常经营高频入口；
- `/invite` 管理老板码、员工码、顾客点单链接、桌号二维码；
- `/cashier` 仅作为电脑收银台；
- `/table-qrcodes` 仅负责桌号二维码生成；
- `/m/[storeCode]` 和 `/menu` 负责顾客点单。

不得因为整理一个页面，就擅自删除另一个页面的入口。

## 5. 改动前自检

每次修改前必须先判断：

- 本次任务的最小改动范围是什么？
- 是否会影响手机端？
- 是否会影响顾客端？
- 是否会影响电脑收银台？
- 是否会影响真实门店试跑？
- 是否涉及数据库或权限？

如果答案不确定，先停下并询问。

## 6. 提交前自检

每次 commit 前必须确认：

- build 通过；
- 没有无关文件改动；
- 没有顺手重构；
- 没有改动用户未要求的核心流程；
- 若跨页面改动，必须在最终回复中列明原因。

最终回复必须包含：

- 修改文件；
- 改动范围；
- 是否影响现有流程；
- build 结果；
- commit hash；
- 用户需要验证的点。

## 7. 当前阶段禁止事项

在用户未明确要求前，禁止：

- 接 USB 打印；
- 接 mPOS；
- 重构权限系统；
- 重构订单状态流；
- 改数据库 schema；
- 扩复杂 token 体系；
- 大改 UI 结构；
- 删除已有入口；
- 合并多个业务模块；
- 引入新第三方服务。

---

# Obsidian Documentation Rules

## Purpose

本项目已建立 Obsidian 企业知识库。

所有重要开发活动必须同步沉淀到 Obsidian。

目标：

开发即留痕。

验收即归档。

知识持续积累。

---

## Documentation Required

以下情况必须生成 Obsidian 文档：

1. 新功能开发完成
2. 重大 Bug 修复
3. 数据库结构变更
4. API结构变更
5. SOP变更
6. 架构调整
7. 冻结文档更新
8. 灾备方案更新

---

## Obsidian Vault Path Rules

所有开发记录、收口记录、排障记录、SOP 沉淀，必须写入真实 Obsidian Vault：

`/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/`

开发记录默认写入：

`/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/`

不得默认写入项目仓库内的同名目录：

`/Users/jason/light-ops-assistant/05-开发记录/`

如果需要在项目仓库中保留技术文档，只能放在：

`/Users/jason/light-ops-assistant/docs/`

并且必须明确区分：

- 项目技术文档：`light-ops-assistant/docs/`
- 企业知识沉淀：真实 Obsidian Vault `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/`

每次业务开发完成后，如果属于功能开发、页面收口、API 调整、数据库变更或故障排查，必须同步真实 Obsidian Vault 中的开发记录。

最终回复必须包含：

- 业务 commit hash
- Obsidian 文件真实路径
- 是否同步到真实 Vault
- 是否误写项目仓库 `05-开发记录`

---

## Required Output

开发完成后必须额外输出：

### 修改文件

列出所有修改文件。

---

### Build Result

输出：

Build通过

或

Build失败

---

### Git Information

输出：

Commit Hash

Git Status

---

### Risk Level

输出：

低风险

中风险

高风险

---

### Obsidian Development Record

必须生成以下格式：

# YYYY-MM-DD 事项名称

## 问题

描述问题。

---

## 原因

描述根因。

---

## 修改文件

列出修改文件。

---

## 修改内容

说明修改内容。

---

## Build

通过 / 失败

---

## Commit

Commit Hash

---

## 风险

低 / 中 / 高

---

## 结果

最终结果。

---

## 建议归档

必须给出建议归档目录：

例如：

05-开发记录/开发日志

或

04-SOP

或

03-冻结文档/02-冻结过程资料

---

## Classification Rules

Claude 必须判断输出内容属于：

1. 冻结文档
2. SOP
3. 开发日志
4. Bug案例
5. 验收记录
6. 架构文档

并给出建议归档位置。

---

## Important

开发完成后：

先输出开发结果。

再输出 Obsidian 文档。

不得省略 Obsidian 文档部分。
