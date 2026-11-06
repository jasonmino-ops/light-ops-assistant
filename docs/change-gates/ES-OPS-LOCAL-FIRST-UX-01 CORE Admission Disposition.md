# ES-OPS-LOCAL-FIRST-UX-01 CORE Admission Disposition

Status: FOUNDER-APPROVED TASK-SPECIFIC DISPOSITION — local governance record, not merged into trusted main. Independent governance review and actual CORE results are recorded separately below; no review PASS is implied by Founder approval.

Approval authority: Founder, 2026-11-06. Decision: `EXECUTE PREVIOUSLY APPROVED GOVERNANCE REPAIR`.

Exact instruction: “在独立治理分支修改 scripts/test/manifests/root-core-tests.json，仅补登记现有 readout 测试，102→103”；“创建 docs/change-gates/ES-OPS-LOCAL-FIRST-UX-01 CORE Admission Disposition.md，绑定 Candidate SHA，记录五路径准入失败及正式限定例外”；“不修改冻结测试、断言、KTF 清单或任何产品代码”。

This records the approved two-path repair and the narrowly scoped admission exception. It is not a Scope Guard ACTIVE registry, a test PASS, permission to modify frozen tests, or merge/push/deploy authority.

Current closeout status is defined by the additive section **BASELINE-ATTRIBUTED CORE CLOSEOUT** below. Earlier non-waiver/invalidation statements describe the predecessor governance commit and are preserved as history; they are not silently reused as an effective grant. Required product review and merge acceptance remain separate.

## Exact approved scope

Product Candidate `cd60f0d57b3a7d36869c23edff9948c3f4538cd3`; parent `9021adf65b43708f68e423065702ec948a6b64e9`; trusted baseline `36ab0226363d71c4d2b42b6cfed58af3e27f6627`.
Full Candidate diff SHA-256 `cac690b8a1a372212a2013da865ee0c908f043c61c1f43c3a0923e8c8bf0500e`; limited diff SHA-256 `e51204fdd6609d822e5758733022c3ed5f67cd71e015923e720068f532f6253d`.
Only these five Candidate paths and bytes:
- `app/ops/[tenantId]/DiamondFounderRecoveryPanel.tsx` — `4851a0beda6fd725fb289dfec42a13879eefaf8ad8cc214f9172925f70ad48a4`
- `app/ops/[tenantId]/localFirstPresentation.ts` — `94fc42e3dd3191a5c3fc5f3d30ac05dc1701e9d48eec61d3cceea1bf572a5dff`
- `app/ops/[tenantId]/page.tsx` — `738cb279fe7e3b164514f71bc22ce1e1c7755527351b20c40a291dfccb592074`
- `tests/diamond-founder-recovery-readout.test.ts` — `a7527515e1217e08755dd19f851e014294b00555e37cec0b93f750c9cb6e4689`
- `tests/v3-print-control-plane-contract.test.cjs` — `b0ba1e501d0bd6ab2ecd62bb3cad4f9c53d8b8d6ce3d9b71e3becb1e5063e0d8`

Frozen test `tests/cashier-realtime-integration.test.ts`, unchanged SHA-256 `4a76962e28336391d30810d4476d2bad3b94eb09c0496a1649b13d0cd4757dc3`.

## Actual test truth

Parent focused raw log SHA-256 `62727125c4588f02bafb075de2c0a44c4242cd9cd27d3e5c0749b3959d2a4713`; Candidate focused raw log SHA-256 `7950b3abc12f3bf87429b08fea890f7d40c7da32bab5fc181a50a971b058e538`. Both: 0 PASS / 1 FAIL / 0 SKIP. Failure is the final `assertBoundary(changed, approved)` at line 795; actual list exactly equals the five paths above; expected list is empty. All five paths are individually present in the assertion output. This is Candidate-caused path admission, not a baseline-equivalence or non-causal product claim. No product-code regression is established by this failing assertion; entire aggregate behavior is still UNKNOWN.

Candidate full-runner preflight raw log SHA-256 `2df6a063f6c136fb785de8386bd4ac2721c88923a569a2a45fab31b35814a3a9`: exit 2 / BLOCKED, expected120, collected0, executed0, pass0, fail0, skip0. Existing readout test missing from both manifests. This second issue is not covered by the proposed focused exception.

## Founder-approved qualified disposition

Only the enumerated focused path-admission failure is admitted as `RAW FAIL — Founder-approved task-specific admission exception`; never `CORE PASS`. Founder approval is recorded above under ES-ENG-001 Founder Approval. Historical G2 approval supplies an evidence precedent and is not inherited: that record concerned non-causal failures; this one concerns an authorized Candidate admission failure.

