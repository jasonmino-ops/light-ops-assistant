# E-Shop Desktop — Milestone A Implementation Record

日期：2026-07-13 ｜ 状态：开发完成，待 Windows CI 构建 + 真机验收

## 结论

Milestone A（Desktop Shell）代码、测试、打包链、文档全部完成。
本环境（Linux ARM64 沙箱）已验证：Desktop Type Check、53 项单元测试、tsc 编译、Web 层回归单测、Dev-Gate-01A 变更范围守卫。
Windows 安装包由 GitHub Actions（windows-latest）生成；真机验收按 `milestone-a-acceptance-plan.md` 执行。

## Commit 列表

| Hash | 职责 |
|---|---|
| `8a1474f` | Desktop scaffold：独立 Electron 工作区 + 根 tsconfig exclude（唯一根级改动） |
| `64699da` | Runtime foundations：脱敏滚动日志 / RuntimeHealth / 本地配置 / HardwareManager 接口框架（A1/A8/A9/A10） |
| `35368f0` | Window Manager：双屏识别布局 / Kiosk 顾客窗口 / 有限退避恢复 / Tray（A3/A7/A12） |
| `b81410a` | IPC realtime cart sync：白名单通道 / payload 校验 / 快照重推 / preload / 单实例主入口（A2/A4/A5/A6） |
| `218a1d8` | Packaging & CI：electron-builder NSIS + windows-latest 工作流（A11） |
| `97ff3cb` | Tests & docs：53 项测试 + 9 份架构/验收/回滚文档 |
| （本文件） | Implementation record |

## 新增 / 修改文件

**修改（1 个）**：`tsconfig.json`（exclude 增加 `"desktop"`）

**新增 — Desktop 工程**：
`desktop/package.json`、`desktop/package-lock.json`、`desktop/tsconfig.json`、`desktop/tsconfig.build.json`、`desktop/electron-builder.yml`、`desktop/.gitignore`
`desktop/src/main/main.ts`、`windowManager.ts`、`ipcRouter.ts`、`cartSyncService.ts`、`logger.ts`、`config.ts`、`runtimeHealth.ts`、`tray.ts`、`hardware/hardwareManager.ts`
`desktop/src/preload/employeePreload.ts`、`customerPreload.ts`
`desktop/src/shared/ipcChannels.ts`、`cartSnapshot.ts`、`backoff.ts`
`desktop/tests/`：`cart-snapshot.test.ts`、`cart-sync-service.test.ts`、`recovery-backoff.test.ts`、`ipc-whitelist.test.ts`、`static-security.test.ts`、`config.test.ts`

**新增 — CI**：`.github/workflows/desktop-windows-build.yml`

**新增 — 文档**：`docs/desktop/`（adr-001、architecture-baseline-v1、ipc-contract、window-manager-design、security-boundary、windows-build-and-install-guide、milestone-a-acceptance-plan、known-limitations、rollback-plan、本文件）

**未触碰**：全部冻结文件、`app/**`、`lib/**`、`prisma/**`、支付/打印/授权链路、浏览器版 POS 全部能力。

## 构建与测试结果（如实标注执行环境）

| 项 | 结果 | 执行环境 |
|---|---|---|
| Desktop Type Check（tsc --noEmit） | ✅ 通过 | Linux ARM64 沙箱 |
| Desktop 单元测试（vitest，6 文件 53 用例） | ✅ 全部通过 | Linux ARM64 沙箱 |
| Desktop 编译（tsc → dist/main + dist/preload） | ✅ 通过 | Linux ARM64 沙箱 |
| Web 回归单测（realtime-channel / cart-sync-static） | ✅ 通过（tsc 转译 + node 执行） | Linux ARM64 沙箱 |
| 根 tsc --noEmit（验证 desktop 排除生效） | ✅ desktop 无泄漏；存在 1 处与本次无关的既有报错（见 known-limitations #10） | Linux ARM64 沙箱 |
| Dev-Gate-01A check-change-scope | ✅ PASS | Linux ARM64 沙箱 |
| Web Build（next build） | ⚠️ 无法在本环境执行：仓库 node_modules 为 darwin-arm64 原生二进制（@next/swc），沙箱为 Linux；为不破坏本机开发环境未重装。Vercel/本机构建不受影响（改动仅 tsconfig exclude 一行） | — |
| Electron 真机启动 / 双屏 / 单实例 | ❌ 未执行（需 Windows 真机） | 待真机 |
| Windows 安装包 | ❌ 本环境未生成；由 GitHub Actions windows-latest 生成 Artifact | 待 CI |

## 构建物与路径

- 编译产物：`desktop/dist/`（本地生成，git 忽略）
- 安装包：CI Artifact `eshop-desktop-windows-installer`（`E-Shop-Desktop-Setup-0.1.0.exe`）；Windows 本机 `desktop/release/`
- 运行日志：`%APPDATA%\eshop-desktop\logs\eshop-desktop.log`
- 配置：`%APPDATA%\eshop-desktop\config.json`；窗口状态 `window-state.json`

## 注意事项

- `desktop/node_modules` 在沙箱内以 Linux 平台安装；Jason 本机使用前请在 macOS/Windows 执行 `cd desktop && npm ci`。
- Electron 二进制未在沙箱下载（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）；`npm ci` 会自动补齐。
