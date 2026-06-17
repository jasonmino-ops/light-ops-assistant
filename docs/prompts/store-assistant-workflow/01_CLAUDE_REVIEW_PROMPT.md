# Claude 审查 Prompt｜店小二项目

任务名称：<填写任务名>

这是店小二项目的架构 / 风险审查任务，不是开发任务。

请先阅读以下资料后再审查：

- Obsidian 当前开发记录：<填写路径>
- 项目相关文档：<填写 docs 路径>
- 相关代码文件：<填写文件>
- Prisma schema / migration（如涉及数据库）

审查目标：

1. 判断本任务是否适合进入 Codex 小步开发。
2. 明确风险等级：P0 / P1 / P2 / P3。
3. 明确必须保护的链路。
4. 明确是否涉及数据库、migration、权限、支付、会员余额、Telegram、离线同步、records/dashboard 口径。
5. 给出可执行的收口建议。

必须重点检查：

- 是否会影响 CASH / KHQR
- 是否会影响 /sale
- 是否会影响 /cashier
- 是否会影响 /records
- 是否会影响 Dashboard
- 是否会影响 OfflineSaleSyncMap
- 是否会影响 Telegram auth / session
- 是否会影响顾客 H5 /menu
- 是否需要 production migration
- 是否需要 Browser smoke / 真机测试

禁止：

- 不要直接大改代码。
- 不要扩展功能范围。
- 不要把 P2/P3 想法混进本轮。
- 不要建议全量重构，除非说明必须暂停当前任务。

请按以下格式输出：

1. 审查结论
2. 风险等级
3. 是否允许进入 Codex 小步开发
4. 必须保护的链路
5. 数据库 / migration 风险
6. API / 权限风险
7. 前端 / 真机风险
8. 必须暂停并汇报的条件
9. 建议 Codex 本轮最小修改范围
10. 验收建议
