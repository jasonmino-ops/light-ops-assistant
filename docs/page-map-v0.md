# v0 页面映射冻结文档

> 版本：v0（内测冻结）  
> 日期：2026-04-03  
> 说明：本文档记录 v0 所有正式页面的权限、入口和跳转关系，作为后续迭代基线。不得在未更新本文档的情况下修改页面路由或权限逻辑。

---

## 一、角色定义

| 角色 | 说明 | 来源 |
|------|------|------|
| `OWNER` | 老板，全权限 | User.role = OWNER |
| `STAFF` | 员工，有限操作权限 | User.role = STAFF |
| `未绑定` | Telegram 账号未关联 DB 用户，无任何数据权限 | telegramId 在 DB 中无匹配 |
| `开发模拟` | 本地无 Telegram 上下文，由 `DEV_ROLE` env 模拟 | 仅 NODE_ENV=development |

---

## 二、页面权限总表

| 路径 | 页面名称 | OWNER | STAFF | 未绑定 | middleware 保护 | 底部导航入口 |
|------|----------|:-----:|:-----:|:------:|:---------------:|:------------|
| `/` | 根页面（重定向） | → /dashboard | → /home | → /home | ✗ | — |
| `/home` | 员工首页 | ✓（可访问，无导航入口） | ✓ | ✗（数据 API 401） | ✗ | STAFF: 🏠 首页 |
| `/sale` | 销售 | ✓ | ✓ | ✗ | ✗ | STAFF: 💰 销售 · OWNER: 💰 销售 |
| `/refund` | 退款 | ✓（无导航入口） | ✓ | ✗ | ✗ | STAFF: ↩️ 退款 |
| `/records` | 记录 | ✓ | ✓ | ✗ | ✗ | STAFF: 📋 记录 · OWNER: 📋 记录 |
| `/dashboard` | 老板经营概览 | ✓ | ✗ → /home | ✗ → /home | ✓ | OWNER: 📊 概览 |
| `/products` | 商品管理 | ✓ | ✗ → /home | ✗ → /home | ✓ | OWNER: 📦 商品 |
| `/invite` | 邀请 & 成员管理 | ✓ | ✗ → /home | ✗ → /home | ✓ | OWNER: 🔗 邀请 |
| `/system` | 系统自检 | ✓ | ✗ → /home | ✗ → /home | ✓ | —（/dashboard 页头「系统」链接） |
| `/bind` | 首次绑定 | ✓（可重入，会 ALREADY_BOUND） | 同左 | ✓（主要入口） | ✗ | — |

> **说明**
> - middleware 重定向目标：非 OWNER 访问受保护路由 → `302 /home`
> - "无导航入口"：页面可正常访问，但底部导航不显示快捷入口
> - `/refund` 对 OWNER 可访问但无导航入口（v0 不做 owner 退款入口，保持现状）

---

## 三、导航结构

### STAFF 底部导航（4 tab）

```
🏠 /home → 💰 /sale → ↩️ /refund → 📋 /records
```

### OWNER 底部导航（5 tab）

```
💰 /sale → 📋 /records → 📦 /products → 🔗 /invite → 📊 /dashboard
```

### 页头快捷入口

| 页面 | 快捷链接 | 目标 |
|------|----------|------|
| `/dashboard` | 「切换账号」按钮 | 退出 + reload → `/bind` 流程 |
| `/dashboard` | 「系统」链接 | `/system` |
| `/home` | 「切换账号」按钮 | 退出 + reload → `/bind` 流程 |

---

## 四、首次绑定 & 认证流程

```
Telegram 用户点击 https://t.me/<bot>?startapp=bind_<token>
    │
    ▼
Mini App 开启（根 URL）
    │
    ├─ TelegramInit 检测 start_param = bind_<token>
    │       └─ window.location.replace('/bind?token=<token>')
    │
    ▼
/bind 页面
    ├─ POST /api/bind { token, initData }
    │       ├─ token 验证（有效 / 未过期 / 未用完）
    │       ├─ HMAC 验证 initData
    │       ├─ telegramId 重复检查
    │       ├─ 创建 User + UserStoreRole
    │       └─ 写 auth-session cookie
    │
    ├─ 成功 → OWNER: /dashboard，STAFF: /home
    └─ 失败 → 显示错误（TOKEN_EXPIRED / ALREADY_BOUND / INVALID_SIGNATURE 等）


已绑定用户打开 Mini App（无 startapp）
    │
    ├─ TelegramInit → POST /api/auth/telegram { initData }
    │       ├─ 成功 → reload（server layout 读 cookie → 重定向）
    │       │           OWNER → /dashboard，STAFF → /home
    │       └─ USER_NOT_FOUND → 弹出"绑定用户名"表单（旧备用路径，正式流走 /bind）
    │
    └─ root page (/) → redirect → OWNER:/dashboard  STAFF:/home
```

---

## 五、API 权限对照

| API | 方法 | OWNER | STAFF | 未认证 |
|-----|------|:-----:|:-----:|:------:|
| `/api/auth/telegram` | POST | ✓ | ✓ | ✓（公开） |
| `/api/auth/bind` | POST | ✓ | ✓ | ✓（公开，用于旧备用路径） |
| `/api/auth/logout` | POST | ✓ | ✓ | ✓ |
| `/api/bind` | POST | ✓ | ✓ | ✓（公开，验证 token） |
| `/api/health` | GET | ✓ | ✓ | ✓（公开，诊断用） |
| `/api/products` | GET | ✓（含 DISABLED） | ✓（仅 ACTIVE） | 401 |
| `/api/products` | POST | ✓ | 403 | 401 |
| `/api/products/[id]` | PATCH | ✓ | 403 | 401 |
| `/api/sales` | POST | ✓ | ✓ | 401 |
| `/api/sales/lookup` | GET | ✓ | ✓ | 401 |
| `/api/records` | GET | ✓ | ✓（仅本店） | 401 |
| `/api/summary` | GET | ✓（全租户/维度） | ✓（仅本店） | 401 |
| `/api/stores` | GET | ✓ | 403 | 401 |
| `/api/admin/bind-tokens` | POST | ✓ | 403 | 401 |
| `/api/admin/users` | GET | ✓ | 403 | 401 |
| `/api/admin/users/[id]/unbind` | POST | ✓（不可自解绑） | 403 | 401 |

---

## 六、已知 v0 边界与遗留

| 编号 | 描述 | 状态 |
|------|------|------|
| B-01 | OWNER 无退款导航入口（/refund 可访问但不在 OWNER tab） | 保留，v1 评估 |
| B-02 | /home 对 OWNER 可访问（无法拦截），数据以 OWNER storeId 返回 | 保留 |
| B-03 | `/api/auth/bind`（旧备用路径，按 username 绑定）与 `/api/bind`（token 路径）并存 | 保留，v1 清理 |
| B-04 | bind token 无 UI 管理列表（已使用/已过期 token 不可查看） | v1 补齐 |
| B-05 | /system 无导航入口，仅从 /dashboard header 进入 | 保留 |
| B-06 | OWNER 导航无「首页」入口（进入 Mini App 直接到 /dashboard） | 保留 |
