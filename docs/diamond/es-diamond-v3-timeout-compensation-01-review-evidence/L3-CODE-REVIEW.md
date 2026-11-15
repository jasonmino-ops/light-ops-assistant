I have sufficient verified material across source, tests, evidence, and governance docs to produce the independent review now.

---

# Claude Independent L3 Review — ES-DIAMOND-V3-EXPIRE-TIMEOUT-RECOVERY-01 (Compensation)

## 1. PASS / FAIL

**Code (product): PASS**, bound exactly to `b558dcd197f166936610b5c7c140c0acb5f55a86` (two files only: `app/api/.../v3-print-control-plane/service.ts`, `tests/v3-print-control-plane-service.test.ts`), base `ca7e04ec9d600e568d29258f1e0dc9879c96a72c`, trusted main `c1041533abca99657edc09c2e69e2c18d9df13d5`.

**Release/recovery readiness: FAIL (not ready) — by design, not defect.** Release draft `1427131e94aba6a19c52dee61f531fec2c9213b3` / tree `178bfec6bb55616c7f0c02e16422f413c6149e0d` is cryptographically consistent with the product and with Production `9e717439569c0485c703367b668b31ed8a7505e6`, but `sourceMainSha` is `PENDING_MAIN_MERGE_APPROVAL`, `requiredCheckIssued=false`, and `AUTHORIZED_SELECTIVE_RELEASE` is explicitly `NOT_EXECUTED_NOT_AUTHORIZED`. CORE is `103/101/2/BLOCKED`. Frozen successor disposition is `SEALED_DRAFT_NOT_ACTIVE`. None of this blocks the code verdict; it blocks any release/FIELD action, which is correctly out of scope this round.

## 2. Blocking Issues

None in the two in-scope files for the stated scope (exact one-time compensation, no printing/FINALIZE). Specifically:

- Role gating, tenant/founder/version pin (`service.ts` new lines ~138–142), compensation window checks, original-audit binding digest, installation HMAC recheck, job-set digest recheck, single-use grant check, and EXPIRE's requirement of a *fresh* matching grant are all present and exercised by negative tests that assert no row/state mutation on failure (`assertCompensationUnchanged`).
- No gap found in the trusted-source policy (Architecture Q2): the typed projection binds `id, requestId, createdAt, reviewerId, founderEmergency, reason, fence{stateVersion,ownerEpoch,releasedAt}, capture{captureId,deviceId,ownerEpoch,releasedAt,releasedBatchId,capturedAt}, jobs[]`. `actionType`/`status` are enforced by the Prisma `WHERE` filter rather than the digest (acceptable — the row literally cannot be found otherwise), and tenant/store scoping is enforced by the same `WHERE target` clause plus the separate hardcoded `scope.tenantId`/`actor.id` check. Device identity is independently rechecked via fresh HMAC equality, not via the digest. I don't find a decisive field omitted from this binding.
- Concurrency (Architecture Q3/Q4): real-PG tests cover concurrent identical and distinct `requestId` REVIEWs and EXPIREs; at most one durable grant/terminal audit in all cases; losing request never renews a spent allowance; audit failure/timeout rollback leaves no grant (both the constraint-violation and the 5s/10s delayed-audit paths are tested for both REVIEW and EXPIRE, matching the ca7 pattern with `{ isolationLevel: 'Serializable' }` for REVIEW vs `{ isolationLevel: 'Serializable', timeout: 10_000 }` for EXPIRE).
- No loophole found to replay old evidence into a new grant, to consume from a mismatched action/store/device, or to reset/re-date the original REVIEW — all rejected with specific codes and verified unchanged via `assertCompensationUnchanged`.

## 3. Non-Blocking Issues

- The digest-bound projection (`readCompensationOriginal`) does not independently re-assert `review.founderEmergency === true`/`reviewed action === FOUNDER_REVIEW_EVIDENCE` inside the projection array itself — it's implied by the `WHERE actionType: FOUNDER_REVIEW_EVIDENCE` filter and by `founderEmergency` being included as a projected value (so tampering with it is caught), but it's one layer of indirection a future reader could misread as "not checked." Consider a one-line comment at the query site making this explicit; not a correctness defect given the verifier's independent recomputation already confirms the `originalBindingSha256` is reproducible from exactly these fields.
- The frozen-successor sealed draft (`FROZEN-SUCCESSOR-SEALED-DRAFT.json`) correctly marks `approval: null` and `status: SEALED_DRAFT_NOT_ACTIVE`, but its `proposedNewGovernancePaths` (two new freeze/change-gate docs) don't yet exist as files in the evidence pack — fine for a draft, but should be called out explicitly in the final hand-off so nobody mistakes "drafted" for "filed."

