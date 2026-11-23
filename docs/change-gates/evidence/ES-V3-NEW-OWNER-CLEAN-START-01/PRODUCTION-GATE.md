# ST04C05602 七票隔离与 V727 新 Owner 生产准入申请

**状态为待审批。** 本地 L3 实现和独立源码复审通过。上一次线上只读快照仍为七条 FRONT PENDING，领取、执行次数均为零，物理结果均为 UNKNOWN。旧机已由 Founder 确认断电退役。当前申请的最小决定，是接受下列精确源码进入受保护发布流程。发布门禁、生产处置签认、Owner 操作及纸票验收各有独立回执。

## 源码和证据绑定

| 对象 | 精确标识 |
| --- | --- |
| 任务与门店 | ES-V3-NEW-OWNER-CLEAN-START-01，复用 ES-V3-LEGACY-PENDING-DISPOSITION-01 的获批设计；ST04C05602 |
| 签认设计 SHA-256 | `d746925f7b4c69f4cfddf1bafdbdb309def98945673601ef8e1b23ac91eba419` |
| 七票清单 / 线上快照 SHA-256 | `5b53783cd4b979ad1370c54a57fad8540f854fe64dec64eb47cddc94afb5611c` / `6c759971f4318b281007adf79835368978149cc5a36b15b9cc80164200e21d4f` |
| 受审产品 / tree | `100826d5b502e55d8726aaa1922b1885ad16afee` / `440fbc2c299e7ba9f8df9ef40417bebd43fa824f` |
| 九个变更文件 SHA-256 清单 | `7a6f7125b35066d8d874cc8ad2bea6f1c6852bb0afb2fe956523849ca86a4cfa`，逐件列于同目录 `source.SHA256SUMS` |
| 开发基线 | `origin/main 1fe4481dcc64adf48af2c4d5cfff8addf79ed3a1`，本地分支 `codex/es-v3-legacy-pending-disposition-01` |
| 开工时 Production | `b36c47e137693e067a7d26d40706df8f89610f29`，`dpl_Enq3R1v2BezAHNh7G1mW6KYdj53g`，READY。开发血统 CONTENT_SUBSET PASS，STRICT 父链分叉。未使用纯文档例外。 |

## 受保护发布的边界

- 本地 PostgreSQL 在金边和 UTC 各通过 37/37。验证覆盖七票事务全回滚、重复申请、迟到回报、并发占锁、旧业务键换名、HELD、切换前及等时任务、提交后读回失联、授权撤销后只读验真，以及同一新订单的 FRONT 与 KITCHEN 各领取一次。独立 Codex 源码复审在精确产品上重跑两套专项及 11/11 控制面契约，结论 PASS。RC5 本机模拟端点、设置及 USB/TCP 回归 56/56。原始测试摘要和指纹记录于同目录 `verification.json`。
- 四套既有 V3 回归 131 PASS、1 FAIL。干净主线独立复现收银/交班冻结后继校验失败。Root CORE 在候选和干净主线均因 `tests/cashier-large-cart-query.test.cjs` 未归入清单而阻断，执行数为零。本次未给这两个失败签发豁免。
- 代码复用原 EshopTrayPrintJob、OperationLog、控制面事务与店主交接入口。Owner/Lease/Fence、HELD materialize、结果回报、设备 Ledger/Outbox、schema 及 migration 无语义修改。适配器文件历史冻结指纹为 `992900c79a0d422e6d7c5359ebc15b628ceee31cbc84e19d5fbbb65076b2fb63`，本次指纹为 `b24c4bbf902c145ffef5f48ee52b25a39a87c567f8315f1d42d1ffec3878e22d`。新差异只在精确门店和业务效果约束收单及领取；原 HELD、结果回报函数字节相同。按现行冻结后继流程绑定该文件的新指纹，另核验候选发布树、依赖和平台门禁。
- 待门禁按正式流程处理后，以当时实际 Production 为父版本准备最小受保护发布。再次核对线上 Git SHA、release lineage、实际构建和部署 ID，绑定授权到实际落地的 release SHA。上线代码本身不会处置七票或交接 Owner，但会立即约束本店的旧效果入队、V727 领取和普通 FINALIZE。此次实现不需要 schema migration。历史 HMAC 回执依赖现有服务端签名密钥；轮换前须保留历史验签能力，否则本案领取安全停止。

## 生产变化清单与逐项读回

