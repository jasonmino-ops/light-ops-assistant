# v0 页面映射基线文档

> 版本：v0.1（受控修订）
> 基线版本：v0（内测冻结，2026-04-03）
> 修订日期：2026-04-04
> 说明：v0.1 是在 v0 基线上的受控增量修订，不重做 v0 架构。本次修订补充了两项新特性：OWNER 前端工作模式切换、柬语（Khmer）多语言 P0 接入。路由结构、API 权限、认证流程不变。

---

## 一、角色定义

| 角色 | 说明 | 来源 |
|------|------|------|
| `OWNER` | 老板，全权限 | User.role = OWNER |
| `STAFF` | 员工，有限操作权限 | User.role = STAFF |
| `未绑定` | Telegram 账号未关联 DB 用户，无任何数据权限 | telegramId 在 DB 中无匹配 |
| `开发模拟` | 本地无 Telegram 上下文，由 `DEV_ROLE` env 模拟 | 仅 NODE_ENV=development |

> **v0.1 新增：工作模式**（仅 OWNER 适用，见第七节）
>
> | 工作模式 | 说明 |
> |----------|------|
> | `owner`（默认） | OWNER 正常模式，5 tab 导航，完整权限 |
> | `staff_view` | OWNER 临时切换为店员视角，4 tab 导航，纯前端状态，不改数据库角色 |

---

## 二、页面权限总表

| 路径 | 页面名称 | OWNER | STAFF | 未绑定 | middleware 保护 | 底部导航入口 |
|------|----------|:-----:|:-----:|:------:|:---------------:|:------------|
| `/` | 根页面（重定向） | → /dashboard | → /home | → /home | ✗ | — |
| `/home` | 员工首页 | ✓（可访问；`staff_view` 模式有导航入口） | ✓ | ✗（数据 API 401） | ✗ | STAFF: 🏠 首页 · OWNER(staff_view): 🏠 首页 |
| `/sale` | 销售 | ✓ | ✓ | ✗ | ✗ | STAFF: 💰 销售 · OWNER: 💰 销售 |
| `/refund` | 退款 | ✓ | ✓ | ✗ | ✗ | STAFF: ↩️ 退款 · OWNER(staff_view): ↩️ 退款 |
| `/records` | 记录 | ✓ | ✓ | ✗ | ✗ | STAFF: 📋 记录 · OWNER: 📋 记录 |
| `/dashboard` | 老板经营概览 | ✓ | ✗ → /home | ✗ → /home | ✓ | OWNER: 📊 概览 |
| `/products` | 商品管理 | ✓ | ✗ → /home | ✗ → /home | ✓ | OWNER: 📦 商品 |
| `/invite` | 邀请 & 成员管理 | ✓ | ✗ → /home | ✗ → /home | ✓ | OWNER: 🔗 邀请 |
| `/system` | 系统自检 | ✓ | ✗ → /home | ✗ → /home | ✓ | —（/dashboard 页头「系统」链接） |
| `/bind` | 首次绑定 | ✓（可重入，会 ALREADY_BOUND） | 同左 | ✓（主要入口） | ✗ | — |

> **说明**
> - middleware 重定向目标：非 OWNER 访问受保护路由 → `302 /home`
> - OWNER 在 `staff_view` 模式下底部导航切换为 STAFF 4 tab，但 middleware 角色不变（DB 角色仍为 OWNER）
> - `/refund` 在 OWNER `owner` 模式下无导航入口，在 `staff_view` 下通过 STAFF 4 tab 可见

---

## 三、导航结构

### STAFF 底部导航（4 tab）

```
🏠 /home → 💰 /sale → ↩️ /refund → 📋 /records
```

### OWNER 底部导航（5 tab，`owner` 模式）

```
💰 /sale → 📋 /records → 📦 /products → 🔗 /invite → 📊 /dashboard
```

### OWNER 底部导航（4 tab，`staff_view` 模式）

```
🏠 /home → 💰 /sale → ↩️ /refund → 📋 /records
```

> 模式切换逻辑由前端 `WorkModeProvider` 管理，状态持久化到 `localStorage('work-mode')`。

### 页头快捷入口

| 页面 | 快捷链接 | 目标 |
|------|----------|------|
| `/dashboard` | 「切换账号」按钮 | 退出 + reload → `/bind` 流程 |
| `/dashboard` | 「系统」链接 | `/system` |
| `/home`（OWNER，任意模式） | 当前模式标签 + 模式切换按钮 | `owner` 模式下显示「进入店员模式」→ 切换；`staff_view` 下显示「切回老板模式」→ 退出 |

---

