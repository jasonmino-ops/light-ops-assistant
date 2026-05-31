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
