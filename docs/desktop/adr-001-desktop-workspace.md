# ADR-001 — E-Shop Desktop 工程位置与集成方式（Milestone A）

日期：2026-07-13 ｜ 状态：Accepted ｜ 范围：E-Shop Desktop Milestone A

## Phase 1 审计结论（真实代码依据）

- 仓库：`light-ops-assistant`，Next.js 15.3（App Router）+ React 19 + TypeScript 5.8（strict），package manager 为 npm，部署 Vercel。
- `/desktop/pos`（`app/desktop/pos/page.tsx`，40 行，未冻结）：`mode=pos` 时复用冻结的 `app/cashier/page.tsx` 并挂载 `UsbCustomerDisplayBridge`；否则渲染 `/desktop` 模式选择页。
- `/desktop/display`（`app/desktop/display/page.tsx`，冻结）：每 800ms 轮询 `/api/pos/session/current`（云端 PosSession 兜底），同时监听 BroadcastChannel 实时消息。
- 本地实时通道已存在：`lib/customer-display-realtime-channel.ts`，通道名 `light-ops:customer-display:realtime:v1`，消息类型 `CART_SNAPSHOT | CLEAR`，含 `storeCode/sentAt/sequence/items/totalAmount/itemCount/currencyCode/status/paymentMethod/paymentStatus`，自带 sequence 防倒序 guard。
- 发布端：`app/cashier/page.tsx` 在 `/desktop/pos?mode=pos` 环境（`isUsbCustomerDisplayEventSource`）下发布快照；消费端：`/desktop/display` 监听并应用。
- 冻结边界（`docs/change-gates/gate-config.json`）：`app/cashier/page.tsx`、`app/desktop/display/page.tsx`、`middleware.ts`、`prisma/**`、`app/api/print/**` 等禁止修改。
- POS Device Authorization：`lib/desktop-pos-auth.ts` / `app/api/cashier/device-authorization/**`，运行在页面与云端之间，Desktop Shell 不介入。

## 决策

1. **Electron 工程位置**：仓库内独立工作区 `desktop/`（独立 `package.json` / `package-lock.json` / `tsconfig`），不加入 npm workspaces，不改动根 `package.json`。对现有 Next.js SaaS 的唯一根级改动：根 `tsconfig.json` `exclude` 增加 `"desktop"`（防止 Next 类型检查扫入 Electron 代码）。
2. **页面加载方式**：Cloud First。员工窗口加载 `{baseUrl}/desktop/pos?mode=pos&storeCode=…`，顾客窗口加载 `{baseUrl}/desktop/display?storeCode=…`。`baseUrl` 默认 `https://elifekh.com`，可经配置文件 / 环境变量指向本地开发服务。不复制任何 POS 业务代码。
3. **本地实时主通道（零冻结文件侵入）**：员工窗口 sandboxed preload 在同源隔离世界内订阅现有 BroadcastChannel，将快照经白名单 IPC 上报 Main；Main 权威校验 + 防倒序 + 缓存最新快照后下发顾客窗口 preload，回放到 BroadcastChannel（带 `relayedByDesktop` 防回环标记），由 `/desktop/display` 现有监听逻辑消费。**不修改任何冻结文件，不修改任何 Web 代码。** 云端 800ms 轮询继续作为恢复/兼容兜底。
4. **Desktop 环境检测**：preload 注入只读 `window.eshopDesktopRuntime`（isDesktop/runtime/windowRole/version），不使用 User-Agent。
5. **依赖策略**：仅 devDependencies（electron / electron-builder / typescript / vitest / @types/node），运行时零第三方依赖；日志、校验、退避均手写。
6. **打包与 CI**：electron-builder NSIS（x64，按用户安装，未签名），GitHub Actions `windows-latest` 构建（`.github/workflows/desktop-windows-build.yml`）。

## 备选方案与否决理由

- 修改 `/desktop/pos` 或 cashier 页面直接调用 preload API：侵入冻结链路，否决。
- 独立仓库：与 SaaS 页面契约演进脱节、双仓库版本协调成本高，否决（Baseline 第 5 条保证 Electron 可替换性不受 Monorepo 影响）。
- 依赖 Electron 下 BroadcastChannel 跨窗口原生直达作为主通道：行为属于 Chromium 实现细节且无法插入 Main 端校验、缓存与恢复重推，仅作为额外冗余，不作为契约。