## 4. Boundary Violations

None observed in the product diff. `FULL-PRODUCT-DIFF.patch` touches only the same two files as `COMPENSATION-ONLY-DIFF.patch` (plus the already-reviewed ca7e04ec timeout fix baked into the same file history) — confirmed independently by `VERIFY-CANDIDATE.py` (diff-name-only sets match the manifest's two-path `productPaths` exactly, both base→product and Production→releaseSha). `PRESERVED-INVARIANTS.json` and the verifier's byte-range comparisons confirm `reviewQueueRows`, the CAS block, `expireBudget`, `lib/v3-print-control-plane.ts`, `lib/v3-print-job-adapter.ts`, `lib/prisma.ts`, `prisma/schema.prisma`, the route file, and `tests/cashier-realtime-integration.test.ts` are byte-identical to trusted main. No new endpoint/permission/schema/dependency was introduced.

## 5. Missing Evidence (verified vs UNKNOWN)

**Verified by me directly:**
- Ran `python3 -B VERIFY-CANDIDATE.py` from this packet; it returned `"result": "PASS"` with all claimed bindings (69 bound files, exact two product paths, unchanged CAS/timeout functions, recomputed `originalBindingSha256` matching the source literal, 142/0/0 targeted, TS/Build/Scope exit 0, CORE 103/101/2/BLOCKED, release tree equality, `-x` cherry-pick mapping, `AUTHORIZED_SELECTIVE_RELEASE: NOT_CLAIMED`). This script itself independently re-derives hashes and re-runs `git`/scope-guard commands rather than trusting narrative text.
- Read the full `COMPENSATION-ONLY-DIFF.patch`, confirmed it matches `candidate/.../service.ts` and `candidate/tests/v3-print-control-plane-service.test.ts` logic described in the brief.
- Confirmed the two CORE failures are pre-existing/unrelated to this diff: `tests/customer-order-recovery.test.ts` fails identically on baseline (`exitStatus:1` in `BASELINE-COMPARISON.json`) — unrelated, pre-existing, unstubbed DB read. `tests/cashier-realtime-integration.test.ts` passes on baseline but fails on the branch because of an exact-registration frozen-boundary assertion whose expected file list predates a large set of already-accumulated, separately-governed, not-yet-merged work (P0 founder queue recovery, product-count-limit, local-first UX, etc.) — the unexpected-file list in the failure diff includes dozens of files unrelated to this task's two-file scope, confirming this is a "not grandfathered" admission gap inherited from the branch, not something this compensation diff newly causes.
- Read `AGENTS.md`, `E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md` (§3.4 L3, §5 independent review, §6 Founder Gate), `ES-ENG-001 ... FINAL.md` (lifecycle, Claude Review template/mandatory list, Founder Approval list), `ES-RELEASE-SELECTIVE-LINEAGE-GOVERNANCE-01.md`, `gate-config.json`, `ES-DIAMOND-V3-PRINT-FROZEN-SUCCESSOR-01.md` (unrelated prior freeze, confirmed not touched), `RELEASE-LINEAGE.log` (CONTENT_SUBSET PASS), `SELECTIVE-RELEASE-DRAFT.json`/`INITIAL-TREE-VALIDATED-DRAFT.json` (tree-identity-only commit-message amendment, confirmed via verifier), `KNOWN-RISKS.md`, `SCOPE-BOUNDARY-AUDIT.md`, `FROZEN-SUCCESSOR-SEALED-DRAFT.json`, `TEST-COVERAGE-MATRIX.md`, `COMMIT-SCOPE-AUDIT.md`, `PRODUCTION-RELEASE-PLAN.md`.

**Genuinely UNKNOWN to me (not verifiable from this read-only packet, correctly flagged as such in the brief itself):**
- Whether Founder Approval for the frozen-successor/CORE-disposition proposal has actually been granted (draft only, `approval: null`).
- Real FRONT runtime reachability/config, actual Windows ledger byte authenticity, and any eventual FIELD VERIFIED outcome — none of this is claimed in the pack and none was tested here.
- Whether `origin/main`/`origin/release`/Production have changed since this packet was frozen (I have no live git/network access in this session beyond what the provided verifier script itself read).
- Whether the proposed two new governance doc paths will be filed verbatim as drafted.

## 6. Architecture Risks

- The compensation path is a hard-coded, single-instance, single-tenant exception embedded directly in shared production source (`DIAMOND_TIMEOUT_COMPENSATION` constant). That's appropriate for an exact one-time case but means the file now permanently carries dead, case-specific logic after `2026-11-08T00:00:00Z` unless a cleanup EP removes it — worth tracking as technical debt, not a merge blocker.
- The frozen-boundary CORE gap (cashier-realtime-integration's exact-registration test) is a real, pre-existing admission backlog independent of this diff, but it means CORE will stay `BLOCKED` until a separate, Founder-approved disposition is formally filed — this diff cannot and does not fix that, and correctly doesn't try to.
- Release-tree reuse (Q7): justified. The verifier cryptographically confirms `releaseSha^{tree} == df0fa833...^{tree} == releaseTree`, i.e., only commit metadata (the `-x` cherry-pick provenance annotations) changed, not content — this is a legitimate, independently checked reuse, not a relabeled re-execution, and the evidence pack explicitly disclaims treating it as such.

## 7. Acceptance Recommendation

Code-level acceptance of the compensation diff for its stated purpose (exact one-time REVIEW/EXPIRE compensation, no printing, no FINALIZE) is reasonable on the evidence read and the verifier's PASS. No deployment, merge, release, Production action, or FIELD permission is implied or recommended by this review. Before any further step, the pending formal gates must still be independently satisfied: Founder frozen-admission approval for the two sealed-draft governance records, approved main merge of the two source commits, a fresh `AUTHORIZED_SELECTIVE_RELEASE` run against the current authoritative state, and the required GitHub check — none of which this review performs or substitutes for.

## 8. Reviewer Declaration

- **Materials actually read:** `BINDINGS.json`, `VERIFY-CANDIDATE.py` (and executed it), `TASK-STATE.md`, `REVIEW-BRIEF.md`, `candidate/AGENTS.md`, `candidate/docs/workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md`, `candidate/docs/governance/ES-ENG-001 Engineering Workflow Baseline V1.0 FINAL.md`, `candidate/docs/governance/ES-RELEASE-SELECTIVE-LINEAGE-GOVERNANCE-01.md`, `candidate/docs/change-gates/gate-config.json`, `candidate/docs/freezes/ES-DIAMOND-V3-PRINT-FROZEN-SUCCESSOR-01.md`, full `evidence/COMPENSATION-ONLY-DIFF.patch`, `evidence/FULL-PRODUCT-DIFF.patch` (diff headers + file count check), both the candidate and reviewed-timeout-base `service.ts` (including the pre-existing `digest`/`sha256`/`object`/`requireRecovery` helpers), `candidate/docs/diamond/.../CANDIDATE-MANIFEST.json`, `KNOWN-RISKS.md`, `SCOPE-BOUNDARY-AUDIT.md`, `FROZEN-SUCCESSOR-SEALED-DRAFT.json`, `TEST-COVERAGE-MATRIX.md`, `COMMIT-SCOPE-AUDIT.md`, `PRODUCTION-RELEASE-PLAN.md`, `evidence/PRESERVED-INVARIANTS.json`, `evidence/BASELINE-COMPARISON.json`, `evidence/CORE-FAIL-cashier-realtime-integration.test.log`, `evidence/CORE-FAIL-customer-order-recovery.test.log` (grep-targeted), `evidence/core/core/summary.json`, `evidence/RELEASE-LINEAGE.log`, `evidence/SELECTIVE-RELEASE-DRAFT.json`, `evidence/INITIAL-TREE-VALIDATED-DRAFT.json`, `evidence/ORIGINAL-REVIEW-PUBLIC-BINDING.json`.
- **No implementer conversation history was shared with me**, and none was used.
- **Files modified / external actions: NONE.** I made no edits, no commits, no network/API calls, no merges, no deploys. The only command executed was the provided read-only `VERIFY-CANDIDATE.py` and local `wc`/`grep` inspections inside this packet.
- **Verifier result:** PASS (full JSON output reproduced above in §5).
- **Actual unknowns:** listed in §5; I do not claim Founder frozen-admission approval exists, do not claim CORE is anything but BLOCKED, do not claim any real Windows/FIELD evidence, and do not claim any printing or recovery execution occurred.
