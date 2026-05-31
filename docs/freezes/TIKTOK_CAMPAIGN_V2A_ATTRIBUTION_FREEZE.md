# TikTok / 博主推广短链 v2A 成交归因冻结版

**冻结时间：** 2026-05-31  
**冻结状态：** ✅ 已验收，功能锁定

---

## 功能范围

商户可在 `/campaign` 页面为 TikTok 博主/达人生成专属推广短链，访客通过短链进入三语落地页后下单，订单自动记录推广来源，商户在历史列表看到每条短链的浏览、点击、成交数据。

---

## 已验证链路

```
博主发布视频
  → 视频描述/置顶评论放 /v/<code> 短链
  → 访客打开落地页（三语：zh/en/km）
  → 点击「立即下单」→ /m/<storeCode>?ref=<code>&intent=order
  → 服务端 302 → /menu?code=<storeCode>&ref=<code>&intent=order
  → 顾客 H5 下单
  → POST /api/public/orders（带 campaignCode + campaignIntent）
  → 服务端查 CampaignLink → 写入 CustomerOrder 归因字段
  → 商户在 /campaign 历史列表看到「📦 X 单成交 💰 $Y」
```

---

## 数据库变更

### 新增模型：`CampaignLink`（v1，已上线）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | cuid 主键 |
| code | String (unique) | 6 位随机大写码 |
| storeId | String | FK → Store |
| sourcePlatform | String | 默认 `tiktok` |
| creatorName | String? | 博主名称（选填） |
| videoTitle | String? | 视频备注（选填） |
| targetUrl | String | 目标 URL（/menu?code=...） |
| viewCount | Int | 落地页浏览次数 |
| clickCount | Int | 点击「下单/菜单」次数 |
| createdAt | DateTime | — |

Migration：`20260529000000_campaign_link`

### `CustomerOrder` 新增归因字段（v2A）

| 字段 | 类型 | 说明 |
|------|------|------|
| sourcePlatform | String? | 来源平台，如 `tiktok` |
| campaignCode | String? | 短链 6 位码 |
| campaignLinkId | String? | CampaignLink.id |
| campaignIntent | String? | `order` 或 `menu` |

Migration：`20260531000000_customer_order_campaign`  
生产迁移：**已在 Supabase SQL Editor 手动执行，已确认**

---

## 新增 / 修改路由

| 路由 | 类型 | 说明 |
|------|------|------|
| `GET /api/v/[code]` | 新增 | 公开；返回落地页数据，fire-and-forget viewCount+1 |
| `POST /api/v/[code]/click` | 新增 | 公开；clickCount+1 |
| `GET /api/campaign-links` | 新增 | OWNER；列表 + 归因聚合统计 |
| `POST /api/campaign-links` | 新增 | OWNER；生成短链 |
| `POST /api/public/orders` | 修改 | 新增 campaignCode/campaignIntent 字段处理 |
| `GET /m/[storeCode]` | 修改 | 服务端重定向现在透传 ref + intent |
| `app/v/[code]/page.tsx` | 新增 | 公开三语落地页（zh/en/km） |
| `app/campaign/page.tsx` | 新增 | 商户推广短链管理页（OWNER only） |
| `app/menu/page.tsx` | 修改 | 读取 ?ref=/?intent=，提交订单时附带传递 |

---

## 关键 Commit

| Hash | 内容 |
|------|------|
| `b17d9b9` | feat: TikTok 推广短链 + 落地页最小闭环（v1 基础） |
| `aca6425` | fix: /campaign 访问修正，middleware 跳 /relogin |
| `4f9a5f2` | refactor: 推广带货入口移至 /dashboard |
| `d8ab8ba` | fix: /v/[code] 公开落地页修复 |
| `0a68141` | feat: 落地页三语切换 + intent 分流 |
| `1d77305` | feat: Phase 2A 成交归因闭环（当前冻结版本） |

---

## 手动验收结果

**测试短链：** `/v/8PNP75`  
**验收时间：** 2026-05-31

| 指标 | 结果 |
|------|------|
| 浏览次数 | 11 次 |
| 点击次数 | 4 次 |
| 成交单数 | 1 单 |
| 成交金额 | $31.00 |

**Supabase 数据确认：**  
最新 `CustomerOrder` 记录 `campaignCode=8PNP75`、`sourcePlatform=tiktok`、`totalAmount=31.00`，归因写入正确。

---

## 当前明确不包含的功能

- Creator 博主档案（独立账号体系）
- 佣金比例设置
- 佣金计算
- 结算单生成
- 博主专属后台
- 博主 Telegram 机器人
- TikTok 官方 API 对接
- 自动私信 / 自动回复
- 自动打款 / 第三方支付结算

---

## 下一阶段建议

**Phase 2B：Creator 博主档案 + 佣金规则 + 商户结算看板雏形**

建议内容：
1. `Creator` 模型：绑定 Telegram、管理佣金比例、关联多条 CampaignLink
2. `CommissionRule`：按 Creator 或短链设定佣金比例（百分比 / 固定金额）
3. 订单成交后自动计算 `commissionAmount`，写入 `CustomerOrder`
4. 商户在 `/campaign` 或新页面 `/commission` 查看每位博主的结算汇总
5. 结算单 PDF 导出或 Telegram 推送（可选）

前提条件：需先确认是否引入 Creator 独立登录，或仅做商户侧管理视角。
