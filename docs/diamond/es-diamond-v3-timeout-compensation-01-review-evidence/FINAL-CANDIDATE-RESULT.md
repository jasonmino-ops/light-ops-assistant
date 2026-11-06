# 2026-11-06 Diamond 一次性 EXPIRE 超时补偿候选收口

## 结果

**L3 产品候选实现与审查完成；尚未发布或执行真实恢复。**

- 产品 Candidate：b558dcd197f166936610b5c7c140c0acb5f55a86。
- 保留前序超时修复 ca7e04ec9d600e568d29258f1e0dc9879c96a72c 的 EXPIRE10秒、合并 CAS、原子审计，相关函数/代码段逐字节不变。
- 本地选择性发布候选：1427131e94aba6a19c52dee61f531fec2c9213b3；完整 tree178bfec6bb55616c7f0c02e16422f413c6149e0d；Production9e717439... 为父基线，两个精确 cherry-pick -x 映射 ca7e04ec→77c5f55e、b558dcd1→1427131e，只差两个产品文件，无其他 main/Desktop 代码。
- 最终治理 HEAD 及逐项归档哈希见持久化证据 FINAL-VERIFICATION.json，避免文档自引用 SHA 循环。source/release工作树均干净；原用户工作区修改未覆盖。

## 精确改动

产品仅：
1. app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts
2. tests/v3-print-control-plane-service.test.ts

新增两个专用补偿动作，复用现有受认证、同源、明确确认的 Ops POST，不增加 endpoint、权限、schema、migration、依赖、环境变量或 UI。仅限本案 tenant/Store/Device/三任务、原审计和原 ACTIVE SUPER_ADMIN、Version696/epoch1/released batch/time；原成功审计的稳定公开语义投影与原/新 Installation HMAC 等值关系均核验。旧一次性授权不重置、不删除，失败 EXPIRE 证明作为受审查源码固定绑定，不伪造失败审计。

新 REVIEW 必须使用回滚后重新采集且满足原30秒接收／5分钟有效期的 Windows 证据；只追加一份资格审计，成功后永久消耗本案重新取得资格的机会。独立的新 EXPIRE 只消费这份资格；仍要求全部身份、fence、Owner/Lease/batch、未 claim/未执行/非UNKNOWN、原始TTL和同一任务身份，三笔更新与审计原子提交。重放只返回原已提交结果，不续期/再消费。事务失败回滚后必须先读审计，再遵循原幂等规则，不盲目新建请求。

新增技术证据目录 docs/diamond/es-diamond-v3-timeout-compensation-01-review-evidence/；全部精确文件列表见 CANDIDATE-MANIFEST.json 的 exactChangedPaths。

两份具体冻结材料已创建，均 **SEALED DRAFT / NOT ACTIVE**：
- docs/freezes/ES-DIAMOND-V3-EXPIRE-TIMEOUT-COMPENSATION-01.md
- docs/change-gates/ES-DIAMOND-V3-EXPIRE-TIMEOUT-RECOVERY-01 CORE Admission Disposition.md

两份草案分别 SHA256：75d1a76f300357bb2ee597323a491778ac25219ae332569ab03180b97fac1842；341d1284b727a664785826008931a0b70519e54586d0f8f8f5c3c3a0f4d4fa13。未修改任何既有冻结测试、断言、KTF、manifest、registry、Owner/Lease/Fence、Desktop、Provider、FRONT/KITCHEN 路由、订单、收银、付款或库存。

## 验证及独立审查

- 主候选针对性9文件：142 PASS /0 FAIL /0 SKIP，含真实隔离 PostgreSQL：旧5秒超时复现、新10秒、超限/审计失败/部分CAS回滚、补偿重放、同/异请求并发、过期、身份与fence不符、原审计缺失/篡改、UNKNOWN拒绝等。REVIEW没有任务写入；held哨兵、账单数和控制面不变。
- TypeScript PASS；Build PASS；Scope Guard PASS。
- Production父tree的同142项测试及 Build PASS，实际运行于初始 df0fa833...；随后仅修正 Git 历史为正式两次 -x 映射，完整tree逐字节一致。没有把旧命令伪称在新 SHA 重跑；独立L3已确认此复用合理。
- CORE：103 executed /101 PASS /2 FAIL /0 SKIP /BLOCKED。可信 main 的 Cashier 守卫 PASS，本合集 FAIL，为本任务特定准入失败，不能继承旧例外；customer-order-recovery 四个失败在可信 main 同环境重现。原始失败和 runner newFailures2 保留，不改KTF、不跳过、不宣称CORE PASS。
- Claude 全新上下文 L3：产品代码 PASS，绑定 b558dcd1 及发布1427131e/tree178bfec6；原审计投影、身份、单次资格、并发和回滚均通过。发布／恢复仍 NOT READY。
- Claude 另一次全新上下文限定审查：两份具体冻结草案准备 PASS，**不代表批准或激活**。缺少原始基线日志的非阻断意见已通过补充附件及四项断言精确比较闭合；两份受审查草案哈希不变。
- Lineage：CONTENT_SUBSET PASS；STRICT ancestry NO。收口只读远端核对 main仍c1041533、release仍9e717439。未运行/未声称 AUTHORIZED_SELECTIVE_RELEASE 或新 required App check。

## 仅剩的正式 Gate

按 Workflow V1 §6.1–6.2 / ES-ENG-001：Founder 精确批准两份上述冻结后继／限定CORE处置内容（当前草案不会放行任何东西），再授权合并对应产品与治理材料。之后依据实际合并 main 生成九字段选择性记录、新候选绑定 App required check，取得精确 Production 发布及真实恢复执行授权。当前两个产品来源尚未进入main，不能提前发布或复用PR31旧SUCCESS。

准入窗口固定在 **2026-11-08T00:00:00.000Z（UTC）截止**，不自动延期。迟于截止、绑定/失败/源码/父版本/tree漂移或新增失败，都必须停止并重新精确处理，不静默扩展。

本轮未 merge、push、部署Preview/Production、迁移、执行真实 REVIEW/EXPIRE/FINALIZE、修改 held 或触发打印。未操作 Diamond Windows。真实恢复前须刷新控制面、身份和原始三任务／全部合法积压状态并采集新证据；后续 FINALIZE、单 Owner、实际ACK及实体出纸仍须现场验收。既有 Provider 不重做，FRONT实际配置未知不冒充TCP验证。

## 归档

持久化证据：/Users/jason/light-ops-assistant/desktop/release/ES-DIAMOND-V3-EXPIRE-TIMEOUT-RECOVERY-01/compensation-b558dcd1/。
真实 Vault：/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/开发日志/2026-11-06 Diamond 一次性超时补偿候选开发与L3审查.md。
风险：高（L3）。这是候选验收记录/开发日志/Bug案例，不是 Production 或 FIELD VERIFIED/CLOSED。未误写项目仓库05-开发记录。
