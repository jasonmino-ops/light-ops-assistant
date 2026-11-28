# 大东北堂食 B 第二次正式发布签认

FOUNDER_DECISION_UTC=2026-11-28T17:58:18.641Z

决定编号 ES-STD9E5497D-FIELD-STABILITY-01-B-CONTROL-02。Founder 消息 msg_01a2234e-d510-71c2-8ce3-e1d31ea3e970。对应签认单 SHA-256 59178bf63f24e98da2359468a07fc421b2f10471d8fcd0e449cf710eb600a6ec。

> Founder 批准 ES-STD9E5497D-FIELD-STABILITY-01-B 本次精确受控 Web 发布。
>
> 授权严格绑定：
>
> - Release：b7776e703a770ea78632d38ac652d0bad6e7379f
> - App 控制后继：84eeaeae11a5000656ee4b14c8c98dd4aa4095cb
> - 原投影：cf9b8881a344e64cad4c3f0deb3fe49daed98234
>
> 执行要求：
>
> 1. 核对最终精确签认单、当前可信 Production、Source、Release、控制后继及发布窗口。
> 2. 确认本次失败处置与独立审查证据一致。
> 3. 完成三文件正式登记及真实 main 准入。
> 4. 在新受保护运行 attempt 1 中完成 App 签发。
> 5. 全部 Source、Build、Scope、Lineage 和正式发布守卫通过后，执行本次限定范围的 Web Production 发布。
> 6. 任一检查失败、候选变化或发布窗口过期，立即停止，不得自行扩大授权。
>
> 发布范围仅包含 B 堂食性能优化。
>
> 禁止：
>
> - 修改或升级大东北现场 RC6。
> - 修改 Owner、Lease/Fence 或未决任务0017。
> - 修改其他商户数据。
> - 合并 A 打印修复。
> - 调整 C 区域配置。
> - 开展 Local First 架构开发。
> - 绕过或降低任何通用发布守卫。
>
> 发布后：
>
> 1. 核验 Production SHA、部署 READY 及实际路由。
> 2. 在大东北现场测量堂食桌台加载、开桌、账单读取及页面切换耗时。
> 3. 验证账单轮询不重叠、慢响应正常显示。
> 4. 核验跨桌台、跨商户及权限隔离。
> 5. 确认原有收银、订单和打印行为未退化。
>
> 最终报告实际性能改善、剩余瓶颈及是否达到第一阶段验收标准。
>
> 本授权仅在金边时间 2026-11-29 00:45 至 02:00（不含）有效。超出窗口不得执行。

## 本次授权对象

| 对象 | 精确值 |
| --- | --- |
| Release | b7776e703a770ea78632d38ac652d0bad6e7379f |
| Release tree | 9c8f840a84a765f11e0694a634cf3dc89d7a2cc0 |
| Source | 0829858d04c0ea7a2528ab19fc74293a0d7df0ff |
| 源码准入 main | 99ac06b0360fd77739b80558c1c32d4f4c677cb5 |
| 现行登记 main | 0054f65a2785e1f7536c71ee4612f4af23ef7a7b |
| 现行控制父 | 6bb804ba5918e06bc24576525c27de6f92a24ec6 |
| 新控制提交 | 84eeaeae11a5000656ee4b14c8c98dd4aa4095cb |
| 新控制 tree | 34b7daee1b6546579da61aedfdd3cf2c8eb48f90 |
| 测试投影 | cf9b8881a344e64cad4c3f0deb3fe49daed98234 |
| 投影分支 | refs/heads/codex/es-std9-b-projection-evidence |
| 生产基线 | 65a23a780d16d607a0f8f818289e96c886eb1a60 |
| 生产与限定 Web 回退部署 | dpl_EraxN49WoWBSJfKKMJL3ecFPMfNk |
| 控制 manifest SHA-256 | 9d96feec9a01da32dae1d184fb075b5173a0c531c56b5472f079a332f6d3de69 |
| 四文件控制摘要 | a727460452099dfec414d01d3b72b8f92e4bf05f3034dcf6eda9f16c61adbafe |
| 未变技术包 SHA-256 | 3e8caba088995aac93da8809d78860814cb5db36f1846faaa6121b2bf7fb4f06 |
| 范围载荷 SHA-256 | 8b6986a770e0d132447ff9aa77ff7f19f2bbcbf19fde42ee841ded99bf377abf |
| 失败处置 SHA-256 | 1dd5922bbcf578e8b2bc744280a1c49d2daddc00472e570c119c446ba69532a1 |
| 覆盖证明 SHA-256 | e9d94d59346dea2e3c9743f29c6a3da40146ec89e98846c7ee258b797b38d78d |
| 窗口开始 UTC（含） | 2026-11-28T17:45:00.000Z |
| 窗口结束 UTC（不含） | 2026-11-28T19:00:00.000Z |

对应金边时间为 2026-11-29 00:45 至 02:00，期限 4500 秒。个人批准、App 回读与快进均须在窗口内。超时、撤销或任何绑定漂移即停。

## 本次决定

批准精确堂食性能登记、一次App签发及受保护release快进部署，并仅接受上表相同输入和未到期的精确失败处置。此次源映射、3 文件范围及 Web 共享页面暴露与原 B 相同。原投影 24 项通过及 Build 日志按相同完整树复用。原完整 CORE/Integration 结果保留 RAW BLOCKED。历史原始运行分别为 main 102/105、release 100/104、Integration 19/22。原登记后的 513 对 5 断言仍保留原始失败，登记后必须再次读取真实结果。

## 执行顺序

1. 记录本轮真实 Founder 答复和时间，回读 main、release、控制分支、证据分支、候选、域名、规则集及受保护环境。核验原运行 46170397637 attempt 1 在签发前结束，B 的签发状态数为 0。
2. 从 0054f65a 的直接子提交登记本次正式发布单、本人回执和新独审。证据包原 blob 保留。将回执中唯一的 FOUNDER_DECISION_UTC 行绑定本次实际时间；签认后才填写授权 ID 对应的批准状态、时间、回执哈希与受控权限。回读三文件、完整树及历史记录。
3. 在真实 Release checkout 与最新 origin/main 上复核原 cashier 断言，仅允许已绑定的 513 条路径摘要和原失败，遇到新增、改变或恢复的结果即停。运行正式选择性校验并核对 Source 到 Release 的完整映射。
4. 仅普通快进控制分支 6bb804ba → 84eeaeae。让该 push 产生一个新 run ID、attempt 1。在正式 GitHub 环境完成 preflight 与一次 App 状态签发，回读原 POST ID、App 身份、有效期、发布单摘要及唯一状态；未知结果即停。
5. 所有守卫和健康检查有效才可普通快进 release 65a23a78 → b7776e70，由现有 Git 集成发布 Web。回读实际 SHA、项目、域名与页面健康。若发布健康回归且本单获完整批准，Web alias 回退仅限原部署并回读。
6. 保留原版 RC6 和打印、Owner、0017。迁移数为 0。后续仅在门店空闲时做本店只读现场性能验证。

登记时 App 签发及现场性能验收仍待执行。
