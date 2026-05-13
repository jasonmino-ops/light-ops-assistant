# 店小二 Beta v1.0 商业试跑冻结版

> ⚠️ **本文件为稳定版冻结记录**。当后续 main 分支出现回归、不可控故障时，
> 可凭此基线 + git tag 立即回滚。**不要直接在本冻结点的 commit 上 force-push**。

---

## 1. 冻结元信息

| 项 | 值 |
|----|----|
| 冻结时间 | 2026-05-14 |
| 冻结 commit | `6da913a` |
| 完整 SHA | `6da913a2913e7d83b2fa715031f4339550c6db2c` |
| Git tag | `beta-v1.0-commercial-trial` |
| Tag 类型 | annotated（含 message） |
| Tag message | 店小二 Beta v1.0 商业试跑冻结版 |
| 适用分支 | `main` |
| 远程 | `github.com:jasonmino-ops/light-ops-assistant.git` |
| Tag 已推送 | ✅ origin |

冻结点最后一条 commit：

```
6da913a  fix: /home 顾客订单 KHQR 收款先弹二维码再确认
```

---

## 2. 当前核心能力清单

### 2.1 商户端

- **开店申请 / 老板绑定 / 员工绑定**
  - 申请审核（OpsAdmin 后台）→ 生成 BindToken
  - Telegram `/start <token>` 完成 OWNER / STAFF 绑定
  - 老板可在 `/invite` 重生成员工码、解绑、生成顾客点单二维码（短链 `/m/[storeCode]`）

- **商品管理 `/products`**
  - 扫码（HID 蓝牙 / 摄像头）/ 手动输入 / 手动新增三入口分明
  - 商品列表点击展开 → 上传/替换/删除主图 + 编辑 + 删除商品
  - Excel 批量导入（template 下载 + 预览 + 确认）
  - AI 菜单识别导入 v1（Anthropic Claude Haiku 4.5 视觉模型）
  - 商品分类管理（两级）

- **销售 `/sale`**
  - 即时收款 + 挂单（DIRECT_PAYMENT / DEFERRED_PAYMENT 两种模式）
  - 现金 / KHQR 二维码弹层（含 PaymentIntent、商户确认/取消）

- **记录 `/records`**
  - SaleRecord + CustomerOrder（已确认+已付）合并展示
  - 列表中 H5 订单加橙色「H5 顾客」徽标
  - summary 数字与 dashboard 完全对齐

- **退款 `/refund`**
  - 按单号 / 商品名 / 操作员搜索原销售单
  - 部分退款 / 全额退款 / 退款原因
  - 退款数据进入 records summary 与 dashboard 净额

- **概览 `/dashboard`**
  - 三维度切换：全部门店 / 单门店 / 单员工（已合并为单入口抽屉）
  - 四时段：今日 / 本周 / 本月 / 自定义
  - 6 格收入明细 + 本周/本月热销 tab 切换
  - 顶部「首页门头管理」快捷卡 + 大入口卡（顾客资产 / 门店配置）
  - 门店配置：banner 上传/替换/删除、公告/活动文案三态编辑（修改/保存/取消）

- **顾客资产 `/customers`**
  - 总览 6 指标（总顾客 / 已绑定 / 今日新增 / 本月活跃 / 总消费 / 复购人数）
  - 搜索 + 3 排序 + 5 标签筛选
  - 顾客详情 drawer：基础资料 + 消费汇总 + 标签 + 常购 Top3 + 订单历史

### 2.2 顾客端 H5

- **扫码点单 `/m/[storeCode]` → `/menu`**
  - 横向门店头图（可上传）+ 公告 + 活动横幅
  - sticky 顶部搜索框 + 三语切换
  - 左侧竖向分类栏 + 右侧商品列表
  - 商品卡：图片、名称、规格、价格、+/-、推荐徽标、点图放大
  - 深色悬浮购物车栏（可展开已选清单）
  - Checkout 弹层：门店、商品清单、取餐方式（堂食/外卖送货上门）、备注、优惠券位、合计、提交
  - 下单成功弹层：✓ + 门店名 + 订单号 + 状态 + 金额 + (未绑定时) 蓝色绑 Telegram 按钮 + 继续选购 + 查看订单进度
  - 顶部位置感知 📍 + 横向分类栏 + 推荐徽标 + 优惠占位
  - 三语顾客端：中文 / English / ខ្មែរ（含错误提示、状态徽标、商品摘要后缀全三语）

- **历史订单 `/menu/orders`**
  - Telegram 用户按 `customerTelegramId` 查（跨设备同步）
  - 非 Telegram 浏览器按 localStorage 缓存的 orderNos 查（本设备）
  - 不再强制 Telegram 打开

- **我的 `/me`**
  - 独立页：身份卡 + 4 格资产 + Telegram 绑定状态卡 + 列表入口
  - 优惠券中心子页（3 状态 tab，空态）

- **底部 3 tab 导航**：点单 / 历史订单 / 我的

- **Telegram 主动绑定**
  - 下单成功页「📲 绑定 Telegram」按钮跳 `t.me/<bot>?start=bind_<storeCode>_<orderNo>`
  - 顾客 bot webhook 解析 bind payload → 写入 `StoreCustomerContact` 表
  - 跨门店各自独立绑定

### 2.3 收款链

