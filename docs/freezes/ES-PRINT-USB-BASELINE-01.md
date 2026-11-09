# ES-PRINT-USB-BASELINE-01 exact frozen successor

Status SEALED DRAFT / INACTIVE. Authority is Workflow V1 §§3.4, 6.1–6.2, Workflow V2 §6, ES-ENG-001 and Design Freeze V1.4 §6 ESC-2. Applies once to the Product Candidate `c50bd967c59452b3ecae602f0624dccf10244127`, tree `29b8f14b504296f8817d3a7130135c6f32c34071`, against trusted main `aa5ac043788651062c681a23a3303a0438092ddb`. It expires on any mismatch, failed required check outside the recorded failure identity, superseding candidate or closure of this candidate disposition.

## Exact CORE path disposition

The only candidate-only failure covered is the exact unexpected-path list at `assertBoundary`, line 283 of `tests/cashier-realtime-integration.test.ts`, with test SHA-256 `d10fd1cf16c1c9b142ca76742e31a5928ba514384c4a347fea5d7630bb0bc3b8`. The approved effect is recognizing that exact admission-list failure as eligible for a task-scoped disposition only after formal registration. Retain the original raw failure and all frozen assertions. This is a governance record, not an executable patch. An executable successor, if necessary for raw CORE parity, requires a separately sealed exact diff under this scope, independent review and a full canonical rerun. Baseline drift, extra changed paths, any changed content hash, extra failed assertions, changed test identity or missing required results make this disposition inapplicable.

| Path | Candidate SHA-256 |
| --- | --- |
| `desktop/src/main/printing/localEndpointAuthority.ts` | `8c24471f4cd17b0a83f546b66b1537f13b7561210c2e21626b5bbdaad8dcbb95` |
| `desktop/src/main/printing/v3PrintingRuntime.ts` | `26563e5a7fce240213fd97bc2ed05e5c8b8eb2a8c2ecab5882c18f8eca8f687c` |
| `desktop/src/main/printing/windowsUsbEndpoint.ts` | `f782cbb9715f7575f1126961c82352070365c0ab515792a4882a7e2632a59d10` |
| `desktop/src/main/printing/windowsUsbFrontTest.ts` | `dc9c286b062ba500712b41c7eb868b3812d81957e70ae3910a87478b23b60e2c` |
| `desktop/src/main/printing/windowsUsbPrintBoundary.ts` | `b665eec3df732eb060e6c2249e62cfff0a3776c00445f17d71e99f0973e1a13f` |
| `desktop/src/main/printing/windowsUsbSpoolerScript.ts` | `e733da316956711ca295a9a970194553f3eec7dee76bd67836399982c54e653b` |
| `desktop/tests/windows-usb-front.test.ts` | `affae8277ed4abad2e01fe045e18e3fd477defd1b001a14d68ca538b4de0b21e` |
| `docs/desktop/windows-usb-front.md` | `03f744feab751ff39b74379bdac80a19428ec707f176f6e8d62d20c6bf5d2d7c` |

Raw main is 102 PASS / 1 FAIL and candidate is 101 PASS / 2 FAIL. The separate `tests/customer-order-recovery.test.ts` fixture DB failure is outside the eight-path disposition. Preserve it as a separate active release blocker until a formal scoped disposition or separately authorized repair is complete. It is not a USB product failure. This record assigns neither remediation authority nor a delivery date to the H5 owner.

## Exact Release Foundation historical state

Original freeze anchor `0d5e221aaec8a325a71372591c39e4fdb4c914a3`. Only the 16 recorded paths and exact historical/current SHA-256 in the byte matrix SHA-256 `9323b8be353b34e251455b3d285f9ffc008b0ffb124f59ab498c320e0997ed8c` are eligible for candidate-specific disposition. All 16 paths are byte-identical between trusted main and the product candidate. All previous group anchors and unrelated groups remain in force.

| Group | Existing comparison anchor | Audited paths |
| --- | --- | ---: |
| Prisma | `cb55c5a9e78cb7f80c8295a0387bb82cb0af8494` | 8 |
| Payment | `0d5e221aaec8a325a71372591c39e4fdb4c914a3` | 2 |
| Scanner | `8317b4c2bd0ee0a90b7df4b2fe64b3489ebd6a99` | 1 |
| cashier/customer/mobile business | `8fdf9b310a9b23e1e3c9e02cf88ec2790a9f879c` | 5 |