No assertion changes, skip patterns, omitted tests, bypass authorization set or general allowlist expansion. Original raw logs remain immutable. This disposition removes only the five-path admission failure as an automatic merge veto; it does not approve any other failure, missing execution, incomplete review, merge or release.

The unmodified runner's existing `--core-manifest` option selects a byte-identical ignored copy of the approved registration, preserving the Product Candidate checkout and SHA. This is an additive full manifest, not a test filter: CORE102→103, INTEGRATION18 unchanged, complete discovered union121. No alternate KTF baseline, fail-to-pass reclassification flag or skip option is used. Raw CORE exit/status/counts remain unmodified. Any additional failure or changed rejected-path list remains blocking until independently classified and dispositioned.

## Invalidation and deadline

Invalid on any Candidate/baseline/path/hash change, extra rejected path, changed failure identity/fingerprint/count, product overlap with tested cashier behavior, new aggregate failure, missing raw evidence or later baseline repair. Review deadline 2026-11-07 Asia/Phnom_Penh and before merge. No automatic inheritance by another task or integration SHA. A later integration SHA needs a recorded comparison proving the five product bytes unchanged and identifying its governance metadata separately. Test evidence below is bound to the frozen Product Candidate with only the approved manifest supplied separately.

## No other authority

No right to change the frozen cashier test, KTF registry, V3 security, POST, actual button predicates, route/service, Owner/Lease/Fence, migration, Desktop, Production, Diamond recovery or printing. No push/merge/deploy authorization.

## Approved manifest registration

- Path: `scripts/test/manifests/root-core-tests.json`.
- Only change: expectedCount102→103; add existing `tests/diamond-founder-recovery-readout.test.ts`, CORE / NONE. Preserve original102 entries and integration18.
- Original SHA-256: `7067fbbe1e3805f7e0056038f01dee550078c987c00efae08eae81b6535f731f`.
- Approved registration SHA-256: `be7b3d97d93f63ff6a09ee807621614a43f78b810a2ca0270050bd1e78d8d4a2`.
- Source is controlled lane metadata. No Docs-only Lineage Exception used because it affects test automation. Fresh trusted main and Production lineage were checked: CONTENT_SUBSET PASS, STRICT ancestry NO.

## Execution and review evidence

Governance classification: **L3 governance-only formal exception record** under Workflow V1 §3.4 (`exception 记录`). The original Product Candidate remains L2/UI Fast Path. Founder has already approved the exact repair; this classification does not request repeated authorization or permit product changes.

Actual command at the clean, frozen Product Candidate:

```sh
npm run test:core -- --core-manifest .task-state/governance-repair-executed/root-core-approved.json --output-dir .task-state/governance-repair-executed/core
```

- Run identity: `20261106T040859Z-cd60f0d57b3a`.
- Source HEAD: `cd60f0d57b3a7d36869c23edff9948c3f4538cd3`; all five Product Candidate hashes unchanged before/after.
- Manifest103 bytes match the approved governance path SHA-256 above; all existing102 tests remain present. No tests were removed or skipped.
- **103 expected / 103 collected / 103 executed / 101 PASS / 2 FAIL / 0 SKIP / 0 uncollected / 0 environment failures**. Runner knownFailures0/newFailures2/recoveredFailures1; exit1, overall **BLOCKED**.
- This is the CORE lane, not a121-entry full aggregate. The18 INTEGRATION entries were not executed by this command and receive no PASS claim.
- Actual raw log `core/core/root-core-suite.log`, SHA-256 `83803ae795112455c7193e3d0b41182f59e31e7016212751d452f33e5683dd45`.
- Structured summary `core/core/summary.json`, SHA-256 `b5267e344eb89a4af4f4eafff8d1003da8a03541f96ba34a181802f0d009139b`.
- The prior unregistered-readout collection blocker is resolved for the103-file CORE lane. Original120-uncollected evidence remains immutable and is superseded only for the new CORE execution, not rewritten.

### Failure A — approved exact five-path admission

`tests/cashier-realtime-integration.test.ts` still fails only at line795 with the same five rejected paths and empty expected list. The frozen test bytes are unchanged. This is recorded as RAW FAIL with the Founder-approved narrow disposition; the runner itself still classifies it NOT_IN_ACTIVE_BASELINE because neither runner nor KTF has been changed.

### Failure B — additional blocker not admitted by this record

`tests/customer-order-recovery.test.ts` has four failing cases:

| Case | Line | Actual / expected |
| --- | --- | --- |
| recovery advances beyond ten pages and keeps renderer-blocked intents visible |83|503 /200|
| expired intent is visible and removed from the actionable set |109|503 /200|
| recovery persists a retry backoff for a bad row instead of leaving it at the queue head |127|999 /1|
| V2_ACTIVE never creates an H5 job and recovery remains visible |152|503 /200|

