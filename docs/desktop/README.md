# E-Shop Desktop Runtime V1 — 文档索引

> **当前状态：`MILESTONE A FINAL FROZEN`**
> **产品定位：`Cloud SaaS + Desktop Runtime`**
> 当前最新稳定 commit：`f90a81113e8e9f047d6ac572e08b2ae5d8a9790b`
> 下一阶段：Milestone B — Hardware Runtime（PLANNING ONLY，仅处理硬件运行时，不改 Milestone A 核心）

本目录是 E-Shop Desktop Runtime V1 的官方文档入口。

## 架构与设计

| 文档 | 说明 |
|---|---|
| [adr-001-desktop-workspace.md](adr-001-desktop-workspace.md) | ADR：独立 `desktop/` 工作区决策 |
| [architecture-baseline-v1.md](architecture-baseline-v1.md) | Architecture Baseline：Cloud/Desktop 边界、进程模型、总体架构基线 |
| [window-manager-design.md](window-manager-design.md) | Window Manager Design：双屏识别布局、Kiosk 顾客窗口、窗口恢复 |
| [ipc-contract.md](ipc-contract.md) | IPC Contract：固定白名单通道、CartSnapshot 契约、epoch/sequence 规则 |
| [security-boundary.md](security-boundary.md) | Security Boundary：sandbox / contextIsolation / preload 最小暴露 |

## 运行时能力

| 文档 | 说明 |
|---|---|
| [architecture-baseline-v1.md](architecture-baseline-v1.md) | Runtime Health 基础模型、Hardware Manager 接口框架（随基线文档） |
| [windows-build-and-install-guide.md](windows-build-and-install-guide.md) | Windows Build and Install Guide：CI 构建链、NSIS 安装包、本机安装 |

## 验收与冻结

| 文档 | 说明 |
|---|---|
| [milestone-a-acceptance-plan.md](milestone-a-acceptance-plan.md) | Acceptance Plan：验收项与验收方法 |
| [milestone-a-implementation-record.md](milestone-a-implementation-record.md) | Implementation Record：commit 映射与开发期验证结果 |
| [milestone-a-acceptance-record.md](milestone-a-acceptance-record.md) | **Acceptance Record：最终验收（ACCEPTED WITH KNOWN LIMITATIONS）** |
| [milestone-a-freeze-record.md](milestone-a-freeze-record.md) | **Freeze Record：最终冻结（FINAL FROZEN）、冻结范围与解冻条件** |
| [known-limitations.md](known-limitations.md) | Known Limitations：如实记录的已知限制 |
| [rollback-plan.md](rollback-plan.md) | Rollback Plan：回滚策略 |

## 冻结原则（速览）

Cloud is Business · Desktop is Runtime · Hardware is Managed · Cloud is the Source of Truth · Desktop Must Be Replaceable · AI Calls Runtime, Not Hardware

Milestone A 范围内任何变更须先满足 `milestone-a-freeze-record.md` 中的解冻条件。
