# 2026-11-06 Diamond 新订单 FRONT 打印恢复：候选交付

## 当前业务状态

最新正式只读查询时间：2026-11-06 15:26:51.918853 UTC。Diamond 仍为 **BLOCKED_UNKNOWN / stateVersion 696**，Owner 与 Lease 均为空。三笔历史异常任务仍为 PENDING、TTL 已过期，attempt/claim 为零，无执行或完成时间。当前另有 **21 笔 TTL 有效的 held FRONT**，没有 KITCHEN；另有一笔历史 SUCCEEDED，禁止自动重放。本数字是时点摘要，既不是释放授权，也不是数量上限。释放前必须重新核验全部队列、订单状态、执行证据与 TTL。

因此现有链路不能在保持当前安全合同的情况下仅绕开三笔异常任务恢复新订单。FINALIZE 仍被未终结历史任务阻挡；已成功但消耗且过期的 REVIEW 也不能继续 EXPIRE。普通双管理员恢复要求两个不同 OPS_ADMIN，而真实账号中只有一名 ACTIVE SUPER_ADMIN、零 OPS_ADMIN；不建议临时创建身份规避此限制。正式补打同样不构成绕过 V3 权限的路径。

## 最短合法恢复路径

1. 完成精确 EXPIRE 超时修复与一次性补偿准入的正式候选和审查，取得所需冻结准入及精确发布授权。
2. 正式发布后，以真实 SUPER_ADMIN、新鲜受信 Windows 证据、当前 Installation Identity 和 fence 执行单次补偿 REVIEW，再 EXPIRE；旧 REVIEW、原始失败与新审计保持链接。
3. 确认三笔任务 EXPIRED / NOT_CROSSED 且成功审计存在后，按正式流程 FINALIZE，并由唯一 Desktop ACQUIRE Owner。
4. 优先观察新订单 FRONT ACK 和实体出纸；合法历史队列自然释放，无人为数量上限。排除已 ACK、已取消、已过期和执行未知任务；需要人工补打时使用正式标记补打能力。不得降低交易幂等、角色路由及 Owner/Lease/Fence。

当前 FRONT 实际 Runtime 配置仍 UNKNOWN；已知 TCP 可达不等于配置已验证。不再安装诊断包或要求停止正在营业的 Desktop。Provider 既有 READY / 304 秒稳定性证据继续保留，不重复测试或重做安装器。

## 已完成的最小修复

产品候选 **ca7e04ec9d600e568d29258f1e0dc9879c96a72c**，基于可信 main c1041533abca99657edc09c2e69e2c18d9df13d5；分支 codex/es-diamond-v3-expire-timeout-recovery-01。

仅两个产品文件：
- app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts
- tests/v3-print-control-plane-service.test.ts

EXPIRE 事务从默认 5000ms 改为该路径独有的有界 10000ms；三次逐行 CAS 合为保留全部原谓词的一次批量 CAS，部分匹配立即整笔回滚，三笔终结和强制审计仍原子提交。没有自动重试、延长证据有效期、移动安全读取、修改 REVIEW 或一次性授权。没有 route、schema、migration、全局 Prisma、Desktop、订单、付款、收银、库存或打印执行改动。

Production 的证据只证明：Prisma 在 operationLog.create 处发现事务 5000ms 已过期、累计 5775ms；不能证明该 INSERT 自身耗时 5775ms。锁等待、数据库执行和网络往返的具体占比 UNKNOWN。隔离实测模拟同一审计边界证明旧预算回滚、新预算可提交，不能保证所有实际负载必定小于 10 秒。

## 真实验证结果

- 针对性测试：**124 PASS / 0 FAIL / 0 SKIP**，包含真实隔离 PostgreSQL 的旧超时复现、新预算、超限回滚、部分 CAS、审计失败、重复请求及并发执行保护。
- TypeScript：PASS。
- Build：PASS。初次隔离环境的 React 重复实例失败日志保留，仅修正 ignored node_modules 解析，无依赖或产品文件变更。
- Scope Guard：PASS；不替代冻结资产准入。
- CORE：**103 executed / 101 PASS / 2 FAIL / BLOCKED**。Cashier 守卫在可信 main PASS、本候选 FAIL，属于本候选新增的精确准入失败，不能冒充既有基线例外。customer-order-recovery 在两者均失败，属于同环境未拦截数据库读取的基线测试缺陷。原始失败、runner 分类和完整断言均保留；没有修改、跳过测试或宣称 CORE PASS。
- Claude 全新上下文独立 L3：**代码 PASS；发布/恢复 NOT READY**。审查绑定产品 SHA、完整 diff 和 48 份材料；无代码修改、Production 操作或共享实现者对话。完整结果见 L3-REVIEW-RESULT.md，原始 JSON、执行配置与前后校验在制品证据目录。非阻断冗余 scope 不另行改动。
- Release Lineage：**CONTENT_SUBSET PASS / STRICT ancestry NO**。Production 与 main 的这两个修复前文件逐字节一致，但不得直接发布整个 main 派生 tree，须从最新 Production 选择性组装最小精确差异。

## 尚未生效的补偿方案及精确门槛

ONE-TIME-COMPENSATION-SEALED-DRAFT.json 是 **未生效、未实现** 的设计，原成功 REVIEW 不被重置或删除。它绑定本店、本设备、三笔任务、原 REVIEW 审计及 payload hash、真实失败请求与日志 hash、stateVersion 696 / epoch 1 / release batch，以及原同一 ACTIVE SUPER_ADMIN。新增一次新鲜证据 REVIEW 必须有单独明确的有限期准入，且仍保留原身份、fence、单执行者、幂等和失败回滚规则。

Claude 指出的未闭合点：未来实现如何认证 Founder 对该精确补偿准入的批准。建议复用现行受审查、受保护发布的可信服务端政策：正式批准记录绑定 exact admissionId、作用域、审批证据摘要、有限期、实现内容 hash 与最终发布候选；发布验证器验证该绑定。运行时只信任已审查代码中的固定准入政策以及现有签名 SUPER_ADMIN 会话，不接收客户端提供的 approval JSON、聊天内容或可编辑文件作为授权，也不新增密钥或一般授权平台。此为待批准设计澄清，**不宣称已通过实现审查或可激活**。

仍需 Founder 作出精确决策：
- 批准上述仅本案的一次性补偿安全合同后，完成其最小实现与新鲜 L3 审查；当前超时候选不包含该能力。
- 按 Workflow V1 §6.1–6.2 / ES-ENG-001 正式冻结后继流程，为两个新内容 hash 取得精确准入；不能修改冻结断言或沿用旧 UX 例外。本轮只准备证据，未修改冻结资产、KTF、manifest 或 registry。
- 在以上闭合后，批准最终精确合并/选择性发布 SHA、Production 部署及实际恢复执行；本轮不部署、不执行恢复、不打印。

## 交付与归档

工作树：/private/tmp/es-diamond-v3-expire-timeout-recovery-01。原用户工作区修改保持不动。
证据归档：/Users/jason/light-ops-assistant/desktop/release/ES-DIAMOND-V3-EXPIRE-TIMEOUT-RECOVERY-01/candidate-ca7e04ec/。
Obsidian：/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/开发日志/2026-11-06 Diamond EXPIRE事务超时候选与业务连续性评估.md。
未误写项目仓库 05-开发记录。风险：高（L3 恢复控制面）；候选完成不代表门店打印恢复或 FIELD CLOSED。