- **KHQR 弹码收款（统一弹层 + 商户确认）**
  - `/sale` 销售页：即时 / 挂单 → /api/orders/[orderNo]/checkout → PaymentIntent → KhqrSheet
  - `/records` 挂单结账：同上
  - `/home` 顾客订单：本轮收口 → /api/customer-orders/[id]/khqr → KhqrSheet confirmOnly 模式 → PATCH 标 paid
  - 现金路径全部为直接登记
  - 取消 / 已收款 / 超时三种结束态

### 2.4 系统能力

- 三语 i18n（zh + km；en 局部覆盖）
- 二维码（react-qr-code 渲染 + 商户上传静态图）
- 图片：Supabase Storage（product-images bucket）+ DB base64（store banner）
- AI：Anthropic Messages API（菜单识别）
- Telegram：商户 bot + 顾客 bot 双 webhook
- 数据库：Prisma 7 + PostgreSQL（Supabase）+ PgBouncer pooler
- 部署：Vercel
- 权限治理：《Supabase 权限兼容冻结 v1》文档与模板已就绪（commit `0a13161`）

---

## 3. 不包含内容（v1.0 范围外）

- ❌ 银行回调自动确认（KHQR 仍由商户在 UI 手动确认）
- ❌ 完整 ERP（库存、采购、调拨、盘点）
- ❌ 复杂 BI（多维度图表、留存漏斗、A/B、归因）
- ❌ 配送系统（"外卖送货上门"仅文案 + remark，不接配送地址 / 骑手 / 配送费）
- ❌ 真实支付聚合（无微信支付 / 支付宝 / Stripe 等第三方支付）
- ❌ 复杂会员体系（会员等级 / 积分使用 / 折扣规则）
- ❌ 优惠券实际使用与扣减（仅 UI 占位）
- ❌ 自动群发 / 营销自动化 / AI 推荐
- ❌ 全局 RLS 启用（仅模板就绪；当前应用仍走 postgres 超级用户 BYPASS）
- ❌ 多语言 en 全覆盖（LangProvider 当前只支持 zh + km；en 仅 /menu 顾客端 + 部分公开页）

---

## 4. 关键 commit 参考

| commit | 主题 |
|--------|------|
| `6da913a` | **冻结点** — /home 顾客订单 KHQR 收款先弹二维码再确认 |
| `da84376` | /menu/orders 多商品后缀三语，消除最后中文写死 |
| `7855375` | 顾客 H5 下单 API 响应文案按 lang 三语 |
| `22cb59d` | /menu/orders 解除强制 Telegram，本设备 localStorage 兜底 |
| `e63893e` | /records 合并 H5 顾客订单（口径与 /api/summary 对齐） |
| `654c100` | /dashboard 公告/文案三态编辑 + 首页门头快捷管理 |
| `1a36f98` | banner 路由权限链对齐 getContext |
| `cd13ac1` | /dashboard 首屏布局收口 |
| `0a13161` | Supabase 权限兼容冻结 v1（治理文档） |
| `89d7064` | 商户端「顾客资产」最小 CRM |
| `4587fe7` | /menu 轻量外卖 H5 升级 + /me 独立页 |
| `0f18e00` | AI 菜单识别导入 v1 |
| `fcb11f6` | 商品主图 v1（Supabase Storage） |

---

## 5. 回滚方式

### 5.1 本地工作树回滚到冻结点

```bash
git fetch origin --tags
git checkout beta-v1.0-commercial-trial   # 切到 detached HEAD（仅查看 / 验证）
# 验证后如确认采用为新分支基线：
git switch -c rollback-from-beta-v1
```

### 5.2 把 main 回滚到冻结点（谨慎，会影响远程历史）

> **强制操作，仅当 main 出现严重不可恢复故障时使用，且需事先备份现 main**。

```bash
# 1. 先保护现 main
git branch backup/main-before-rollback main
git push origin backup/main-before-rollback

# 2. 把 main 重置到冻结点
git checkout main
git reset --hard beta-v1.0-commercial-trial

# 3. 强推 main（需 GitHub 上手动允许 force push）
git push origin main --force-with-lease
```

### 5.3 从 GitHub Tag 直接恢复（最稳）

GitHub 上访问：
`https://github.com/jasonmino-ops/light-ops-assistant/releases/tag/beta-v1.0-commercial-trial`

或：
`https://github.com/jasonmino-ops/light-ops-assistant/tree/beta-v1.0-commercial-trial`

可下载 zip / tarball 或基于该 tag 创建新 release。

### 5.4 Vercel 部署回滚

Vercel Dashboard → 项目 → **Deployments** → 找到对应 commit `6da913a` 的部署 → **⋯ → Promote to Production**。
（不需要重新 build，5 秒内生效；最稳的"运行时回滚"路径）

---

## 6. 维护守则

- ❌ **禁止** force-push 覆盖 `beta-v1.0-commercial-trial` tag
- ❌ **禁止** 在该 tag 指向的 commit `6da913a` 上做任何 amend / rebase
- ✅ 新功能继续在 main 推进；如需基于本冻结点做 hotfix，请新建 `hotfix/<topic>` 分支
- ✅ 后续若发布新冻结版（如 `beta-v1.1-...`），在 `docs/freezes/` 下新增独立文档；本文件保留不动

---

**冻结发起人**：jasonmino  
**冻结时间**：2026-05-14  
**Tag**：`beta-v1.0-commercial-trial`
