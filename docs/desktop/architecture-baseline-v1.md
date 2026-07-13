# E-Shop Desktop Architecture Baseline V1

状态：Milestone A 生效 ｜ 本文件为后续所有 Desktop Milestone 的不可违反基线。

## 产品定位

E-Shop Desktop：面向 Windows 一体机的专业门店收银客户端。
核心理念：**Cloud First · Desktop Native · Hardware Friendly**。
它不是新的业务系统，而是现有店小二 SaaS 之上的本地 Desktop Runtime。

## 六条基线原则

1. **Cloud is Business** — 商户/门店/商品/库存/销售/订单/会员/权限/Telegram/KHQR/支付/Mino BOS/AI/云端 API 全部继续属于云端。Desktop 不复制、不分叉、不重写业务逻辑。
2. **Desktop is Runtime** — Desktop 只负责 Electron 运行环境、窗口管理、本地 IPC、硬件接入、本地配置/缓存/离线队列、日志、健康状态、恢复机制、安装与升级。
3. **Hardware is Managed** — 硬件不得散落在 POS 页面直接调用。链路必须是：POS/Customer Display → Desktop Runtime → Hardware Manager → 设备。
4. **Cloud is the Source of Truth** — Desktop 可以有 Cache/Queue/Local Config/Offline Store/Logs，但不得把本地存储定义为独立业务数据库。
5. **Desktop Must Be Replaceable** — Electron 位于最外层；未来替换为 Tauri/WinUI/Avalonia/MAUI 等不应影响云端业务与硬件契约。
6. **AI Calls Runtime, Not Hardware** — AI 数字员工只能调用 Runtime 暴露的受控能力（Print/DeviceHealth/RestartDevice/OpenCustomerDisplay/ShowCustomerMessage 等），不得绕过 Runtime 直接访问硬件。

## 六层目标架构与 Milestone A 落点

| 层 | 职责 | Milestone A 实现 |
|---|---|---|
| React Desktop UI | 加载现有 POS / 顾客显示页面 | 加载 `{baseUrl}/desktop/pos`、`{baseUrl}/desktop/display`，零业务代码复制 |
| Window Manager | 双屏识别/布局/Kiosk/恢复/单实例 | `desktop/src/main/windowManager.ts` |
| Runtime Service | IPC / Event / 生命周期 / 本地实时同步 | `ipcRouter.ts` + `cartSyncService.ts` + `main.ts` |
| Hardware Manager | 统一设备接入 | `hardware/hardwareManager.ts`（接口 + 占位注册，Milestone B 接原生驱动） |
| Local Runtime | 配置/日志/健康/缓存与离线队列接口 | `config.ts` / `logger.ts` / `runtimeHealth.ts`（缓存与离线队列仍由现有 Web 层承担） |
| Cloud API | 现有 SaaS API | 不变，语义零修改 |

## 冻结边界（Milestone A 真机验收通过后冻结）

Electron Shell、Window Manager、IPC 基础契约（4 通道）、本地购物车实时同步链路、单实例、基础日志、Runtime Health 基础模型、Hardware Manager 接口框架、Windows 打包链。

## 留给后续 Milestone

- **B**：Native Print / Native Scanner / Native USB Customer Display / Hardware Manager 真实驱动
- **C**：Device Center、设备设置/检测/诊断、统一硬件日志
- **D**：Auto Update、Device Binding、License、Remote Diagnostics、Crash Report、连锁部署
- **E**：AI Runtime API、Mino BOS Runtime Connector、数字员工设备调用
