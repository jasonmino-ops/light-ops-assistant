# TikTok / 博主推广短链 v2D+v2E 试跑就绪冻结版

**冻结时间：** 2026-05-31  
**状态：** 已验收 ✅  
**关联 commit：** v2D `48950af` · v2E `be00e0d`

---

## 一、当前阶段定位

本阶段不是继续扩展后台功能，而是让商户和博主能真实完成 TikTok 第一轮试跑。

**当前主链路：**

```
TikTok 视频内容
  → 主页 Bio 链接（主入口）
  → 置顶评论引导 + 私信回复（辅助）
  → 视频结尾二维码（兜底）
    → /v/[code] TikTok 场景落地页
      → E-Life / 店小二 H5 下单
        → /campaign 归因统计（浏览 / 点击 / 订单 / 佣金）
```

系统侧已具备完整闭环，本阶段冻结功能，进入真实试跑验证。

---

## 二、已完成能力（v2A–v2E 全览）

| 版本 | 能力 |
|------|------|
| v2A | CustomerOrder 订单归因（campaignCode / campaignLinkId / sourcePlatform / campaignIntent） |
| v2B | Creator 博主档案 + 佣金规则 + 人工结算 |
| v2C | 博主只读数据看板（token URL，三语切换，preferredLang） |
| v2D | /campaign 历史短链「📱 素材」入口；推广素材抽屉（短链 + 二维码 + 三语推广文案）；/v/[code] TikTok 场景落地页轻优化 |
| v2E | docs/ops/TIKTOK_CAMPAIGN_TRIAL_SOP_V2E.md 运营 SOP（10 节，含脚本 / 评论 / 私信模板 / 数据复盘） |

### v2D 推广素材抽屉具体内容

每条历史短链点击「📱 素材」后展示：

- 推广短链 + 一键复制
- 二维码图片（可截图分享给博主）
- TikTok 主页 Bio 文案（zh / en / km）
- 视频置顶评论文案（zh / en / km）
- 私信人工回复模板（zh / en / km）
- 博主拍摄脚本模板（zh / en / km）

### v2D /v/[code] 落地页优化内容

- 新增「🎵 来自 TikTok 推荐」黑底 badge（首屏常驻）
- 博主推荐行改为灰底高亮卡片，视觉更突出
- 主按钮下方增加「✨ TikTok 粉丝专属通道」提示文字
- 三语均已更新

---

## 三、明确不包含内容

| 项目 | 说明 |
|------|------|
| TikTok API 对接 | 播放量 / 粉丝数 / 评论数需人工查看 TikTok 后台，不自动同步 |
| 自动私信 | 评论「菜单」「链接」等关键词后，由人工按模板回复 |
| 博主机器人 | 无 Telegram Bot 推送 / 自动通知 |
| 复杂分销 | 仅支持一级博主佣金，无多级代理 |
| 复杂结算流程 | 结算由商户人工在 /campaign 标记，无自动对账 / 自动打款 |
| 评论链接可点击性 | TikTok 评论链接点击行为因账号资质和版本而异，不承诺可点击 |
| 置顶评论作为主入口 | 主入口始终是 Bio 链接，置顶评论只做文字引导 |

---

## 四、推荐真实试跑方式

```
商户数：   1 家（控制变量，先跑通流程）
博主数：   1-3 人（可包含商户自有 TikTok 账号）
短链分配： 每个博主/账号使用独立短链（单独追踪）
视频数：   每人 1-3 条（挂同一条短链）
主入口：   TikTok 主页 Bio 链接
辅助引导： 置顶评论文字引导 + 私信人工回复
兜底方式： 视频结尾二维码
观察周期： 连续 3 天（TikTok 推荐算法活跃期）
```

完整操作步骤见 `docs/ops/TIKTOK_CAMPAIGN_TRIAL_SOP_V2E.md`。

---

## 五、验证指标

### 系统侧（/campaign 直接读取）

| 指标 | 位置 |
|------|------|
| 浏览数 | 历史短链 · 每条 viewCount |
| 点击数 | 历史短链 · 每条 clickCount |
| 订单数 | 历史短链 · attributedOrderCount |
| 成交金额 | 历史短链 · attributedSalesAmount |
| 预计佣金 | 历史短链 · estimatedCommission |
| 已结算 / 待结算 | 博主汇总 · settled / unsettled |

### 人工侧（TikTok 后台 + 现场确认）

| 指标 | 确认方式 |
|------|---------|
| Bio 链接是否成功挂载 | 手机打开博主 TikTok 主页，点击链接验证跳转 |
| 二维码是否正常扫码 | 用相机 App 扫描视频截图中的二维码，确认跳转 /v/[code] |
| 评论互动情况 | TikTok 创作者后台或直接看评论区 |
| 落地页在真实 TikTok 内置浏览器中的表现 | 在手机上点击 Bio 链接确认页面正常渲染 |

---

## 六、下一阶段触发条件

| 触发现象 | 建议方向 |
|---------|---------|
| 试跑整体跑通，有真实订单 | 进入 v2F：结算批量操作 / 数据筛选 / 导出 |
| 卡在 TikTok 挂链（Bio 链接限制） | 优先优化二维码清晰度 + 私信回复链路，不依赖 Bio |
| 点击量有但订单转化低 | 优先优化 /v/[code] 落地页公告文案 + 菜单商品图定价 |
| 博主结算流程卡顿 | 优先做筛选 / 批量结算标记 / 导出，而非堆新模型 |
| 商户有意投放 TikTok 广告 | 单独评估 TikTok Messaging Ads 私信获客模板，不在当前版本范围内 |

---

## 七、关联文档

| 文档 | 路径 |
|------|------|
| v2A 冻结 | docs/freezes/TIKTOK_CAMPAIGN_V2A_ATTRIBUTION_FREEZE.md |
| v2B 冻结 | docs/freezes/TIKTOK_CAMPAIGN_V2B_CREATOR_COMMISSION_FREEZE.md |
| v2C 冻结 | docs/freezes/TIKTOK_CAMPAIGN_V2C_CREATOR_PUBLIC_DASHBOARD_FREEZE.md |
| 试跑运营 SOP | docs/ops/TIKTOK_CAMPAIGN_TRIAL_SOP_V2E.md |
