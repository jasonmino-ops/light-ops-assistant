# ES-NATIVE-INVENTORY-V1 销售上线候选 · 独立冻结签认

签认人：Claude（新上下文，只读，未参与本候选实施）。日期：2026-11-15。
签认类型：精确候选绑定与冻结后继治理签认。业务代码复审沿用既有独立复核结论，本次未重复审查。

## 绑定对象

| 项 | 值 |
| --- | --- |
| 可信 origin/main（GitHub 实时读回） | `24528f1e346b2c83913bdfa0a841b5e0ca6a6fd4` |
| origin/release（实时读回，等于 Production SHA） | `1f33d03bcba0bc5d2173be7afe0e3cb0694345c8` |
| 候选 Tree | `50ee7db6f640d9a7cc6b22e81280769faae1d4fa` |
| 候选补丁 SHA-256 | `18728415d76510b19ed18f570463d2e9985547cac61d6cd64e33061b480811aa` |
| 签认包 `release-approval.tar.gz` SHA-256 | `16ad90a3771d07846cfce7d888b8b2f23a3746b487e99a8cd7be147d28834bfd` |
| Founder 授权来源 | 2026-11-15 14:30（UTC+8）指令，点名上述 Tree 与签认包 |

## 本人实际执行并通过的核验

1. 在独立环境从 GitHub 取回 `24528f1e`，应用候选补丁后 `git write-tree` 得到 `50ee7db6…`，与 Founder 指定 Tree 一致。
2. 候选相对可信 main 的差异恰为 11 个路径，无额外文件；11 个路径的 SHA-256 与 `candidate-paths.sha256` 全部一致。
3. 签认包内 12 份证据与 `evidence.sha256` 全部一致，压缩包内容与 `approval/` 目录一致。
4. 3 个冻结路径与 `prisma/schema.prisma` 的前值哈希与可信 main 实际字节一致。
5. Scope Guard 命中恰为 2 个路径：`prisma/schema.prisma`、`prisma/migrations/20261115120000_separate_native_inventory_sales/migration.sql`。其余 9 个 ALLOWED。
6. 冻结路径差异已阅读，仅用于确认签认内容：两个原生进销存路由各增加 `NATIVE_INVENTORY_ENABLED` 关闭判断；H5 下单路由恢复生产 v1 提交身份哈希，兼容带币种的旧重放，并且仅在开关开启时调用 `native_inventory.pin_sales_epoch`。开关关闭时 H5 不访问新 schema。

## 沿用而未重跑的证据（仅核对哈希）

Build PASS、79 项迁移隔离库 PASS、rollout 测试 PASS、dark 运行态 PASS、CONTENT_SUBSET Lineage PASS。`unpinned-negative.log` 为预期失败的反向对照，原始状态 FAIL，不计为 PASS。

## 未取得或未通过

- 既有"独立复核通过"的原始审查记录不在签认包内，只有 `approval-request.json` 中的陈述。登记时须由 Codex 附上该记录或其哈希。
- `frozen.log` 与 `scope.log` 当前为 BLOCKED，属预期，登记后须在最终候选提交上重跑。
- 候选 Cloud CI：NOT_RUN。前驱 `8a010194` 的 run 43444780948 只对前驱有效。
- 生产 Prisma TLS P1011、运行角色缺失、PITR 未启用且完整恢复未验证：均为生产前置，不属本签认范围。

## 结论

对上述精确候选，签认其作为 3 个冻结路径的精确 Frozen Successor 及 2 个 Prisma 路径的精确 Scope 例外登记对象，范围限开发分支提交、推送与 Cloud CI。字节、补丁或可信 main 任一变化，本签认失效。

不覆盖：Production 部署、Production 迁移、门店启用、Diamond Sheets 变更、L3 PASS、FIELD VERIFIED、CLOSED。

## 生产顺序约束

`NATIVE_INVENTORY_ENABLED=true` 之前必须先完成迁移 `20261115120000`。顺序颠倒时，H5 下单事务会调用不存在的函数而失败。