| 顺序 | 精确操作 | 成功或停止条件 |
| --- | --- | --- |
| 1. 核对现场 | 只对租户 `cmqjgcmtm000104jo54e93w1c`、门店 `cmqjgcn05000204jo83w65tja`。旧设备 `cmv7pcvbz000206lat4q50o87`，新设备 `cmwsu4zip001s08l4a3464hkt`。固定清单中七个 ID，独占并排空本店离线和在线生产者。 | 服务器时钟达到 2026-11-24 12:39:31.396 金边时间，验证每票原期限、业务键、同店原销售凭据及票面指纹。确认 V727 本机真实 userData、运行时待办、Ledger/Outbox 及后台全空。先前观察到队列 0、暂存端点存在、活动端点未出现；文件缺失不能证明排空。退役机无需开机。 |
| 2. 仅处置七票 A | 绑定操作号 `2673e734-1728-462a-8be5-16a4bfe7ff29`、可信发布和部署、七票清单、完整前像摘要及两名不同且有效的 Ops。由受控环境只读计算签名前像摘要，字段与顺序取受审 `ticket`、`fingerprint`，只导出摘要。Founder 对七票操作单独签认后方可登记短时 A grant。复核人提交 REVIEW，执行人提交 APPLY，同一事务每票保存前后像。 | 只有七条原行的调度状态变为 EXPIRED，原因 `V3_OPS_QUARANTINED_PHYSICAL_UNKNOWN`，updatedAt 记录处置时间。原票面、幂等键、领取/执行计数保留，completedAt、resultStatus、effectBoundary 为空，physicalCompletionKnown 为 false。核验七个审计、汇总和完整前像。 |
| 3. 店主受控交接 | A 完成且严格 READBACK 返回 HANDOFF_PREFLIGHT_OK 后，另请 Founder 批准 CONTROLLED_HANDOFF。固定 confirmationId 为 `ST04C05602-V727-LEGACY7-20261124-01`。店主用既有身份从 4744 发起，到 4745。隔离期满足后，以同一确认号及 V727 身份从 4745 确认，到 4746。 | 读回 epoch 2、BLOCKED_UNKNOWN、新租约和旧过期批次的正常撤销。两阶段之间出现新批次、任务、版本或设备变化立即停止。 |
| 4. 激活 B | B 须另行签认，绑定 A 的实际 afterHash、确认号、V727、epoch 2、状态版本 4746 和新鲜排空证据。正常 Ops FINALIZE 在同一事务检查 A 的七票回执、HELD 为零及租约。 | 期望 4747、V3_ACTIVE。只在原两分钟租约内激活，保留提交余量。持久化签名切换时间。V727 领取时原 Fence 先验证，再按角色仅选严格晚于该时间的新票。过期、锁争用、审计不完整或任何漂移均停止。 |
| 5. 两张新票 | 单独批准现场实测后，在当前 V727 正式入口保存并回读活动端点。FRONT 为 `E-Shop FRONT USB003`，核验实体 `USB\VID_0483&PID_5743\1C7D118C0000`。KITCHEN 为 NP330 `192.168.18.229:9100`，核验 MAC `00-9D-85-8E-7E-E1`。原暂存配置指纹 `f2ed5d09de40ba8e33fde1372b0a2cdbb20e169ce5e71c846ca66d5e5de402f3`。 | 在有效新 fenced batch 下先 FRONT 后 KITCHEN，各一张、各用新的诊断 ID。观察人逐张核对 ID、角色、打印机、张数、时间及诊断回执。任一结果 UNKNOWN 即停止。厨房营业开关保持现状。同单营业分流另需独立现场证据。 |

## 回包丢失或中途失败

当前获准的两位 Ops 可在原门店控制面 GET 加 `?legacySevenReceipt=1`，以只读事务识别 A 已提交、B 已提交或尚无对应回执。结果不授予执行权。A 的严格 READBACK 另行检查当时的 Owner 和队列，才可用作交接前置条件。B 返回 `CASE_ACTIVATION_COMMITTED_READBACK_REQUIRED` 时应先读回；超时、回执冲突或完整性未知时保持停止。禁止重试实际打印、换键重建旧票、将旧票改回 PENDING，或在交接后回退到缺少新 Owner 领取限制的代码。

本地分支已提交源码，独立源码审查已完成。线上审批记录尚未签发。未 push、合并、部署、迁移、处置七票、修改 Owner 或发送打印；FIELD 待验，任务 OPEN。
