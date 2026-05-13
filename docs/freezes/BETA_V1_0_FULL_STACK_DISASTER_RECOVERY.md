# 店小二 Beta v1.0 全栈灾备快照

> 与 `BETA_V1_0_COMMERCIAL_TRIAL_FREEZE.md` 配套，覆盖**代码以外**的运行时依赖：
> 数据库、Vercel 配置、Telegram Bot。

---

## 1. 元信息

| 项 | 值 |
|----|----|
| 快照时间 | 2026-05-14 |
| 关联 git commit | `6da913a` |
| 关联 git tag | `beta-v1.0-commercial-trial` |
| 灾备维度 | 数据库 / 环境变量 / Bot 配置 / 文件存储 |
| 备份目录 | `backups/beta_v1_0/` |

---

## 2. 已自动备份（仓库内）

| 维度 | 文件 | 说明 |
|------|------|------|
| DB 结构 | `backups/beta_v1_0/schema.sql` | pg_dump --schema-only，1258 行 |
| DB 完整 | `backups/beta_v1_0/full_backup.sql` | pg_dump column-inserts，3533 行 |
| DB 部分 | `backups/beta_v1_0/key_tables_data.sql` | 14 张业务表数据 |
| DB 说明 | `backups/beta_v1_0/backup_notes.md` | 恢复命令 + 表行数快照 |
| Vercel env | `backups/beta_v1_0/vercel_env_backup.md` | key 清单 + 关键度分级，**值脱敏** |
| Bot 配置 | `backups/beta_v1_0/bot_config_inventory.md` | 3 个 bot 角色 + webhook + 依赖关系 |

**已涵盖业务表行数**（截至备份时间）：
- Tenant 18 · Store 19 · User 37 · UserStoreRole 37
- Product 339 · ProductCategory 5
- SaleRecord 163 · PaymentIntent 45 · MerchantPaymentConfig 2
- CustomerOrder 51 · StoreCustomerContact 4
- BindToken 110 · StoreApplication 12
- TelegramMessage 242 · OperationLog 134 · SupportSession 3
- OpsAdmin 1 · _prisma_migrations 5

---

## 3. 需要人工补充的部分

| 维度 | 为何不能自动 | 人工步骤 |
|------|------------|---------|
| **Vercel env 实际值** | 没有 Vercel CLI token，自动 API 拉取需要 OAuth | `cd light-ops-assistant && vercel link && vercel env pull .env.production.backup --environment=production` → 加密存到 1Password / 不入仓库 |
| **Supabase Storage（product-images）** | pg_dump 不导出对象存储 | Supabase Dashboard → Storage → product-images → 选择全部 → Download all（或用 Supabase CLI `supabase storage cp -r`） |
| **BotFather 实际 token / 命令 / Menu Button** | BotFather 无公开 API 导出 | 进 @BotFather → /mybots → 三个 bot 分别截图 token、commands、Menu Button、Description；token 落到 1Password |
| **DNS / 域名** | Vercel 自动管理但记录值需自己存 | 在域名注册商后台导出 A / CNAME 记录截图 |
| **Telegram bot 与 Supabase IP 白名单** | 不存于代码 | Supabase Dashboard → Settings → Database → Network Restrictions 截图 |
| **当前 Vercel 部署 production URL 别名** | Vercel UI 配置 | Vercel Dashboard → Domains 截图 |

---

## 4. 推荐恢复顺序

### 阶段一：底层（DB + Storage）
1. **新建 Supabase project**（或使用现有项目）
2. **恢复 DB**：
   ```bash
   psql "$NEW_DATABASE_URL" -f backups/beta_v1_0/full_backup.sql
   ```
3. **恢复 Storage**：在 Supabase Dashboard 创建 `product-images` bucket（Public），上传备份的对象
4. **跑 Prisma generate**：`npx prisma generate`，校对 `prisma/schema.prisma` 一致

### 阶段二：代码（Git + Vercel 部署）
5. **本地切到冻结点**：
   ```bash
   git fetch origin --tags
   git checkout beta-v1.0-commercial-trial
   ```
