# TikTok / 博主推广短链 v2B 商户侧佣金结算雏形冻结版

**冻结时间：** 2026-05-31  
**冻结状态：** ✅ 已验收，功能锁定  
**基于：** [v2A 成交归因冻结版](./TIKTOK_CAMPAIGN_V2A_ATTRIBUTION_FREEZE.md)（commit `1236986`）

---

## 功能范围

在 v2A 归因闭环基础上，新增商户侧博主档案管理、佣金规则配置、预计佣金计算，以及人工结算状态标记，形成"推广 → 成交 → 佣金 → 结算"的完整轻量闭环。博主无需登录，所有操作均在商户 `/campaign` 页面完成。

---

## 数据库变更

### 新增模型：`Creator`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | cuid 主键 |
| tenantId | String | 租户 ID |
| storeId | String (FK→Store) | 归属门店 |
| name | String | 博主名称（必填） |
| displayName | String? | 展示名（选填） |
| phone | String? | 联系电话 |
| telegramId | String? | Telegram ID（备用） |
| tiktokHandle | String? | TikTok 账号 |
| note | String? | 备注 |
| status | String | `active` / `inactive`，默认 `active` |
| createdAt / updatedAt | DateTime | — |

### 扩展模型：`CampaignLink`

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| creatorId | String? (FK→Creator) | 关联正式博主，可空 |
| commissionType | String? | `percent` / `fixed` |
| commissionValue | Decimal(10,2)? | 佣金数值 |
| settlementStatus | String | `unsettled` / `settled`，默认 `unsettled` |
| settledAt | DateTime? | 结算时间 |
| settledNote | String? | 结算备注 |

保留兼容字段：`creatorName`（旧数据与临时手填博主）

Migration：`20260531000001_creator_commission`  
生产迁移：**需在 Supabase SQL Editor 手动执行**

---

## 新增 / 修改路由

| 路由 | 类型 | 说明 |
|------|------|------|
| `GET /api/creators` | 新增 | 当前门店博主列表（OWNER） |
| `POST /api/creators` | 新增 | 新增博主（OWNER） |
| `POST /api/campaign-links/[id]/settle` | 新增 | 标记短链已结算（OWNER） |
| `GET /api/campaign-links` | 修改 | 新增 creator 信息、佣金字段、结算状态、`estimatedCommission` |
| `POST /api/campaign-links` | 修改 | 支持 creatorId / commissionType / commissionValue |

---

## `/campaign` 页面四区块

| 区块 | 内容 |
|------|------|
| 博主管理 | 新增博主表单（可展开）+ 已有博主列表（名称 / TikTok账号 / 电话 / 备注） |
| 生成短链 | 下拉选已有博主（或手填临时名）+ 视频备注 + 佣金类型 + 佣金数值 + 生成按钮 + 结果展示 |
| 博主汇总 | 按博主聚合：链接数 / 浏览 / 点击 / 订单 / 成交额 / 预计佣金 / 已结算 / 待结算（橙色高亮） |
| 历史短链 | 每条短链：code / 博主 / 视频备注 / 统计数据 / 佣金规则 / 预计佣金 / 结算状态 badge / 结算操作 |

---

## 佣金计算规则

| 类型 | 计算方式 | 示例 |
|------|----------|------|
| `percent` | 成交金额 × commissionValue ÷ 100 | 5% × $31.00 = $1.55 |
| `fixed` | 成交单数 × commissionValue | 3单 × $1.00 = $3.00 |

- 计算在 API 层（`GET /api/campaign-links`）完成，返回 `estimatedCommission` 字段
- 暂不处理退款扣减
- 无佣金规则时显示"无佣金"

---

## 博主汇总去重规则

- **正式博主**（有 `creatorId`）：按 `creatorId` 聚合，标蓝色「正式博主」badge
- **临时博主**（无 `creatorId`，仅 `creatorName`）：按 `creatorName` 独立聚合，标灰色「临时」badge
- 两组严格分离，同名不同来源不合并，避免数据混淆

---

## 人工结算规则

1. 商户在历史短链列表点击「标记已结算」
2. 弹出内联输入框，可填写结算备注（选填）
3. 确认后 `POST /api/campaign-links/[id]/settle` 写入：
   - `settlementStatus = settled`
   - `settledAt = now()`
   - `settledNote`（可空）
4. 已结算短链显示绿色 badge + 结算日期，不可重复结算（API 返回 409）
5. 博主汇总自动反映结算状态（已结算 / 待结算分开展示）

---

## 关键 Commit

| Hash | 内容 |
|------|------|
| `4f5a286` | feat: Phase 2B 博主档案 + 佣金规则 + 人工结算雏形 |
| `7070541` | fix: 博主汇总去重 + 结算金额展示优化（当前冻结版本） |

---

## 已验证结果

- 新增正式博主后，生成短链时可从下拉选择
- 生成带佣金规则的短链（5%/单 或 $1/单），历史列表正确显示佣金规则和预计佣金
- 博主汇总区块按正式/临时分组，同名不同来源的博主各自独立展示，标签区分
- 结算金额展示为"已结算：$X.XX / 待结算：$Y.YY"两行，待结算橙色高亮
- 标记已结算后 badge 变绿，汇总中已结算金额更新，不可重复结算
- 旧短链（无佣金规则）正常显示"无佣金"，不影响 v2A 归因链路

---

## 当前明确不包含的功能

- 博主独立登录（无账号体系）
- 博主机器人（无 Telegram bot 推送）
- 博主自助看板
- 自动提现 / 自动打款
- TikTok 官方 API 对接
- 自动私信 / 自动回复
- 多级分销
- 复杂财务结算单（PDF / 签名 / 对账）
- 博主编辑 / 停用操作（当前只有新增）
- 批量结算

---

## 下一阶段建议

**Phase 2C：博主自助查看链接与佣金数据（token 链接方案）**

不做博主机器人，通过一次性/长效 token URL 让博主访问只读看板：

1. `CreatorToken` 模型：`token(unique) / creatorId / expiresAt / lastAccessAt`
2. `POST /api/creators/[id]/token`（OWNER）：生成 token，商户复制链接发给博主
3. 公开只读页面 `/creator/[token]`：博主看自己的短链列表、订单数、成交额、预计佣金、结算状态
4. 无需登录，token 即身份，可设置有效期（如 30 天）
5. 商户可在 `/campaign` 博主管理区生成并复制 token 链接

前提条件：确认博主是否需要看历史数据，还是只看最近 30 天。