## 四、OWNER 工作模式切换（v0.1 新增）

### 机制

- **实现层**：纯前端，`WorkModeProvider` React Context + `localStorage`
- **不改数据库角色**：DB `User.role` 始终为 `OWNER`，middleware 保护不受影响
- **STAFF 账号**：无法切换到老板模式，按钮不显示

### 切换入口

| 操作 | 入口 | 条件 |
|------|------|------|
| 进入 `staff_view` | `/home` 页头「进入店员模式」按钮（旁显示「老板模式」标签） | `realRole === 'OWNER'` 且当前为 `owner` 模式 |
| 退出 `staff_view` | `/home` 页头「切回老板模式」按钮（旁显示「店员模式」标签）**或**顶部橙色横幅「退出店员模式」按钮 | `isOwnerInStaffMode === true` |

### 实现说明

- `WorkModeProvider` 必须包裹 `BottomNav`（即 BottomNav 在 WorkModeProvider 内部渲染），否则 `useWorkMode()` 读取默认值，导航永远无法响应模式切换
- 模式切换使用 `router.push()`（Next.js 软导航），WorkModeProvider 保持挂载，状态立即生效，无页面闪烁
- 硬刷新后通过 `useEffect` 读取 `localStorage` 恢复模式状态

### staff_view 模式下的变化

| 维度 | 变化 |
|------|------|
| 底部导航 | 切换为 STAFF 4 tab（/home /sale /refund /records） |
| 页面顶部 | 固定显示橙色横幅「当前为店员模式」，含一键退出按钮 |
| 可访问页面 | /home、/sale、/refund、/records（与 STAFF 相同） |
| 数据权限 | 不变（仍为 OWNER 的 storeId，API 角色不变） |
| 持久化 | 刷新后保持 `staff_view` 状态（localStorage） |
| 退出后跳转 | → `/sale`（恢复 OWNER 模式） |

---

## 五、首次绑定 & 认证流程

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

## 六、API 权限对照

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

## 七、多语言支持状态（v0.1 新增）

### 支持语言

| 语言 | 代码 | 字典文件 | 字体 |
|------|------|----------|------|
| 简体中文（默认） | `zh` | `lib/i18n/zh.ts` | 系统字体 |
| 柬语（高棉语） | `km` | `lib/i18n/km.ts` | Noto Sans Khmer（Google Fonts） |

语言切换由 `LangProvider` Context 管理，持久化到 `localStorage('lang')`，在 `/home` 页头提供切换按钮。

### 各页面柬语接入状态（P0 范围）

| 页面 | 状态 | 覆盖范围 |
|------|------|----------|
| `/home` | ✅ 已完成 | 所有 UI 标签、摘要数值、快捷操作、记录卡、计数单位 |
| `/bind` | ✅ 已完成 | 全部绑定状态文案（verifying/success/error/no_tg）+ 客户端错误消息 |
| `/sale` | ✅ 已完成 | 全部 UI 标签、查询/扫码/购物车/成功卡、TMA 扫码提示、商品摘要 |
| `/refund` | ✅ 已完成 | 全部 UI 标签、三阶段标题、错误查找消息、表单校验、成功卡 |
| `/records` | ⬜ P1 范围 | 未接入 |
| `/products` | ⬜ P1 范围 | 未接入 |
| `/dashboard` | ⬜ P1 范围 | 未接入 |
| `/invite` | ⬜ P1 范围 | 未接入 |

---

## 八、已知边界与遗留

| 编号 | 描述 | 状态 |
|------|------|------|
| B-01 | OWNER `owner` 模式无退款导航入口（/refund 可访问但不在 5 tab） | 保留；`staff_view` 下通过 4 tab 可访问 |
| B-02 | /home 对 OWNER 可访问，数据以 OWNER storeId 返回 | 保留 |
| B-03 | `/api/auth/bind`（旧备用路径）与 `/api/bind`（token 路径）并存 | 保留，v1 清理 |
| B-04 | bind token 无 UI 管理列表（已使用/已过期 token 不可查看） | v1 补齐 |
| B-05 | /system 无导航入口，仅从 /dashboard header 进入 | 保留 |
| B-06 | OWNER `owner` 模式无「首页」导航入口（进入 Mini App 直接到 /dashboard） | 保留；`staff_view` 下通过 4 tab 可访问 |
| B-07 | OWNER `staff_view` 模式下数据权限不变（仍为 OWNER storeId） | 设计如此，不视为缺陷 |
| B-08 | `/bind` 页面的 Suspense fallback 文案（「加载中…」）不随语言切换 | 技术限制（SSR 阶段无法访问 LangContext） |
