# Production Migration Prompt｜店小二项目

任务名称：<填写任务名>

这是生产数据库 migration 执行与验证任务，不是功能开发任务。

本轮只允许：

- 执行已存在 migration
- 验证生产数据库结构
- 记录 Obsidian

禁止：

- 不改代码
- 不改 schema
- 不新增 migration
- 不 reset
- 不 db push
- 不 drop 表
- 不手工改生产数据

允许执行 production migration 的前置条件：

1. migration 文件已存在并已 commit。
2. origin/main 包含目标 commit。
3. Vercel Production 已部署目标 commit，或用户明确要求先迁移。
4. 当前 DATABASE_URL / DIRECT_URL 已确认：
   - DATABASE_URL = 6543 pooler
   - DIRECT_URL = 5432 direct
5. 已确认 migration 文件路径。
6. 已确认没有 failed migration。
7. 如新增唯一约束，已检查生产数据无冲突。

执行命令：

```bash
npm run migrate:prod
DATABASE_URL=$DIRECT_URL npx prisma migrate status
```

执行后必须验证：

- migration 已 applied
- no pending migration
- no failed migration
- 新表存在
- 新字段存在
- 唯一约束存在
- 相关 API 不再 P2021 / P2022
- 关键页面 smoke 不失败

失败时：

- 立即停止
- 不要 reset
- 不要 db push
- 不要手工修表
- 回报错误信息和当前状态

最终回报：

1. migration 执行结论
2. 执行的 migration 名称
3. migrate deploy 结果
4. migrate status 结果
5. 新表/字段/索引验证结果
6. 是否有 pending / failed migration
7. API smoke 结果
8. 是否改代码：否
9. 是否新增 migration：否
10. 是否可以继续下一阶段
