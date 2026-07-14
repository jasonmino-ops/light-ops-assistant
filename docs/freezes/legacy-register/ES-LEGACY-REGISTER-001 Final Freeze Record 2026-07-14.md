# ES-LEGACY-REGISTER-001 Final Freeze Record 2026-07-14

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | ES-LEGACY-REGISTER-001 |
| 文档名称 | Legacy Grandfathered Register V1 |
| 正式版本 | V1.0 |
| 最终状态 | FINAL FROZEN |
| 生效日期 | 2026-07-14 |
| 资产类型 | Runtime 技术债治理登记册 |
| 下一份正式资产 | Milestone B Architecture Entry Gate |

## 上位冻结文件

- ES-CONST-001 — V1.0 — FINAL FROZEN
- ES-STRAT-001 — V1.0 — FINAL FROZEN
- ES-HRT-001 — V1.0 — FINAL FROZEN

## 版本演进

DRAFT → V1.0-RC1 → V1.0-RC2 → V1.0 FINAL FROZEN

## RC1 五项治理裁定

1. LEG-EHA-001 关闭规则：事件触发式治理，不冻结日历日期。
2. LEG-PRT-002 云打印归类：移出 HRT 范围，转 Cloud Governance。
3. Legacy Execution Record 承接：只冻结独立记录、不混用、指标隔离原则。
4. Register 维护授权：治理状态变更与运行事实更新拆分授权。
5. LEG-SCN-001 全量退出判据：九项 RETIRED 前置判据冻结。

## RC2 七项事实回填

1. LEG-DSP-001：代码链确认，基础 USB Web Serial 真机能力已验证，最新实时同步未 production verified，状态 PARTIALLY_VERIFIED。
2. LEG-EHA-001：外部 EHA 仓库不可访问，状态 PENDING_CLASSIFICATION / FACT_VERIFICATION_BLOCKED。
3. LEG-HMF-001：框架壳已加载，硬件发现、控制、状态与 Provider 管理未实现，状态 FACT_VERIFIED。
4. LEG-PRT-001 Consumer 归并：DesktopReceipt、DayCloseReport、ShiftReportPrint、cashier 页面归入同一浏览器打印链路。
5. LEG-SCN-001 证据归并：cashier 页面键盘楔扫码输入证据归入现有条目。
6. 新 Legacy 候选：未创建新 Legacy ID，首轮候选全部归并或移出。
7. 核实方式声明：两轮 Codex 核实均为只读；冻结后新证据只更新运行事实字段，不产生 RC3。

## RC2 历史快照来源

RC2 历史候选快照来源为创始人于 2026-07-14 提供并确认的权威 V1.0-RC2 正文。快照文件仅在头部增加存档说明，正文未做冻结后字段修正。

## LEG-PRT-002 字段归位

- Legacy Stage：N/A — OUT OF HRT SCOPE
- Classification Disposition：CLASSIFIED_OUT_OF_HRT_SCOPE
- Governance Transfer：TRANSFERRED_TO_CLOUD_GOVERNANCE
- 归类裁定保持不变：SW-AIOT 云打印不属 HRT 本地设备执行链路，转交 Cloud Governance，不作为 Milestone B HRT 迁移项。

## 二十四项冻结原则

1. Grandfathered 是豁免，不是许可。
2. 未登记即违规。
3. Legacy 不得扩建，只允许安全修复。
4. Legacy ID 一经分配永不复用。
5. 治理阶段采用六阶段：PENDING_CLASSIFICATION、REGISTERED、CONTAINED、MIGRATION_READY、MIGRATING、RETIRED。
6. 六阶段仅适用于仍处于 HRT Legacy 治理范围内的正式条目与候选治理对象。
7. 已移出 HRT 范围的历史记录不进入六阶段，其归类与治理转交独立记录。
8. 治理状态变更与运行事实更新使用不同授权边界。
9. Codex 只能机械更新已批准内容与事实字段，不得自行改变治理状态。
10. 浏览器打印属于 LEG-PRT-001，阶段 CONTAINED，事实状态 FACT_VERIFIED。
11. 键盘楔扫码属于 LEG-SCN-001，阶段 CONTAINED，事实状态 FACT_VERIFIED。
12. Web Serial USB 客显属于 LEG-DSP-001，阶段 CONTAINED，事实状态 PARTIALLY_VERIFIED。
13. EHA 应用 localhost HTTP API 记录 LEG-EHA-001 保持 PENDING_CLASSIFICATION，事实状态 FACT_VERIFICATION_BLOCKED。
14. HMF 框架壳属于 LEG-HMF-001，阶段 CONTAINED，事实状态 FACT_VERIFIED。
15. SW-AIOT 云打印记录 LEG-PRT-002 已归类为 HRT 范围外，并转交 Cloud Governance。
16. 浏览器打印迁移期使用独立 Legacy Execution Record，不与正式 HRT Outcome 混用。
17. EHA 旧应用入口若未来被确认存在，适用事件触发式关闭规则。
18. 扫码 Legacy 进入 RETIRED 前必须满足九项退出判据。
19. 命令类 Legacy 切换禁止双发。
20. 扫码双听期业务消费源必须唯一。
21. PARTIALLY_VERIFIED、FACT_VERIFICATION_BLOCKED 与 PENDING_CLASSIFICATION 是合法诚实状态，不妨碍 Register 冻结。
22. 冻结后，新证据更新属于运行数据维护，不产生 RC3。
23. 下位 Entry Gate、ADR、Development Package 与 Adapter Spec 不得推翻本 Register 的治理规则。
24. 本 Register 的规则修改必须通过 supersede 机制。

## 文件路径

| 文件 | 本地工作区路径 | Vault 目标路径 |
| --- | --- | --- |
| 正式版 | `/Users/jason/light-ops-assistant/docs/freezes/legacy-register/ES-LEGACY-REGISTER-001 Legacy Grandfathered Register V1.0 FINAL FROZEN.md` | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/03-冻结文档/01-正式冻结/ES-LEGACY-REGISTER-001 Legacy Grandfathered Register V1.0 FINAL FROZEN.md` |
| RC2 历史快照 | `/Users/jason/light-ops-assistant/docs/freezes/legacy-register/ES-LEGACY-REGISTER-001 V1.0-RC2 Historical Candidate 2026-07-14.md` | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/03-冻结文档/00-候选评审/ES-LEGACY-REGISTER-001 V1.0-RC2 Historical Candidate 2026-07-14.md` |
| Final Freeze Record | `/Users/jason/light-ops-assistant/docs/freezes/legacy-register/ES-LEGACY-REGISTER-001 Final Freeze Record 2026-07-14.md` | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/03-冻结文档/ES-LEGACY-REGISTER-001 Final Freeze Record 2026-07-14.md` |

## Vault 状态

三份文件已真实写入 Obsidian Vault 目标路径。

## Supersede 要求

本 Register 已 FINAL FROZEN。后续事实字段、证据路径与迁移阶段按第 6 章作为运行数据维护；治理规则、字段结构、首批治理对象体系或冻结原则如需修改，必须通过 supersede 机制，不得创建 RC3。