The test's fixture omits `eshopTrayPrintJob.findUnique`; `lib/customer-order-fulfillment.ts:374` consequently reaches real Prisma rather than an in-process stub. No Production credential was supplied. Two focused runs with identical explicit loopback dummy database settings reproduce the same4FAIL/1PASS on Product Candidate and trusted-main product bytes. Initial sandbox attempts stopped before test execution on tsx IPC EPERM; those logs are preserved separately and not counted as assertions.

- Baseline relevant8 source/test/dependency/schema files are byte-identical; exact hashes, case names and assertion values are in `customer-order-recovery-attribution.json`, SHA-256 `76975c1bcebcec2b77cb787898e8171de0fcae484cec59d692ee03f89539d9bb`.
- Candidate focused log SHA-256 `7343c5e95979d977bef1bb5fbc0073ff7b9dc7bfdb42b537de905327877f33e7`; trusted-main product-byte focused log SHA-256 `66ddb95a32bf24897e74df6d59fe1fda645a4e67e6405fa3b5d3759fd8c3b129`.
- Attribution: reproduced baseline test/harness debt, not a UX Candidate product regression. This is **not** an approval, KTF entry or waiver for this failure.

### Current effectiveness / remaining gates

The additional failure triggers the automatic invalidation condition for relying on this disposition for current merge readiness. Founder approval and the historical five-path classification remain recorded, but **the current CORE run is NOT accepted as merge-ready by this record**. No exception is extended to Failure B; no test/assertion/KTF/product file is repaired here. CORE remains BLOCKED.

Official Claude Code subscription auth is loggedInfalse; no Claude model request was sent through the known low-credit API helper. Product limited review remains NOT_COMPLETED. A fresh-context Codex governance review is supplementary and cannot replace Claude. Preview reproduction/acceptance materials are prepared, without deployment or acceptance claim.

Current clean pre-edit main/lineage observation is preserved in `lineage-preedit-observation.json` (verbatim transcription from actual tool result before edits), with Production metadata from the explicit-team/project CLI fallback. It records CONTENT_SUBSET PASS and STRICT ancestryNO; no Docs-only Exception.

Raw evidence and exact source/manifest/proposal/review material are archived separately in the real Vault attachment `05-开发记录/开发日志/附件/ES-OPS-LOCAL-FIRST-UX-01-cd60f0d5/governance-repair-executed-cd60f0d5.tar.gz`; archival checksum is recorded in the sibling checksum file and the development record. This does not alter the runner's original durability/status fields.

Ready for Merge: **NO**. No merge, push, Production/Preview deployment, migration, Diamond recovery or real printing was performed.


## Addendum — BASELINE-ATTRIBUTED CORE CLOSEOUT (2026-11-06)

### Authority and exact binding

Founder Decision: `BASELINE-ATTRIBUTED CORE CLOSEOUT`. Exact current direction: “分别在可信 main 和当前候选组合上复现，确认是否由本任务引入”；“对已证明的既有基线失败，使用正式的基线失败处置机制；不得修改或跳过测试”；“核验五路径限定例外是否满足现行生效条件，不得把草案视为已生效”。

This additive record implements that direction in the already-authorized disposition path. Authority is ES-ENG-001 Founder Approval (exception to a frozen baseline), Workflow V1 §5/§6, and the task-specific evidence form demonstrated by G2. No G2/V3 approval is inherited. No KTF entry, test/assertion, runner or Scope Guard rule changes.

- Product Candidate: `cd60f0d57b3a7d36869c23edff9948c3f4538cd3`. Five paths/content hashes and frozen cashier digest remain exactly those listed above.
- Clean exact trusted main: `36ab0226363d71c4d2b42b6cfed58af3e27f6627`; detached reproduction worktree contains no governance/product diff.
- Predecessor Governance Commit: `ace51a6e2c09a914b5ad30aef0834b1cd8681034`.
- Tested combination: frozen Product source HEAD plus approved103-entry manifest SHA-256 `be7b3d97d93f63ff6a09ee807621614a43f78b810a2ca0270050bd1e78d8d4a2`. This does not fabricate a merged integration HEAD. This additive document has no effect on tested product/test bytes.
- Comparison evidence: `BASELINE-COMPARISON.json`, SHA-256 `4bf6d046057404d495a20a7901a000eea07f853db65252242c674d7f56af1e6e`; exact assertion identities are in `FAILURE-REGISTER.md`.

### F1 renewed limited admission — not a baseline failure

Main focused result1PASS/0FAIL/0SKIP; Candidate focused0PASS/1FAIL/0SKIP. Unchanged `tests/cashier-realtime-integration.test.ts:795` calls helper283; Candidate actual rejected-path array equals the five frozen UX paths, expected array empty. This is task-caused admission difference, with no evidence of product-behavior regression.