6. **关联 / 新建 Vercel 项目**：`vercel link` 或 Vercel Dashboard → Add Project → Import GitHub repo
7. **回填 env**：基于 `vercel_env_backup.md` 的 A/B/C 三类按优先级在 Vercel Dashboard 添加
   - A 类（DATABASE_URL / AUTH_SECRET）必须先配
   - B 类（4 个 webhook secret + 3 个 BOT TOKEN + APP_URL + 2 个 BOT_USERNAME）
   - C 类（SUPABASE_URL / SERVICE_ROLE_KEY / ANTHROPIC_API_KEY）
8. **首次部署**：触发 Vercel production deploy

### 阶段三：Bot 配置（依据 `bot_config_inventory.md`）
9. **三个 bot 重设 webhook**：
   ```bash
   # 商户 bot
   curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     -d "url=${NEW_APP_URL}/api/webhook/merchant" \
     -d "secret_token=${MERCHANT_WEBHOOK_SECRET}"

   # 顾客 bot
   curl "https://api.telegram.org/bot${CUSTOMER_BOT_TOKEN}/setWebhook" \
     -d "url=${NEW_APP_URL}/api/webhook/customer" \
     -d "secret_token=${CUSTOMER_WEBHOOK_SECRET}"
   ```
10. **BotFather Menu Button** 改到新域名（如域名变更）
11. **验证 webhook 健康**：`curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

### 阶段四：联调验证（参照 `BETA_V1_0_COMMERCIAL_TRIAL_FREEZE.md` 能力清单）
12. 商户绑定 → 商品创建 → 销售单 → 顾客扫码 H5 下单 → /home 接单 KHQR → /records 看到合并行
13. 顾客 H5 三语切换 + 历史订单（TG / 非 TG 两路径）
14. 检查 `customers` 页 / `dashboard` 数字一致
15. 触发 1 笔退款验证完整链路

---

## 5. 灾备时效目标（建议）

| 场景 | RTO | RPO | 操作 |
|------|-----|-----|------|
| Vercel 部署回滚（运行时回滚） | 5 分钟 | 0 | Vercel Dashboard → Promote previous deployment |
| 代码回滚到冻结点 | 15 分钟 | 0 | `git reset --hard beta-v1.0-commercial-trial && push --force-with-lease` |
| 数据库恢复到本备份点 | 1 小时 | 自上次 pg_dump（建议每周） | `psql -f full_backup.sql` |
| 整站迁移到新 Supabase + Vercel | 4 小时 | 自上次备份 | 上文阶段一 → 阶段四 |
| Bot 切换 | 30 分钟 | 0 | 上文阶段三 |

---

## 6. 备份维护守则

- ✅ **每周日**：自动 pg_dump（建议接入 GitHub Actions 或 Vercel Cron）→ 推到 S3 / Vercel Blob，按周轮转
- ✅ **每月初**：人工 vercel env pull → 加密存 1Password
- ✅ **重大版本前**：手动一次完整全栈备份 + git tag 关联
- ❌ **禁止** 把 `.env.production.backup`、token 明文、Service Role Key 提交到 git
- ❌ **禁止** force-push 覆盖 `beta-v1.0-commercial-trial` tag
- ⚠️ **本目录的 `full_backup.sql` 包含真实业务数据**；如仓库公开请改为 `.gitignore` + 单独加密存档

---

## 7. 相关文档

- `docs/freezes/BETA_V1_0_COMMERCIAL_TRIAL_FREEZE.md` — 代码层冻结记录（commit / tag / 能力清单 / 4 种回滚方式）
- `docs/SUPABASE_PERMISSIONS_FREEZE_v1.md` — 数据库权限治理规范
- `backups/beta_v1_0/backup_notes.md` — DB 备份操作手册
- `backups/beta_v1_0/vercel_env_backup.md` — 环境变量清单
- `backups/beta_v1_0/bot_config_inventory.md` — Bot 配置清单

---

**灾备维护人**：jasonmino
**首次冻结**：2026-05-14
**下次复测建议**：每季度做一次 demo 全栈恢复演练
