# Founder 对本次精确发布决定书的答复

FOUNDER_DECISION_UTC=2026-11-27T12:09:16.983Z

对话原文 SHA-256 abdecb667435c186f755d3d9e0152a53b5d44a8b67698ebd5bd3bbbe6fed1975，决定书 SHA-256 01741f82e446720c58f1a3b27803e686e3a323a87a4a558cf04f070d471f3ce7。

本人签认决定书并批准精确发布

---

# V727 换机超时修复 · 精确生产发布决定书

2026-11-27。决定编号 `ES-PRINT-OWNER-P2028-20261127`。本文件供 Founder 本人签认，签认由正式回执另行记录。

## 现场故障与修复

ST04C05602 老板换机请求运行 5537 ms 后返回 HTTP 500 / Prisma P2028。主库仍为旧机 t4q50o87、epoch 1、状态版本 4744，有效批次 0，本次换机审计及执行起点 0。七张历史票和现场新订单的前台票均为 PENDING，领取与执行均为 0，物理结果 UNKNOWN。

Production 默认函数在美国东部 iad1，数据库在新加坡。隔离 PostgreSQL 实测同一成功路径包含 48 次串行数据库交互。在驱动回复延迟为 190 ms 的两次运行中，事务均超时并完整回滚；在延迟为 3 ms 的两次运行中，耗时 199 和 196 ms，并各自正确提交一次。生产没有逐语句耗时或该次锁等待的完整记录。跨区往返足以复现故障，生产当时锁等待的贡献仍为 UNKNOWN。

发布改动只把老板打印控制面函数指定到新加坡 sin1，并将相同精确预期加入完整部署策略断言。此接口对所有门店的读写请求都会在新地域运行，整个产品的其余 636 个函数入口沿用既有选择。真实 Vercel 打包确认老板端两个入口指向同一物理函数。交易、库存、Diamond 打印执行、数据库事务、超时、Owner、Lease、Fence、历史票及 RC6 客户端程序字节保持原状。风险为该接口的新地域启动、容量及实际数据库耗时；生产成功以新部署上的读回为准。

## 精确签认对象

| 对象 | 绑定值 |
| --- | --- |
| 当前 Production | `9e3b868622175bd5ddfa6cdcd26e066dc34aafce` · `dpl_7PCgwGH8ria3pvXnRYhvrona7P39` |
| 当前可信 main | `c9e446228f0b50e4751d6b8b01ed4417d2d0f8bc` |
| 唯一 Product | `45ab9917fed7d097a88b5f6060ad45fe303ea6fe` |
| 精确 release | `eeb1c6a5b5e44dcc3ed2c3cebd12c04994b9ec06` |
| release tree | `5e751f9a2e1b9358a78fa2541e96b64cd8b18e70` |
| 两文件冻结与部署策略后继 SHA-256 | `7154539a3710a6b9f7be1bdb7cbd6d18637d9e8ac62566d2971cc6127c68c594` |
| 逐项失败处置 SHA-256 | `3c790fc20ab2cafdf7e3ee27af8cd268b1f5e247091f1f5d47711555bd674999` |
| 完整技术证据 SHA-256 | `2ce5a95b0f4870bf935dec7547aaf242182587f4d9f1adc53a0729fedceae5cc` |
| 签发清单 SHA-256 | `79a514edee0f977a6e69d60e76bdd4a973dd92392422a26fcfc66c53cd61be24` |
| 签发控制分支 | `83d6a3e754e91b0646d38501ca79540ccddd0cdb` → `f7b9fa16bed84415e46d02e96844e3deb57de2fe` |
| 控制四文件合并摘要 | `7364928997dad57cbe97110b07bc4922827ffe46f0d7fcf472bf8a56df966d36` |
| 产品独立复审 SHA-256 | `8b8e43d3db34d511e76d2161d750fa93f761bf729b8296b6de130af90f5d3d30` |
| 控制器独立复审回执 SHA-256 | `3dba2b62de49357af9895ef78212600b24225587b28ff79931aefee4131d0bd4` |
| 固定授权窗口（UTC） | `2026-11-27T11:30:00.000Z` 至 `2026-11-27T13:30:00.000Z`（上限不含） |

源与发布树均只增加三行部署配置及三行相应全配置期望，确切路径为 `vercel.json` 与 `tests/network-release-deployment-policy.test.cjs`。正式完整回归原始结果为 release CORE 100/104、release integration 19/22、main CORE 102/105。三组与各自基线的失败测试、断言指纹和数量已逐项比对。签认接受此候选所列既有失败，保留各套件 BLOCKED 原结果。正式默认校验器、GitHub 规则、App 权限及一次签发协议继续生效。

release CORE 和 integration 的基线均在原 Production 9e3b8686 实跑。main CORE 对照在 8ff33feb 实跑，此提交与当前 main 基线 c9e44622 相差五个治理文件。

## 签认后准许的操作

1. 登记候选非部署引用 `refs/heads/codex/es-print-owner-p2028-final-release`。main 自上述基线快进至 Product 和其后的单个登记提交。登记仅新增 `docs/releases/ES-PRINT-DEVICE-TAKEOVER-P2028.json` 以及同名 evidence 子目录中的 founder-release.md、controller-review.json、validation-evidence.json。
2. 本次决定的正式范围为「批准精确换机签发器接入、一次App签发及受保护release快进部署」。控制分支仅快进至上述控制提交；唯一有效 App 和原 POST ID 必须独立读回，受保护 Actions 的首次执行必须成功。
3. 在有效窗口内确认正式域名、Git 基线、App 回执、店主角色与八张票前像，再将 release 从上述 Production 基线快进到精确候选。零迁移。由既有 Vercel Git 流程发布并读回 Production alias、部署 commit、健康和实际函数配置或请求地域。
4. 线上确认后，沿用既有现场权限，V727 生成新的 READY。真实老板重开 Telegram，仅在旧机 t4q50o87、新机 a3464hkt 一致时确认一次。主库新 Owner、epoch、Lease/Fence 和起点均通过后才进入已授权的双角色配置及纸票验收。原订单和所有旧票维持原状。
5. 健康、回执、时间、独占窗口、角色或前像漂移则停在对应步骤。App 响应不确定时保留 run 和原始回执，不重新签发。可恢复的程序版本为上述原部署与原 release 树；如需回退，走既有受保护回退流程并核验域名与版本。发布许可不包含关闭守卫、直接生产写库、强制抢占、修改其他门店、重放或补打。