- Exact-main raw log `cashier-main.log`, SHA-256 `d82c9b05e49152af9ee8e231d1707e4b3a5803d095710239419d47b6f516be1a`.
- Candidate raw log `cashier-candidate.log`, SHA-256 `7113f48a3189b09879a886470948756f7fb6325fd8e3f8b0f2cfcbe2b2006b99`.

The prior five-path grant was invalidated for merge reliance when unclassified F2 was discovered. This addendum explicitly renews only that same five-path disposition under the current Founder direction after F2 is independently baseline-attributed and separately recorded below. It does not retrospectively make the earlier invalidated state effective.

### F2 exact task-scoped baseline exception

Exact test `tests/customer-order-recovery.test.ts`: the same four identities listed in the historical table fail on clean exact main and Product Candidate. Lines83/109/152 are503≠200; line127 is999≠1. Both runs1PASS/4FAIL/0SKIP, with matching case identities and failure values. Relevant8 source/test/schema/dependency blobs are byte-identical, as recorded in the comparison matrix. The fixture lacks `eshopTrayPrintJob.findUnique`, reaching Prisma at `lib/customer-order-fulfillment.ts:374`. This establishes pre-existing test/harness debt relative to this UX task, not correctness of real recovery behavior.

- Main raw log `recovery-main.log`, SHA-256 `5a878f031d991967743d1e7b4f9434fbafbdc0ee2408b20ca6830c8ef141d389`.
- Candidate raw log `recovery-candidate.log`, SHA-256 `d1717c49feb1c60c293c84d3e5d79b0c69b8c65dfacf212289abf579dbf0acf4`.

The current Founder directive supplies the task-specific baseline-failure disposition authority. Record F2 only as `RAW FAIL — BASELINE-ATTRIBUTED TASK-SCOPED EXCEPTION`, using the formal exact-baseline/Candidate/evidence/causality/expiry mechanism. It is not a global known failure, not a KTF edit, and not an exception for another task or Candidate. No product/test repair, skip or assertion weakening is made.

### Raw truth and operative conditions

Raw CORE stays **103/103 collected and executed;101PASS/2FAIL/0SKIP; exit1/BLOCKED**, knownFailures0/newFailures2 under the unmodified runner/KTF. The original raw and structured hashes above remain unchanged. No121-entry full-aggregate PASS is asserted.

Documentary disposition covers exactly F1 admission plus F2 baseline debt, with candidate-attributable product regressions0 in this comparison. The qualified record is not machine CORE PASS. Historical statements “F2 not waived” and “additional failure invalidates current reliance” were true at predecessor ace51a6e; this explicit addendum supersedes them only for these two exact identities after the new comparison. Every other unlisted failure remains blocking.

F1 revalidation checklist: exact Candidate/baseline/five bytes/frozen cashier hash; exact final assertion/five rejected paths; approved manifest103 full execution; only the separately evidenced F2 failure; unchanged relevant safety surfaces; current review deadline. These evidence conditions are satisfied by the recorded comparison, not by an unapproved draft or an unrelated Scope Guard ACTIVE JSON. No forbidden path is changed by this documentary update.

**Required product Claude limited review remains NOT_COMPLETED (official subscription session not logged in). Therefore operative product Acceptance / merge reliance is NOT complete, even if supplementary independent metadata review passes.** This is the existing required product review, not a new Claude requirement merely for hashes. This local record is not represented as merged into trusted main or as a deployment/merge authorization.

The renewed bounded disposition invalidates on another failed identity, count/fingerprint change, extra rejected path, any Candidate/baseline/content drift, relevant surface overlap, missing evidence, later baseline repair or expiry. Retain deadline **2026-11-07 Asia/Phnom_Penh and before merge**; no implicit extension.

### Current closeout evidence

Fresh-context supplementary metadata review and final committed source binding are recorded in the closeout evidence packet. Neither substitutes for Claude. Preview result is separately labeled local hydrated Next / synthetic API or actual hosted runtime; no fixture screenshot can certify Provider readiness or FIELD.

Evidence retention: real Vault `05-开发记录/开发日志/附件/ES-OPS-LOCAL-FIRST-UX-01-cd60f0d5/baseline-core-closeout-cd60f0d5.tar.gz`; actual archival completion/checksum is in its sibling checksum file and the development record. The evidence packet excludes ephemeral local Preview credentials.

Ready for Merge remains **NO** until required review/visual acceptance and the remaining applicable merge gates are satisfied. No main merge, push, Production deployment, real Diamond recovery, printing, frozen-test/assertion/KTF/V3 change is authorized or performed by this addendum.
