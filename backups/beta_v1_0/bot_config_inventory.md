# Telegram Bot 配置清单 — Beta v1.0

> 本文件记录系统使用的 Bot 用户名、角色、webhook、依赖。**实际 token 不写入本文件**。

## 元信息

| 项 | 值 |
|----|----|
| 备份时间 | 2026-05-14 |
| 关联 git commit | `6da913a` |
| 关联 tag | `beta-v1.0-commercial-trial` |

## Bot 总览（3 个）

| Bot | 角色 | 用户名（参考） | Webhook | 关键 env |
|-----|------|---------------|---------|----------|
| **商户端 Bot** | OWNER / STAFF 绑定 + 商户通知（接单 / 销售 / 退款 / 收款提醒） | `qingdianboss_bot`（值在 `.env` `TELEGRAM_BOT_USERNAME`） | `POST /api/webhook/merchant` | `TELEGRAM_BOT_TOKEN` 或 `TG_BOT_TOKEN`、`MERCHANT_WEBHOOK_SECRET` 或 `TG_WEBHOOK_SECRET`、`TELEGRAM_BOT_USERNAME` |
| **顾客端 Bot** | H5 顾客主动绑定（`/start bind_<storeCode>_<orderNo>`） + 欢迎引导 + Mini App | `Eshop_sale_bot`（值在 `.env` `NEXT_PUBLIC_CUSTOMER_BOT_USERNAME` / 代码注释） | `POST /api/webhook/customer` | `CUSTOMER_BOT_TOKEN`、`CUSTOMER_WEBHOOK_SECRET`、`NEXT_PUBLIC_CUSTOMER_BOT_USERNAME` |
| **OPS 运营 Bot** | 运营后台审核 / 通知 | （独立 token，配置在 `.env` `OPS_BOT_TOKEN`） | `POST /api/tg-admin`（独立路径） | `OPS_BOT_TOKEN`、`OPS_USER_IDS` / `OPS_TG_IDS` |

> ⚠️ 上表 username 仅供参考，**以 .env 为准**。如更换 bot，必须同步更新所有引用点（见下文「依赖关系」）。

## 1. 商户端 Bot

### 角色
- 老板/员工通过 BindToken `/start <token>` 完成账户绑定 → 写入 `User` 表 `telegramId`
- 顾客 H5 下单后向 OWNER 发通知（`notifyOwner` in `/api/public/orders`）
- 退款 / 接单 / 销售确认等关键事件通知

### Webhook 配置
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${NEXT_PUBLIC_APP_URL}/api/webhook/merchant" \
  -d "secret_token=${MERCHANT_WEBHOOK_SECRET}"
```

### BotFather 命令推荐
```
start - 开始 / 绑定
bind - 绑定老板/员工码
home - 进入商户后台
sale - 销售
records - 记录
help - 帮助
```

### Mini App / WebApp URL
- 商户端 Mini App: `${NEXT_PUBLIC_APP_URL}/home`（OWNER）`/sale`（STAFF）
- 在 BotFather → My bots → Bot Settings → Menu Button → Configure Menu Button → Web App URL

## 2. 顾客端 Bot

### 角色
- 顾客在 H5 下单成功后跳 `t.me/<customer_bot>?start=bind_<storeCode>_<orderNo>` 完成绑定
- bot webhook 处理 `/start bind_*` payload → upsert `StoreCustomerContact`
- 无参 `/start` 时回复欢迎 + Mini App 按钮（"🛍️ 查看商品"）
- **不主动通知顾客订单状态**（v1 范围外）

### Webhook 配置
```bash
curl "https://api.telegram.org/bot${CUSTOMER_BOT_TOKEN}/setWebhook" \
  -d "url=${NEXT_PUBLIC_APP_URL}/api/webhook/customer" \
  -d "secret_token=${CUSTOMER_WEBHOOK_SECRET}"
```

### BotFather 命令推荐
```
start - 开始 / 扫码点单
menu - 查看商品
orders - 我的订单
help - 联系商家
```

### Mini App / WebApp URL
- 顾客端 Mini App: `${NEXT_PUBLIC_APP_URL}/menu?code=${DEFAULT_STORE_CODE}`
- BotFather → 同上配置

### Deep Link 模板
| 用途 | 模板 |
|------|------|
| 顾客主动绑定 | `https://t.me/<customer_bot>?start=bind_<STORECODE>_<ORDERNO>` |
| 顾客主动绑定（无订单号） | `https://t.me/<customer_bot>?start=bind_<STORECODE>` |
| Mini App 直进 | `https://t.me/<customer_bot>?startapp` |

## 3. OPS 运营 Bot

### 角色
- 运营审核开店申请 / 后台管理员通知
- 严格限制在 `OPS_USER_IDS` / `OPS_TG_IDS` 白名单内

### Webhook
- 接入 `/api/tg-admin`
- 配置同上模式（如启用）

## 依赖关系

| 引用点 | 依赖的 env |
|--------|-----------|
| `/api/public/orders` 的 `notifyOwner` | `TELEGRAM_BOT_TOKEN` |
| `/api/webhook/merchant` | `TELEGRAM_BOT_TOKEN` / `MERCHANT_WEBHOOK_SECRET` |
| `/api/webhook/customer` | `CUSTOMER_BOT_TOKEN` / `CUSTOMER_WEBHOOK_SECRET` |
| /menu 下单成功页绑定按钮 | `NEXT_PUBLIC_CUSTOMER_BOT_USERNAME` |
| /invite 邀请码生成 | `TELEGRAM_BOT_USERNAME` |
| `/api/tg-admin` 运营接口 | `OPS_BOT_TOKEN` / `OPS_USER_IDS` |

## 恢复 / 切换 Bot 操作清单

如更换任一 bot：

1. **BotFather 新建 bot 或 token 轮换**
2. **配置 BotFather**
   - Set Menu Button → Web App URL
   - Set Commands（参照上方推荐命令）
   - Enable Inline mode（如需要）
3. **Vercel env 同步**
   - 更新对应 token / username 三件套
   - 重新部署
4. **重设 webhook**（用 curl 命令上文）
5. **数据库不需要改**（绑定关系存在 `User.telegramId` / `StoreCustomerContact.telegramId`，与 bot 无关）
6. **现有用户重新绑定**（仅老 bot 不可用时；新 bot 收到的 `/start` 无 token 时引导走 /invite 重生成）

## 已知边界（v1.0 内不做）

- ❌ 顾客侧主动推送订单状态变化（CO PENDING→CONFIRMED→COMPLETED 不发通知顾客）
- ❌ Bot 内置支付 / 银行回调
- ❌ 多 bot 矩阵 / 多商户独立 bot
- ❌ Inline mode 商品搜索
- ❌ Webhook 重试队列（依赖 Telegram 自身重试机制）
