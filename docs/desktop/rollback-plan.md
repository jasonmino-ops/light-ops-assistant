# E-Shop Desktop — Rollback Plan（Milestone A）

## 影响面分析

Milestone A 对现有 SaaS 的全部改动：

| 改动 | 类型 | 风险 |
|---|---|---|
| `desktop/` 全新目录 | 新增 | 零（Vercel 构建不涉及） |
| `docs/desktop/` 文档 | 新增 | 零 |
| `.github/workflows/desktop-windows-build.yml` | 新增 | 零（仅 GitHub CI，且 path 过滤只在 desktop/** 变更时触发） |
| 根 `tsconfig.json` exclude 增加 `"desktop"` | 修改 1 行 | 极低（缩小类型检查范围，不影响既有编译） |

未修改任何冻结文件、任何 `app/**`、`lib/**`、`prisma/**`、API、支付、打印、授权链路。浏览器版 POS 完全不受 Desktop 存在与否影响，可随时独立运行。

## 回滚步骤

### 级别 1 — 门店侧停用（不动代码）
卸载 E-Shop Desktop（控制面板 → 卸载），回到 Chrome 打开 `/desktop/pos` 与 `/desktop/display` 的浏览器双开方案。用户数据目录 `%APPDATA%\eshop-desktop` 可手动删除。

### 级别 2 — 仓库整体回滚
```bash
# 逐 commit 回滚（Milestone A commit 列表见 milestone-a-implementation-record.md）
git revert <commit>...
# 或一次性删除：
git rm -r desktop docs/desktop .github/workflows/desktop-windows-build.yml
git checkout HEAD~N -- tsconfig.json   # 恢复 exclude 行
```

### 级别 3 — 仅回滚根 tsconfig
`tsconfig.json` exclude 恢复为 `["node_modules"]`（此时需同时移除 desktop 目录，否则 Next 类型检查会扫入 Electron 代码报错）。

## 回滚验证清单
1. `npm run build`（Web Build 通过）
2. Chrome 验证 `/desktop/pos`、`/desktop/display` 双开同步
3. `node scripts/guards/check-change-scope.js`（Dev-Gate-01A 通过）
