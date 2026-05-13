# Vercel 环境变量备份清单 — Beta v1.0

> ⚠️ **本文件仅记录 key 名称、用途、关键度**。**严禁明文写入实际值**（token / secret / password）。
> 实际值请用 `vercel env pull .env.production --environment=production` 拉取到本地脱机存档。

## 元信息

| 项 | 值 |
|----|----|
| 备份时间 | 2026-05-14 |
| 关联 git commit | `6da913a` |
| 关联 tag | `beta-v1.0-commercial-trial` |
| 项目 | light-ops-assistant（Vercel） |
| 数据采集方式 | `grep -E "process\.env\.[A-Z_]+"` 全代码扫描 |

## 环境变量清单（按优先级排序）

### A 类 — 生产关键（缺失即整站故障）

| Key | 用途 | 出处文件 |
|-----|------|---------|
| `DATABASE_URL` | PgBouncer 连接串（6543），Prisma 运行时查询 | `lib/prisma.ts`、Prisma config |
| `AUTH_SECRET` | 自建 Cookie session HMAC-SHA256 签名密钥 | `lib/session.ts` |

### B 类 — 主链路关键（缺失对应链路不可用）

| Key | 用途 | 不配会怎样 |
|-----|------|----------|
| `NEXT_PUBLIC_APP_URL` | 生产域名（生成 Mini App / 短链） | Telegram Mini App 按钮失效；顾客点单短链 fallback |
| `TELEGRAM_BOT_TOKEN` 或 `TG_BOT_TOKEN` | 商户端 Telegram bot token（OWNER/STAFF 绑定 + 通知） | 商户 bot 完全不工作 |
| `TELEGRAM_BOT_USERNAME` | 商户端 bot 用户名（前端展示 + 邀请链接） | /invite 邀请二维码生成失败 |
| `CUSTOMER_BOT_TOKEN` | 顾客端 Telegram bot token（接收 /start bind_，回复绑定成功） | 顾客绑定不写入 StoreCustomerContact |
| `NEXT_PUBLIC_CUSTOMER_BOT_USERNAME` | 顾客端 bot 用户名（前端 t.me 链接拼接） | 下单成功页绑定按钮不渲染 |
| `OPS_BOT_TOKEN` | OPS 运营 bot token | 运营审核流不可用 |
| `TG_WEBHOOK_SECRET` | 商户 webhook secret_token 校验 | Telegram webhook 被全部 403 |
| `CUSTOMER_WEBHOOK_SECRET` | 顾客 webhook secret_token 校验 | 同上 |
| `MERCHANT_WEBHOOK_SECRET` | 商户专属 webhook secret | 同上 |

### C 类 — 功能模块依赖（缺失影响子模块）

| Key | 用途 | 不配会怎样 |
|-----|------|----------|
| `SUPABASE_URL` | Supabase Storage REST 端点 | 商品主图 / 门头图上传 500 STORAGE_NOT_CONFIGURED |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage 写入凭证 | 同上 |
| `ANTHROPIC_API_KEY` | AI 菜单识别（Claude Haiku 4.5 视觉） | /products AI 识别接口 500 AI_NOT_CONFIGURED |

### D 类 — 运营 / 后台辅助

| Key | 用途 |
|-----|------|
| `OPS_USERNAME` | OPS 后台登录用户名 |
| `OPS_PASSWORD` | OPS 后台登录密码（scrypt 校验） |
| `OPS_USER_IDS` | OPS 后台 Telegram 用户 ID 白名单（逗号分隔） |
| `OPS_TG_IDS` | OPS Telegram ID 白名单（兼容旧命名） |
| `TG_ADMIN_IDS` | 商户后台 Telegram 管理员 ID 白名单 |
| `FORWARD_CHAT_ID` | 客服支持消息转发目标 chat |

### E 类 — 配置 / 默认值（缺失走默认）

| Key | 用途 | 默认值 |
|-----|------|--------|
| `DEFAULT_STORE_CODE` | 顾客 bot `/start` 无参时默认门店 | `STORE-A` |
| `STORE_OPEN_CODE` | 开店申请验证码 | （无默认；缺失则开店申请走旁路） |
| `TENANT_ID` | seed 用 tenant id | （seed 脚本用） |
| `DEV_ROLE` | 本地 dev 模式切换 OWNER/STAFF | `OWNER` |
| `NODE_ENV` | Node 环境（Vercel 自动注入） | `production` |

### 不在 Vercel — 仅运维持有

| Key | 说明 |
|-----|------|
| `DIRECT_URL` | Supabase 直连串（5432），仅迁移用，**不挂到 Vercel**，存于本地 `.env` 或 1Password |

## 恢复操作

### 1. 离线拉取当前 Vercel env 到本地（建议每月跑一次）

```bash
cd light-ops-assistant
vercel link  # 第一次跑会绑定项目
vercel env pull .env.production.backup --environment=production
# .env.production.backup 加入 .gitignore，存到 1Password / 加密 U 盘
```

### 2. 灾难恢复到新 Vercel 项目

```bash
# 1. 新建 Vercel 项目，关联同 GitHub repo
# 2. 在 .env.production.backup 基础上，使用 vercel env add 批量回填
while IFS='=' read -r key val; do
  [[ "$key" =~ ^[A-Z_]+$ ]] && echo "$val" | vercel env add "$key" production
done < .env.production.backup
# 3. Vercel Dashboard → Settings → Environment Variables 二次核对
# 4. Redeploy production
```

### 3. 单 key 紧急更新

Vercel Dashboard → Project → Settings → Environment Variables → Edit → 输入新值 → Save → Redeploy

## 检查清单（部署前必过）

- [ ] `DATABASE_URL` 指向正确 Supabase project（grkkevuebaaramqvuocd）
- [ ] `AUTH_SECRET` 与原值一致（否则现有顾客 / 商户 session 全失效）
- [ ] 4 个 webhook secret（TG_WEBHOOK_SECRET / CUSTOMER_WEBHOOK_SECRET / MERCHANT_WEBHOOK_SECRET）已配
- [ ] Bot username 三件套：TELEGRAM_BOT_USERNAME / NEXT_PUBLIC_CUSTOMER_BOT_USERNAME 已配
- [ ] `NEXT_PUBLIC_APP_URL` 已切到新域名
- [ ] Supabase 三件套（URL / SERVICE_ROLE_KEY / DATABASE_URL）一致
- [ ] AI 可选：ANTHROPIC_API_KEY 已配

## 后续完善建议

- 全部 env 改用 Vercel **Production / Preview / Development** 三层隔离，避免共享
- 敏感 key（_TOKEN / _SECRET / _KEY）启用 Vercel Encryption（默认已加密）
- 建立环境变量轮换日历：bot token 半年轮换、AUTH_SECRET 每年轮换
