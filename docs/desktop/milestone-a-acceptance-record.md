# E-Shop Desktop — Milestone A Acceptance Record

## 1. Milestone 信息

| 项 | 值 |
|---|---|
| 名称 | E-Shop Desktop Milestone A — Desktop Shell |
| 最终验收状态 | **ACCEPTED WITH KNOWN LIMITATIONS** |
| 验收日期 | 2026-07-13 |
| 最终 commit（A.1 全屏补丁） | `f90a81113e8e9f047d6ac572e08b2ae5d8a9790b` |
| Codex 审计修复 commit | `48f00501a42cf9d668194dc5c6484d102d8eca06` |
| Claude 开发 commit | `8a1474f` / `64699da` / `35368f0` / `b81410a` / `218a1d8` / `97ff3cb` / `06094fc` |
| Windows CI workflow | `desktop-windows-build`，针对 `f90a811` 的 run：**Success**（2026-07-13，GitHub Actions 页面确认；run 编号未归档） |

## 2. 已验收范围

- Electron Shell（独立 `desktop/` 工作区，不侵入 SaaS 代码）
- 主进程 / Preload / Renderer 安全边界（sandbox、contextIsolation、无 Node 直通）
- Window Manager（双屏识别布局）
- 单实例锁
- 员工窗口（窗口化，A.1 起支持原生全屏桥接）
- 顾客窗口（Kiosk）
- 顾客窗口恢复（有限退避 + 快照重推）
- 本地 IPC（固定白名单通道 + payload 校验）
- 购物车实时同步（CartSnapshot 契约）
- desktopEpoch / sequence 防倒序（跨 reload epoch 守卫，审计修复 `48f0050`）
- Runtime Health 基础模型
- Hardware Manager 基础框架（仅接口，无原生实现）
- Tray 与退出策略
- 脱敏滚动日志
- Windows 打包链（electron-builder NSIS x64 + GitHub Actions）
- macOS 员工端原生全屏（A.1 补丁 `f90a811`）
- 浏览器版全屏回归（浏览器 / Electron 全屏分流，iPad 顾客页不受影响）

## 3. 验证证据

### 自动化验证

| 项 | 结果 | 说明 |
|---|---|---|
| Desktop Type Check（tsc --noEmit） | ✅ | 本地 + CI |
| Desktop 单元测试 | ✅ 7 files / 69 tests | vitest；含 IPC 白名单、快照校验（18 组非法 payload）、epoch/sequence、全屏 IPC、静态安全扫描 |
| Desktop 编译（tsc → dist/main + dist/preload） | ✅ | 本地 + CI |
| Web build（next build） | ✅ | macOS 本机 |
| Windows CI（`desktop-windows-build`） | ✅ Success（`f90a811`，2026-07-13） | windows-latest：npm ci → typecheck → tests → compile → electron-builder NSIS x64 → artifact upload 全部成功 |
| NSIS x64 artifact | ✅ 已生成并上传 | Artifact 名：`eshop-desktop-windows-installer`（`E-Shop-Desktop-Setup-0.1.0.exe` + blockmap + latest.yml，上传路径 `desktop/release/`） |

### 真机验证（macOS，2026-07-13）

| 项 | 结果 |
|---|---|
| macOS Electron 真机启动 | ✅ |
| 员工窗口 | ✅ |
| 顾客端（iPad 浏览器页） | ✅ 不受桌面端影响 |
| 购物车实时同步 | ✅ |
| reload / desktopEpoch 防倒序 | ✅ |
| 顾客窗口恢复 | ✅ |
| 单实例 | ✅ |
| Tray 与退出 | ✅ |
| 顾客端全屏 | ✅ |
| 员工端原生全屏（A.1） | ✅ |
| 退出全屏 | ✅ |
| 浏览器版全屏回归 | ✅ |
| 顾客端不受员工全屏影响 | ✅ |

未执行（如实记录）：Windows 真机双屏、完整安装 / 卸载 / 快捷方式验证。上述项未写入验收证据，列为已知限制。

## 4. 已知限制

1. Windows 安装包未代码签名，首次安装可能出现 SmartScreen 提示。
2. Windows 一体机的完整安装 / 卸载，建议部署时现场复验。
3. Native Print / Native Scanner / Native USB Customer Display 属于 Milestone B（后续规划范围，非当前缺陷）。

## 5. 验收结论

**ACCEPTED WITH KNOWN LIMITATIONS**

Milestone A 的核心架构、代码、安全边界、构建链与 macOS 真机主链路均已通过开发验证、独立审计、自动化测试与真机复验，可以进入冻结。冻结详情见 `milestone-a-freeze-record.md`。
