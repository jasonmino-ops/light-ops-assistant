# Dev-Gate-01A 冻结记录

## 冻结结论

Dev-Gate-01A 最小可用路径越界检查护栏已完成，可正式冻结并作为后续店小二 Codex Batch 的默认手动护栏。

## 冻结性质

工具类冻结，非业务功能冻结。不改变线上业务逻辑，不影响商户端、顾客端、收银端、支付、会员、打印、SaleRecord 写入。

## 冻结范围

- `docs/change-gates/gate-config.json`，commit: `78db97b`
- `docs/change-gates/dev-gate-01a-change-scope-guard.md`，commit: `78db97b`
- `scripts/guards/check-change-scope.js`，commit: `2e3b284`

## 已完成能力

- 从 `docs/change-gates/gate-config.json` 读取 `forbidden_paths`
- 支持 `–files "<逗号分隔路径>"` 参数
- 支持 `forbidden_paths.absolute` 的精确文件匹配与目录前缀匹配
- 支持 `forbidden_paths.glob_patterns` 中 `/**` 与 `/` 结尾规则
- `PASS` 输出，exit code 0
- `BLOCKED` 输出，exit code 1，并显示命中规则
- 参数缺失或配置错误输出 `ERROR`，exit code 2
- 纯 Node.js 只读脚本
- 不读被检查文件内容
- 不写文件
- 不联网
- 不访问 secret/auth/session
- 不调用 provider
- 不执行 git/prisma/build

## 已保护主链

- `/menu` 顾客下单主链：`app/menu`
- `/cashier` 收银主链：`app/cashier/page.tsx`
- `/desktop/pos` 电脑端 POS：当前复用 cashier 主逻辑，由 `app/cashier/page.tsx` 覆盖
- `/sale` 销售页：`app/sale/page.tsx`
- `/records` 销售记录：`app/records`
- `app/api/cashier`
- `app/api/members`
- `app/api/sales`
- `app/api/orders`
- `app/api/print/**`
- `prisma/schema.prisma`
- `prisma/migrations/`
- `lib/cloudPrinter.ts`
- `lib/session.ts`
- `lib/context.ts`
- `middleware.ts`

## 后续每个 Codex Batch 推荐使用方式

1. 取得本轮修改文件列表：

```bash
git diff –name-only HEAD
```

2. 将文件列表手动传入护栏脚本：

```bash
node scripts/guards/check-change-scope.js –files "<文件列表，逗号分隔>"
```

3. 如果输出 `PASS`，才继续执行 build / commit / push。
4. 如果输出 `BLOCKED`，必须停止提交并回报命中的 `forbidden_paths`。
5. 该护栏不替代 `npm run build`、人工 review、Browser 验收、真机验收、Obsidian 冻结记录。

## 未做内容

以下内容后续 Batch3+ 再考虑：

- 关键词扫描
- npm script 集成
- git hook 集成
- shell wrapper
- 自动从 git diff 读取文件列表

## 风险提醒

1. `prisma/migrations/` 与 `app/api/print/**` 在配置中格式不完全统一，但当前脚本均可识别，属于低优先级清理项。
2. `app/cashier/page.tsx` 是精确文件保护，如果未来 cashier 拆分目录文件，应扩展为 `app/cashier`。
3. `lib/` 下当前只保护 `cloudPrinter`、`session`、`context` 三个核心文件，其余 lib 文件如需保护应按需扩充 `forbidden_paths`。
4. `allowed_paths` 不是强白名单；当前规则是命中 `forbidden_paths` 即 `BLOCKED`，否则 `PASS`。

## 冻结后规则

Dev-Gate-01A Batch1 + Batch2 的既有文件不再追加修改。后续若要扩展关键词扫描、npm script、git hook 或配置清理，应另开 Dev-Gate-01A Batch3+ 或 Dev-Gate-01B。

## 建议归档

Obsidian 建议归档到：

`03-冻结文档/02-冻结过程资料`

分类：

冻结文档