The exact correction for `app/home/page.tsx` cites trusted-main document `docs/milestone-b/ES-HISTORICAL-HOME-GOVERNANCE-REMEDIATION-01 Historical Governance Corrective Successor Alignment.md`, SHA-256 `ef4c66c461d4d60c3b266f43a69d0fa9a8079b7ffa6f6fa9efdc6061837fa032`. Its Option A concerns one exact current path only. The historical violation remains confirmed. Its DRAFT/PENDING status and the absence of a wider executable registry grant are preserved. The computer-client record attests the Founder-accepted source; it does not widen a frozen-group rule. Historical approved registries support the other fourteen paths. No prior grant is reused as authorization for this task.

Both release-foundation test wrappers remain raw FAIL and the official check exits 1 on main and candidate. This draft neither changes those outputs nor replaces executable policy. Do not widen any snapshot or replace the original gate. Before formal release, replay the official Windows policy against a lawfully activated, exactly reviewed successor and record the actual result.

## Activation and exclusions

Activation requires Founder signature binding this exact record and request SHA-256, independent Claude review and the repository's formal registration mechanism. Do not install, claim FIELD, sign ESC-2, merge or publish under this record. Any future executable governance bytes are outside this document's implicit authority; apply only after exact review and the requisite formal registration. Product Candidate and future Governance Head remain distinct. The signed artifact must not be inferred from this pending draft.

Pinned unsigned test EXE SHA-256 `783536dbb371c630a94100d6b372186300152668bdc29a116b76b38fca6ea155`. Windows physical FIELD remains BLOCKED until an isolated qualified physical target exists. Final ESC-2 signature is a later decision against verified evidence.

## Founder conditional approval and registration stop point

The preceding sealed draft is retained byte for byte. This append-only record documents the conditional approval communicated in the current task conversation. It is pending formal registration and trusted-main integration under Workflow V1 §6.2, Workflow V2 §6 and ES-ENG-001. It does not claim a repository OWNER comment or an active exception. The eight-path failure remains raw BLOCKED. The customer-order fixture failure remains an independent raw release blocker.

```json
{
  "status": "FOUNDER_CONDITIONALLY_APPROVED_PENDING_TRUSTED_MAIN_REGISTRATION",
  "approvalSource": "Founder decision supplied in the current task conversation",
  "approvalTranscriptSha256": "7cfafb777b4c55eb09ebd5521adb815af1a9c54101d412f61d60b54df51d5c2b",
  "authorizationRequestSha256": "a53cbad30f822934cfac20af9182871fd1dfa5402a07e6b7c78b0b05fa57c44a",
  "coverSha256": "237f88c8d7e4d71183d0afcb8b9b07cf334832787afc5dd5d512d72e68f8c745",
  "reviewedPrefixSha256": "7860b7d9331a45c4b84ad92909f84daae1c317b13403e7b982b006450dba79ad",
  "reviewedPrefixBytes": 5546,
  "independentSealedDraftReviewSha256": "01ba4bebeecde89eaba127a4cc9fe30dce51622c5eb7ea0664ec8f9445b1610a",
  "productCandidate": "c50bd967c59452b3ecae602f0624dccf10244127",
  "productTree": "29b8f14b504296f8817d3a7130135c6f32c34071",
  "trustedMain": "aa5ac043788651062c681a23a3303a0438092ddb",
  "production": "d441b55c8014642eb1b26b90d7bf5ce1b2df7941",
  "matrixSha256": "9323b8be353b34e251455b3d285f9ffc008b0ffb124f59ab498c320e0997ed8c",
  "installerSha256": "783536dbb371c630a94100d6b372186300152668bdc29a116b76b38fca6ea155",
  "recordEffect": "Local record of conditional approval. Formal registration and verified integration on trusted main remain pending. No executable admission, protected-ref integration, policy waiver or release effect."
}
```

## Verified historical path bindings

Each listed path matches both the matrix and the unchanged product candidate. The entries are evidence for later exact disposition, not an active policy allowlist.

