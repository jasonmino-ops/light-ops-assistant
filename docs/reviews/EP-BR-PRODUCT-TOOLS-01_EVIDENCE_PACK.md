# EP-BR-PRODUCT-TOOLS-01 独立审查证据包

日期：2026-07-22
正式基线：`3e9280bf97c8bc3ccb9d290fab12160b85e63df5`（EP-BR-SEC-01 FINAL FROZEN）
原审查提交：`aefceb82d4c8ca24726d55a583dc16108544de70`

## 范围

本工程包只扩展商品工具：模板、导出、完整备份、第三方表格导入、AI 列映射辅助和事务化确认导入。

未修改支付、订单、销售记录、认证实现或 Prisma schema。

## 设计证据

| 能力 | 实现位置 | 审查要点 |
|---|---|---|
| 标准模板 | `app/api/products/import/route.ts`、`lib/product-spreadsheet.ts` | Owner 授权；下载内容可再次导入；支持多图列 |
| Excel 导出 | `app/api/products/export/route.ts`、`lib/product-backup.ts` | 按 tenant 查询；包含条码、SKU、多语言名称描述、价格、状态、分类和图片引用 |
| ZIP 备份 | `app/api/products/backup/route.ts`、`lib/product-backup.ts` | ZIP 包含 `products.xlsx`、`manifest.json` 与本系统 Supabase Storage 受控图片 |
| CSV/XLS/XLSX 解析 | `lib/product-spreadsheet.ts` | 前 20 行自动找表头，支持中英高棉常见别名、任意字段顺序和手动映射 |
| AI 列识别 | `app/api/products/import-ai/analyze/route.ts`、`lib/ai-product-column-mapping.ts` | 只发送表头和最多 8 行样例；只返回建议映射；不写数据库；不可用时可手动继续 |
| 导入写入 | `app/api/products/import/confirm/route.ts` | Owner、tenant 过滤、服务端复核、重复默认跳过、显式更新、单事务回滚 |
| CI | `.github/workflows/cloud-ci.yml` | 商品路径变更触发；执行产品工具测试、Prisma、类型检查和构建 |

## 集中修复证据

| 审查问题 | 修复 | 可复核证据 |
|---|---|---|
| 模板下载存在平行 P1 入口 | 已移除无远端、干净的本地 `feat/ep-br-product-tools-01-p1` worktree/分支；`feat/ep-br-product-tools-01` 是唯一入口 | `git branch -a --list '*ep-br-product-tools-01*'` 仅返回完整 EP 分支及其远端 |
| 超过 500 行会静默截断 | 解析与确认共用 `MAX_PRODUCT_IMPORT_ROWS = 2_000`；501 行完整预览，超过 2,000 行返回 `TOO_MANY_ROWS`，没有截断路径 | `tests/product-tools.test.ts` 的 501 与 2,001 行测试 |
| UPDATE 会清空未映射字段 | 预览携带 `providedFields`；确认端通过 `buildProductImportUpdate()` 只构造已映射字段的 Prisma 更新补丁 | 更新补丁测试断言仅映射售价时只写入 `sellPrice` |
| 重复项逐条处理成本高 | 预览增加“全部重复项：跳过 / 更新”操作；服务端仍逐行复核 Owner、tenant 与显式动作 | `app/products/page.tsx`、`app/api/products/import/confirm/route.ts` |
| ZIP 可占用无限资源 | 备份上限：5,000 商品、2,000 张受控图片、单图 5MB、受控图片总计 100MB；超限返回 413，不生成不完整包 | `PRODUCT_BACKUP_LIMITS` 和限额单元测试 |
| 新增导入工具文本不完整本地化 | 导出、备份、映射、AI 降级、批量重复操作、预览和结果文案均写入 `zh.ts`、`en.ts`、`km.ts` | 三语键完整性测试 |

## 图片备份边界

- `Product.imageStorageKey` / `imageStorageKeys` 对应的 `product-images` 对象会实际写入 ZIP。
- 外部图片 URL 不由服务端抓取，以避免把商品导入接口变成 SSRF 出口；原始 URL 会保留在 Excel 和 `manifest.json` 中以支持重新导入和人工恢复。
- 受控图片读取任一失败时，接口不返回不完整 ZIP，而是失败并允许重试。
- 对应当前非流式对象存储读取实现，ZIP 还限制为最多 5,000 商品、2,000 张受控图片、单图 5MB、图片总计 100MB；超过限制以 `413` 明确拒绝，避免无上限内存占用。

## 验证记录

在隔离 worktree 中、使用无效本地占位 `DATABASE_URL` 仅生成 Prisma Client（不连接数据库）后执行：

```bash
npm run test:product-tools
npx tsc --noEmit --incremental false
npm run build
```

结果：全部通过。

`tests/product-tools.test.ts` 覆盖：

- 自动识别第三方表头、表头前说明行和多图列；
- 人工映射未知表头；
- 501 行完整预览、超过 2,000 行显式拒绝；
- 仅映射字段的 UPDATE 补丁，以及映射图片列时的显式清空；
- 模板和导出工作簿字段；
- ZIP 文件结构与备份资源限制；
- 商品工具新增文案在中文、英文、柬文中的完整性；
- 确认导入使用事务与重复动作保护。

## 独立审查建议

1. 使用 Owner、Staff、过期会话分别验证三类下载和导入接口。
2. 用真实 `.xlsx`、`.xls`、`.csv` 及 Telegram WebApp 下载场景验收客户端行为。
3. 在临时数据库执行新增、重复批量跳过、批量显式更新、只映射单字段更新、故障回滚五种导入场景。
4. 在配置 Supabase Storage 的预览环境下载 ZIP，确认 `manifest.json` 与 `images/` 内容一致。
5. 配置和未配置 `ANTHROPIC_API_KEY` 各验证一次，确认 AI 失败不阻断手动映射。
