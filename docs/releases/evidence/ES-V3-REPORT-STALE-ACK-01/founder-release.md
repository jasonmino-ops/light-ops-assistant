# Founder 对本次精确发布决定书的答复

FOUNDER_DECISION_UTC=2026-11-27T18:30:15.968Z

对话原文 SHA-256 67f9cb1dc3e74487b02dd708d056d21ba44e837f699444f306a3b6fd803993f4，决定书 SHA-256 d4c2aac005d006f74efd795075a2178f470f04989b7b18a96a715d9577c55a6f。

Founder 批准 ES-V3-REPORT-STALE-ACK-01 本次精确生产发布。

授权严格绑定：

- Product：746ead6a
- Release：65a23a78
- 控制提交：1f86f6ee
- 签认单 SHA-256：d4c2aac005d006f74efd795075a2178f470f04989b7b18a96a715d9577c55a6f

执行要求：

1. 核对签认单 SHA-256、候选提交、Production 基线及发布窗口。
2. 按正式流程完成四份文件登记。
3. 从真实 main 重新读取 505 路径及冻结断言结果，确认与已签认的失败指纹完全一致。
4. 完成受保护 App 签发及 release 快进。
5. 所有发布守卫符合签认单后，执行本次限定范围的 Production 部署。
6. 任一基线、路径、指纹、签名或守卫不一致，立即停止，不得自行扩大授权。

发布后：

- 仅观察 V727 原 RC6 自然回报。
- 不修改或清理本机 Outbox。
- 不重发历史打印任务。
- 不修改 Owner、epoch 或执行起点。
- 不重新安装 RC6。

独立验收：

- Outbox = 0。
- 云端仍为第 2 版 SUCCEEDED/CROSSED。
- 本机执行次数仍为 1。
- 无新增实体打印。

只有上述结果全部确认后，才允许进入新电脑 Owner 交接准备。

本授权仅限本次 V3 REPORT 精确兼容修复，不包含其他功能开发、数据库迁移或额外部署。


---

# V3 REPORT 发布签认单（505 路径修订）

决定编号 `ST04-REPORT-ACK-505-20261128`。待 Founder 本人决定。此修订保留原产品与冻结断言，只更新失败处置及其发布证据绑定。旧签认单摘要为 `3f3649b2564591249c28e71bb2f48f5ce4f11623404cc0db1f6218966e0133a8`。先前条件授权不充作本单签认。

## 原断言及预期处置

| 观察条件 | 实际路径数 | 实际路径清单 SHA-256 | 冻结预期 | 原断言 |
| --- | ---: | --- | ---: | --- |
| 正式登记前 | 501 | `be4a6a1ab51d83c0bc0aa94e434be7ac73f80778dfa916d247168af4cfdb3eed` | 5 | FAIL，退出码 1 |
| 四文件登记后的隔离复现 | 505 | `d4cc4943148d47b22e791f214cecf91acf38d2ccb36acf75933f30251c396e67` | 5 | FAIL，退出码 1 |

原断言为 `tests/cashier-realtime-integration.test.ts:736:12`，5 条预期路径的 SHA-256 为 `ec8949b0ef9880ef457e577022a4e92948581865e7766b899207b266addb00ba`。生产基线与发布候选均实跑同一原断言，均得到表中结果。逐项比对证实只新增以下四个文件，无删除、修改或替换。下列路径相对于治理登记提交的直接父 Product 计数。

- `docs/releases/ES-V3-REPORT-STALE-ACK-01.json`
- `docs/releases/evidence/ES-V3-REPORT-STALE-ACK-01/controller-review.json`
- `docs/releases/evidence/ES-V3-REPORT-STALE-ACK-01/founder-release.md`
- `docs/releases/evidence/ES-V3-REPORT-STALE-ACK-01/validation-evidence.json`

离线夹具 `edb8cad009c8329d4da78e4336c29bb0760f7948` 只用于核对依赖路径名称的断言，所有夹具文件均无授权效力。正式登记的提交和四文件真实字节由生产签发流程核对。登记后、受保护 release 推进前，必须重新核对真实 main 的父、四项新增和实际文件摘要，基于真实 main 再跑相同的收银断言，核对断言位置、505 与 5 两份完整清单及返回码。任一输入漂移即停。