| Frozen group | Path | Current main and candidate SHA-256 |
| --- | --- | --- |
| Prisma | `prisma/migrations/20261005120000_add_customer_order_fulfillment_intent/migration.sql` | `81dd062b608b364124bff33858b8a0a1aad0546de701bf1cd14e660684f48349` |
| Prisma | `prisma/migrations/20261006160000_add_customer_order_render_dispatch/migration.sql` | `6ab3b3d59d4ad2df564c691b86303135391147e19b02ed6cb39e07b3369250cc` |
| Prisma | `prisma/migrations/20261007090000_add_customer_order_submission_idempotency/migration.sql` | `0b1e9b4628d08a962bb853e8a0af843656db8387db8e6907ec3837d9ba59a12e` |
| Prisma | `prisma/migrations/20261009090000_add_customer_order_fulfillment_purpose/migration.sql` | `fdfe9c3bb71bb5dd9945c89d080b1ad23c9220a0d94ebf26c00078d1ccece9b9` |
| Prisma | `prisma/migrations/20261010_es_dine_in_01/migration.sql` | `f0622b4f11ed06a10e59d71c109a0e86d4c52a1be7d78e7e58aca3cb3b4c272b` |
| Prisma | `prisma/migrations/20261014000000_add_desktop_print_child_identity/migration.sql` | `6408870bb82159df6483037937cbc4c74e0242cd1502ba57837a84e055a0ef69` |
| Prisma | `prisma/migrations/20261101090000_add_retail_multi_unit/migration.sql` | `077df39c3557e048288de36a94eb247bc057e0335122955d00cc542c135f53f5` |
| Prisma | `prisma/schema.prisma` | `8c70351a1d9b12eb4b5a0f82ba39e001825ca0b9702cd2d25f729c410b85828b` |
| Payment | `app/api/sales/lookup/route.ts` | `25814dd178c3c0887ed3e93be48dacffd0292331426cf851c528895060e7e367` |
| Payment | `app/api/sales/route.ts` | `0d256d55ee77963678c7cc5b820bb401cac195ebe851b675a2edb983ab9ebb2e` |
| Scanner | `app/sale/page.tsx` | `6818f8b63ba25031a2501947baa0ca9a8e03959ee5d47a245ddad13f3a00980f` |
| cashier/customer/mobile business | `app/cashier/page.tsx` | `8cdf50c3ce9db38e0b160a367ab1e12b632ae4e86a0cbdb9e55b0fbeb24623e6` |
| cashier/customer/mobile business | `app/home/computer-client/page.tsx` | `790d7363b8a7eb9252dfe4023397a20b13697b6163ed12d364d9ea3a0bc60b16` |
| cashier/customer/mobile business | `app/home/page.tsx` | `b031e438b5384c1f2cbb2c903c685ae8e20a6b6dd82f6f904e34a5603b05b8a2` |
| cashier/customer/mobile business | `app/menu/page.tsx` | `f45c44a5ecac6cd02fbb82e1a91731a8039d8f71fa6378e905cdb96146dfa029` |
| cashier/customer/mobile business | `app/records/page.tsx` | `ea5d384ef42d51668e4641a2f6be5e0dfd17f0a8c6f407f420bc9390b9ed664a` |

## Approval text as received

```text
ES-PRINT-USB-BASELINE-01 — Founder Gate Decision

Decision：CONDITIONAL APPROVED — EXACT FROZEN SUCCESSOR

批准本次精确冻结后继处置范围。

授权请求 SHA-256：

a53cbad30f822934cfac20af9182871fd1dfa5402a07e6b7c78b0b05fa57c44a

绑定业务候选：

c50bd967c59452b3ecae602f0624dccf10244127

执行要求

1. 首先核对 FOUNDER-REQUEST 原文 SHA-256、八路径文件哈希、Claude 审查绑定及当前候选 Commit。任何不一致必须停止激活。
2. 核验通过后，允许将授权范围内的 SEALED DRAFT / INACTIVE 转为合法有效的冻结后继记录，保留完整审批、字节和血统证据。
3. CORE 八路径准入只能依据精确授权处置。release-foundation 的 16 个历史路径须逐项处理，不允许整组豁免、批量刷新快照或放宽 CI。
4. 激活后重新执行完整 CORE、release-foundation、STRICT Lineage、Scope Guard 和 V2 冻结检查。保留原始日志。
5. 顾客订单恢复的既有失败继续保持独立阻塞，除非另有合法修复与完整验证，不得标记发布准入通过。
6. 继续准备隔离 Windows 及物理打印机 FIELD，优先使用现有已验包的标准安装包，不重复开发 USB 功能。
7. Codex 自主执行授权范围内的治理处置和验证，Claude 对最终后继状态和门禁结果进行独立核验。

本次不授权 ESC-2 正式签认、主线合并、Production 部署或营业门店生产配置变更。

下一次仅在达到最终签认条件，或发现无法在本授权范围内解决的阻塞时，提交 Founder Gate。

最终只报告：冻结后继激活结果、门禁实际结果、剩余阻塞、Windows FIELD 结果及 ESC-2 准入结论。
```
