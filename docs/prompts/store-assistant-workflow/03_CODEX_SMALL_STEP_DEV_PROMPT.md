# Codex 小步开发 Prompt｜店小二项目

任务名称：<填写任务名>

这是小补丁 / 小步开发任务，不是架构任务，不是全量重构任务。

当前背景：

<说明当前线上状态、已冻结模块、相关 commit>

本轮目标：

<一句话说明>

允许修改：

- <文件/目录>

禁止修改：

- /sale，除非本轮明确要求
- /cashier 主链路，除非本轮明确要求
- /records 业务口径
- Dashboard
- OfflineSaleSyncMap
- CASH / KHQR 主链路
- Telegram auth / session
- 数据库 schema，除非本轮明确要求

执行要求：

1. 先 grep / 查看相关代码。
2. 不要长时间 architecting。
3. 不要全量重构。
4. 最多修改必要文件。
5. 如果发现需要大改，先停止并汇报。
6. 不要顺手扩功能。
7. 不要创建真实订单、真实支付、真实大额数据。
8. 完成后运行：

```bash
npx prisma generate # 如涉及 schema
npm run build
npm run test:smoke:prod # 如涉及关键页面
```

如涉及 migration：

- 创建 migration
- commit / push / Vercel READY 后执行 production migration
- 复查 migrate status
- 验证 API 不出现 P2021 / P2022

Obsidian：

完成后必须追加真实 Vault 开发记录，写明修改结论、文件、build/test、commit、风险和结果。

最终回报：

1. 修改结论
2. 修改文件
3. 是否改数据库
4. 是否改业务逻辑
5. build 结果
6. smoke 结果
7. commit hash
8. git status
9. 是否 push
10. Vercel Production commit
11. Deployment State
12. Obsidian 是否同步
13. 我需要验证哪几个点
