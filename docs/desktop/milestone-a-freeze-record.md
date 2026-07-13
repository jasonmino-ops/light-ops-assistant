# E-Shop Desktop — Milestone A Freeze Record

冻结状态：**FINAL FROZEN**
冻结日期：2026-07-13
冻结基线 commit：`f90a81113e8e9f047d6ac572e08b2ae5d8a9790b`
验收依据：`milestone-a-acceptance-record.md`（ACCEPTED WITH KNOWN LIMITATIONS）

## 冻结范围

- `desktop/` 工程基础结构（独立 Electron 工作区、tsconfig、electron-builder 配置）
- Electron 主进程（main / windowManager / ipcRouter / cartSyncService / logger / config / runtimeHealth / tray）
- 两个 sandboxed preload（employeePreload / customerPreload）
- IPC 固定白名单机制（ipcChannels 定义 + 校验）
- CartSnapshot 契约（字段、校验规则、上限约束）
- desktopEpoch 与 sequence 规则（防倒序 + 跨 reload epoch 守卫）
- Window Manager（双屏识别布局）
- 单实例锁
- 顾客窗口恢复（有限退避 + 快照重推）
- Runtime Health 基础模型
- Hardware Manager 接口框架
- Tray 与退出策略
- Desktop 本地脱敏滚动日志
- Windows CI / NSIS 构建链（`desktop-windows-build`）
- Electron 员工端原生全屏桥接（A.1）
- 浏览器 / Electron 全屏分流方式

## 冻结原则

- Cloud is Business
- Desktop is Runtime
- Hardware is Managed
- Cloud is the Source of Truth
- Desktop Must Be Replaceable
- AI Calls Runtime, Not Hardware

## 冻结后禁止事项

未经新 Milestone 或正式变更评审，不得：

- 在 Electron 内复制业务逻辑
- 绕过 Preload 直接开放 Node 能力
- 增加任意 IPC channel（白名单之外）
- 允许顾客窗口控制员工 POS
- 删除 PosSession 云端兜底
- 删除浏览器版 POS
- 改写 sequence / epoch 规则
- 把硬件代码散落回页面层
- 在 Milestone B 中顺带重构 Milestone A 核心
- 未经评审改动 Electron 安全边界配置

## 后续允许扩展（仅限新 Milestone）

- Native Print
- Native Scanner
- Native USB Customer Display
- Device Center
- Auto Update
- Remote Diagnostics
- AI Runtime API
- Mino BOS Connector

## 解冻条件

仅在以下情况允许解冻：

1. 真实生产 Blocker
2. 高危安全问题
3. Windows 真机证明当前结构存在核心缺陷
4. 后续 Milestone 必须修改基础契约，且经过正式变更评审

## 下一阶段

Milestone B — Hardware Runtime，当前状态：**PLANNING ONLY**。本冻结记录生效后，Milestone A 范围内代码仅接受符合解冻条件的变更。