## 精确签认对象

| 对象 | 精确绑定 |
| --- | --- |
| 原 main | `e0fb1b90f34b57f61c5275f3389ee825ef55b872` |
| Product | `746ead6adb1f01784d7353e73de45cdd79400efb` |
| 线上基线及可回退部署 | `eeb1c6a5b5e44dcc3ed2c3cebd12c04994b9ec06` · `dpl_BcBDLHU7RrHEfQyL56yzSQu6unYM` |
| release 候选和树 | `65a23a780d16d607a0f8f818289e96c886eb1a60` · `019f923f90298e96971b0650232c21e50d71d77d` |
| 原适配器冻结后继载荷 SHA-256 | `e595406217ff4db1cb1389a8658d2db37afcd4e81bc34de07cfea94622bb5a9b` |
| 两阶段失败处置 SHA-256 | `83077e9ac276f0f5802bfa5a3ccab53222d4145399f0830b5a750da685943c4a` |
| 登记后单项断言指纹 | `9531606b66e8c6b0c814608fb829c3abf10a889d67b97681025871e855b8d03e` |
| 登记后 release CORE 七个失败断言的组合摘要 | `8fbaaa347ea63fd87a428cb1c2bafdd0d351063272d7aeec3c9cadc10d713d46` |
| 技术证据包 SHA-256 | `68e2fbff0980d6bdd83cdd104f3fb2977c0fa4ed44de836b0e5e3519880b3c4b` |
| 签发清单 SHA-256 | `906318a2adf896085e516afcfb021f017db5c499ec7899eeb0b26f3dbfac8c0a` |
| 控制分支 | `f7b9fa16bed84415e46d02e96844e3deb57de2fe` → `1f86f6eeb951397307d3490583b36ce96555d4ef` |
| 四个控制文件摘要 | `d7f8f38c9117cb1f1d58a0b957b8349a7c191ee6e132747eeafe868a11ad01eb` |
| 独立控制复审回执 SHA-256 | `5ea2c8d642df55b5cfd279b7f1800df808dfe753a429da4f1f2b1fe9f164e7ba` |
| 产品独立复审 SHA-256 | `8ffc14ce2c7fbb59051c3b474be7311fddbbb8070dcf0d76a20883d8a5b76e9f` |
| 适用窗口 UTC | `2026-11-27T17:45:00.000Z` 至 `2026-11-27T19:45:00.000Z`（上限不含） |

沿用原完整运行的原始结果。Product CORE 为 102/105，release CORE 为 100/104，release INTEGRATION 为 19/22，三个套件均保留 BLOCKED。登记后 release CORE 的七断言组合中，一项在两个原始 Git 树上实测重建指纹，另六项保留已有证据。本次未重跑完整套件。V3 专项 134/134、数据库 84 项通过及 1 项独立迁移演练跳过、并发和产品源码审查均按原输入哈希复用。新控制验证 14/14，旧证据包及把原始失败改写为 PASS 的证据均拒绝。正式 Lineage 以 CONTENT_SUBSET 通过。本单不认证新的 FIELD 结果。

## 待 Founder 决定的范围

如本人同意，则签认所列精确冻结后继及两阶段已知失败处置，并「批准精确回报兼容登记、一次App签发及受保护release快进部署」。只限上列 Product 入 main 及其直接子提交登记上述四项，建立非部署候选引用 `refs/heads/codex/es-v3-report-stale-ack-release`，控制分支快进至精确控制提交并由既有 App 签发一次。核对原 POST ID、有效上限和独立检查后，才可将 release 从上述基线快进至唯一候选。数据库迁移数为零。健康检查和回退沿用既有流程。有效期至 2026 年 11 月 28 日金边时间 02:45 前。

正式部署后仅观察原 RC6 自然重报，并分别独立核对 Outbox、云端第 2 版整行指纹、原执行次数及现场纸票。新电脑 Owner、历史打印任务和实体打印不在本单的操作范围内。
