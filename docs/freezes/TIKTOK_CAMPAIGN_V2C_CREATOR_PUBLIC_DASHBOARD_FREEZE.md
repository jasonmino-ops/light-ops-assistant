# TikTok / 博主推广短链 v2C 博主只读看板冻结版

**冻结时间：** 2026-05-31  
**状态：** 已验收 ✅

---

## 基于 v2B 冻结版继续增强

本阶段在 v2B（博主档案 + 佣金规则 + 人工结算）基础上增加了博主只读数据看板，无需博主登录即可通过专属 token URL 查看自己的推广数据，并新增三语界面支持。

---

## 当前功能范围

### 博主只读数据看板（/creator/p/[token]）

- 商户为每位博主生成专属看板链接（48 字符 hex token），分享给博主
- 博主无需登录，直接通过链接访问只读看板
- 展示内容：
  - 博主昵称 / TikTok handle
  - 流量概览（总浏览 / 总点击 / 总订单 / 总成交额）
  - 佣金概览（预计佣金总额 / 已结算 / 待结算）
  - 推广链接明细（每条链接的流量 + 成交 + 佣金规则 + 结算状态）
- token 长期有效，商户可在商户端重置（旧 token 立即失效）

### 三语切换（zh / en / km）

- 看板页面支持中文 / English / ខ្មែរ 三语切换
- 语言检测优先级：URL `?lang=` → localStorage `creatorDashboardLang` → Creator.preferredLang → navigator.language → 中文
- 商户可在创建博主时设置博主默认语言，影响博主首次访问看板时的默认语言

### 商户端 token 管理（/campaign）

- 博主档案卡片显示"生成看板链接"按钮（首次生成）
- 已有 token 后显示"复制看板链接"和"重置链接"两个操作
- 博主列表显示 `🌐 中文 / English / ខ្មែរ` 语言偏好 badge
- 创建博主表单新增"默认语言"下拉（未设置 / 中文 / English / ខ្មែរ）

---

## 数据库变更

### Creator 表新增字段（v2C 本阶段）

```sql
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "preferredLang"            TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "dashboardToken"            TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "dashboardTokenCreatedAt"   TIMESTAMP;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "dashboardTokenRevokedAt"   TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "Creator_dashboardToken_key" ON "Creator"("dashboardToken");
```

### 迁移文件

| 迁移名 | 内容 |
|--------|------|
| `20260531000002_creator_dashboard_token` | dashboardToken / dashboardTokenCreatedAt / dashboardTokenRevokedAt + 唯一索引 |
| `20260531000003_creator_preferred_lang`  | preferredLang |

---

## 新增 / 修改路由

### 新增路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `GET /api/creator-public/[token]` | 公开，无需登录 | 按 token 返回博主推广聚合数据，不含顾客隐私字段 |
| `POST /api/creators/[id]/dashboard-token` | OWNER | 生成或重置博主看板 token |
| `GET /creator/p/[token]` | 公开页面 | 博主只读看板页面（三语 i18n） |

### 修改路由

| 路由 | 变更 |
|------|------|
| `GET /api/creators` | select 新增 preferredLang / dashboardToken / dashboardTokenCreatedAt |
| `POST /api/creators` | body 接受 preferredLang，写入数据库 |
| `GET /api/creator-public/[token]` | creator 对象返回 preferredLang，供前端语言检测使用 |

### TelegramInit 白名单

`/creator/p` 已加入 `ONBOARDING_PATHS`，Telegram WebApp 不拦截此路径，博主可在任何 Telegram 打开环境中直接访问。

---

## 博主看板 Token 机制

- 生成：`crypto.randomBytes(24).toString('hex')` → 48 字符 hex 字符串
- 唯一性：数据库 UNIQUE 索引，生成时碰撞概率极低
- 有效期：无固定过期时间，长期有效
- 失效方式：商户点击"重置链接"后，`dashboardTokenRevokedAt` 写入当前时间，旧 token 立即返回 404；同时生成新 token
- 访问控制：`/api/creator-public/[token]` 检查 `dashboardTokenRevokedAt`，不为空则返回 404

---

## 语言切换机制

```
检测优先级（高 → 低）：
1. URL 参数 ?lang=zh|en|km
2. localStorage key: creatorDashboardLang
3. Creator.preferredLang（由商户设置）
4. navigator.language（浏览器语言）
5. 默认：zh（中文）
```

- 页面右上角三个语言切换按钮（中 / EN / ខ្មែរ）
- 切换后写入 localStorage，下次访问保持选择
- 错误页面（token 无效）同样显示语言切换按钮

---

## 隐私保护说明

- `/api/creator-public/[token]` 为纯聚合端点，只返回：
  - 博主姓名 / 昵称 / TikTok handle（博主自身信息）
  - 推广链接维度的聚合数字（浏览数、点击数、订单数、成交金额）
  - 佣金规则与结算状态
- **不返回** 任何顾客信息（姓名、电话、Telegram ID、优惠券等）
- **不返回** 其他博主数据
- **不返回** 店铺内部经营数据（总销售额、利润等）

---

## 已验证结果

- `npm run build` 通过，无 TypeScript 错误
- `/creator/p/[token]` 页面三语切换功能正常
- token 生成 / 复制 / 重置流程在 /campaign 页面验证通过
- 无效 / 已撤销 token 正确返回 404 并显示错误页面
- 已提交并推送至 main 分支（commit `82f7f4a`）
- 生产 DB 迁移已提供 SQL，待在 Supabase SQL Editor 手动执行

---

## 当前明确不包含

- 博主登录系统（无账号体系，纯 token 访问）
- 博主机器人（Telegram Bot 推送、自动通知）
- 自动提现 / 自动打款
- TikTok API 对接（播放量、粉丝数等平台数据同步）
- 多级分销 / 分佣链路
- 复杂财务系统（发票、税务、对账单）
- 博主自助修改个人信息

---

## 下一阶段建议

**Phase 2D：商户侧推广结算运营优化**

- 结算记录筛选（按博主 / 按日期范围 / 按状态）
- 批量结算操作（多条链接一次性标记已结算）
- 结算历史导出（CSV / Excel）
- 结算记录增强（支持结算备注、结算金额手动覆盖）
- 佣金汇总报表（按月 / 按博主的统计视图）
