# ChatGPT 收口 Prompt｜店小二项目

任务名称：<填写任务名>

请基于用户目标、Claude 审查结果和当前项目状态，把需求收口成 Codex 可直接执行的小步任务。

当前背景：

- 当前线上 commit：<填写>
- 当前已完成模块：<填写>
- 当前冻结模块：<填写>
- Claude 审查结论：<粘贴摘要>

本轮目标：

<明确一句话目标>

本轮只做：

1. <范围 1>
2. <范围 2>
3. <范围 3>

本轮明确不做：

- 不改 CASH / KHQR
- 不改 /sale
- 不改 /cashier 主链路
- 不改 /records 业务口径
- 不改 Dashboard
- 不改 OfflineSaleSyncMap
- 不扩展 P2/P3 功能

修改范围：

- 允许修改：<文件/目录>
- 禁止修改：<文件/目录>

执行要求：

- 优先 grep 精准定位
- 不做全量重构
- 如果发现需要大改，先停止并汇报
- 如涉及 schema，必须生成 migration
- 如涉及 production migration，必须单独执行并验证
- 完成后必须 build/test/smoke
- 必须同步 Obsidian

验收点：

1. <验收点>
2. <验收点>
3. <验收点>

执行命令：

```bash
npx prisma generate # 如涉及 schema
npm run build
npm run test:smoke:prod # 如涉及关键页面
```

最终回报格式：

1. 修改结论
2. 修改文件
3. 是否改数据库
4. migration 名称 / 状态
5. 是否改业务逻辑
6. build 结果
7. smoke 结果
8. commit hash
9. 是否 push
10. Vercel Production commit
11. Deployment State
12. Obsidian 是否同步
13. 需要验证的点
