# Codex 文档化任务 Prompt｜店小二项目

任务名称：<填写任务名>

这是文档化任务，不是功能开发任务。

本轮只允许：

- 新增指定文档
- 更新指定文档
- 更新 Obsidian 指定记录

本轮禁止：

- 不改业务代码
- 不改数据库
- 不改配置
- 不创建 migration
- 不运行 migration
- 不改 /cashier / /sale / /records / Dashboard / OfflineSaleSyncMap
- 不扩展功能

需要新增 / 修改：

- <文档路径 1>
- <文档路径 2>

文档要求：

- 用中文
- 写成项目内部 SOP / 记录，不写泛泛教程
- 明确当前项目真实状态
- 明确适用范围、边界、禁止事项、后续建议

执行：

```bash
git status
# 如无文档 lint，说明未执行原因
git add <docs>
git commit -m "docs: <message>"
git push origin main
```

Obsidian：

如属于开发记录 / 冻结 / SOP，必须同步真实 Vault。

最终回报：

1. 文档化结论
2. 新增/修改文件
3. 是否改业务代码：否
4. 是否改数据库：否
5. 是否执行 migration：否
6. 检查结果
7. commit hash
8. push 结果
9. Obsidian 是否同步
10. Obsidian 文件路径 / 记录标题
