# ES-NATIVE-INVENTORY-V1 M1 运行角色冻结后继

Founder 签认的完整文件为 `ES-NATIVE-INVENTORY-V1-M1-RUNTIME-SIGNATURE.json`，SHA-256 `ecfe94be4744bf4ec0ea8751d51cb4cd5d630b1f8ee7be25be79894b098c83eb`。业务补丁 SHA-256 为 `c71e0210a4c6f9b4f8ab97112dd6ff4c1e573326b9665f5de7d39e44b541b54c`。范围限既有开发分支和非生产验收。

独立代码复审由 `m1_runtime_fix_review` 完成。受限角色真实 HTTP 核验商品新增、编辑、查询、V3 控制面租约、跨门店和堂食恢复。堂食权限故障返回未知，已授权门店仍可进入恢复页。支付、库存与打印的原子性和状态断言沿用原冻结合同。原业务授权的 14 个 Scope 路径仅替换 Cashier 哈希并新增一项迁移。治理提交限签认、登记、执行器及执行器的回归证据。

新执行器绑定签认原文、真实前置 main、原业务提交、登记文件、集成父链、精确产品补丁、工作树与未改动的 Scope Guard。旧执行器路径与原始登记保留。独立的 Windows 通用发布冻结问题继续 FAIL，目标部署身份、旧 ACL 及 Windows FIELD 仍待正式发布前核验。
