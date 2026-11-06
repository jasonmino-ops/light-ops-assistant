# L3 Code Review — ES-DIAMOND-V3-EXPIRE-TIMEOUT-RECOVERY-01

## 1. PASS / FAIL

**PASS** — bound to product candidate `ca7e04ec9d600e568d29258f1e0dc9879c96a72c` (parent `c1041533abca99657edc09c2e69e2c18d9df13d5`), for the exact two-file diff in `evidence/EXACT-PRODUCT-DIFF.patch` (`service.ts` SHA256 `b8f770...8` / test SHA256 `1c62c5...4`), verified byte-identical to this candidate's git content via `VERIFY-CANDIDATE.py` (result `PASS`).

- **Technical L3 code verdict: PASS.** The CAS batching is predicate-equivalent to the old per-row loop, rollback semantics are preserved, the 10s timeout is scoped to exactly the two EXPIRE actions, and all surrounding safety invariants (fence, identity, idempotency, evidence freshness, Owner/Lease) are unchanged — confirmed by direct diff against parent, not narrative.
- **Release/recovery readiness: NOT READY**, independent of this code's correctness. The CORE lane is `BLOCKED` (2/103 failed), the Cashier frozen-boundary successor registry does not admit this new `service.ts` SHA, the Founder one-time REVIEW grant remains consumed/expired, and the compensation mechanism is an inert proposal with no runtime implementation. No live/Production action has occurred.

## 2. Blocking Issues
None found in the product code itself (`service.ts` / its test). No defect requires a code change before this candidate can be considered correct for its stated scope.

## 3. Non-Blocking Issues
- `service.ts:857` — the `updateMany` where-clause spreads `...scope` at the top level and again inside every `pendingUnexecutedJob(scope, job.id)` OR arm. Redundant (harmless — same key/value, Postgres will just AND it again), but worth trimming later for clarity.
- `ONE-TIME-COMPENSATION-SEALED-DRAFT.json` has no explicit field for how `founderExactContentApproval` itself would be authenticated/signed when eventually populated — flagged under Architecture Risks (§6), not a defect in this candidate since it's inert.

## 4. Boundary Violations
**None identified.** Specifically:
- `VERIFY-CANDIDATE.py` confirms the tracked diff between `base` and `product` is exactly `{service.ts, tests/v3-print-control-plane-service.test.ts}` (line 13), and all tracked changes after the product candidate are confined to `docs/diamond/es-diamond-v3-expire-timeout-recovery-01/*`.
- Independent full-file `diff` (parent vs. candidate `service.ts`) matches the patch exactly — no hidden edits elsewhere in the file.
- `route.ts`, `lib/v3-print-control-plane.ts`, `lib/v3-print-job-adapter.ts`, `prisma/schema.prisma`, `lib/prisma.ts`, `tests/cashier-realtime-integration.test.ts` are confirmed byte-identical to parent/base (verifier assertion + my own inspection).
- Scope Guard (`check-change-scope.js` via `gate-config.json`) returns `ALLOWED`/`PASS` for both touched paths; neither matches `forbidden_paths`.
- The compensation JSON/proposal contain no executable code, no new API/route/permission, consistent with Non-Scope.

## 5. Missing Evidence
**Verified (first-hand, this review):**
- Exact predicate equivalence of batched CAS vs. old per-row CAS (full diff + source read).
- `update.count === jobs.length` is sound because job ids are deduped upstream (`parseOpsV3QueueRecoveryCommand` line ~572, `parseEvidenceCapture` line ~551) — no duplicate-id ordering ambiguity possible.
- 10s timeout applies to exactly `EXPIRE_UNEXECUTED_V3_FRONT` / `FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT`; `isEvidenceCommand` branch (both REVIEW actions) keeps the Prisma-default budget, unchanged.
- `EVIDENCE_MAX_AGE_MS` (5min) and `CAPTURE_CLOCK_SKEW_MS` (30s) constants and all three post-write/post-audit `captureFresh` rechecks are unchanged and still present after the batched write.
- `BLOCKED_UNKNOWN` does globally gate new-order materialization (`v3-print-job-adapter.ts` HELD_MARKER path) and `FINALIZE_V3_ACTIVE`/`FINALIZE_V2_ACTIVE` require `hasFinalizedHandoffAuthority`/`v3Released`, i.e. historical disposition — confirmed by reading the actual (unchanged) route/service code, not the docs narrative.
- Targeted tests actually executed the real-socket PostgreSQL EXPIRE-timeout cases (durations 5840ms/5731ms/10330ms/39ms in `targeted-tests.log` match the injected delays) — these are not skipped stubs.
- The two CORE failures are not regressions from this diff: `customer-order-recovery.test.ts` fails identically on the pre-candidate baseline (503s, `baseline-customer-order-recovery.test.log`); `cashier-realtime-integration.test.ts` fails because the frozen Cashier/Diamond registry (`ES-DIAMOND-P0-FOUNDER-QUEUE-RECOVERY-01.md`) pins an older admitted `service.ts` SHA and a long list of other branch content not in trusted main's registry — an admission-gate mismatch, not a logic defect (`root-core-suite.log:161-210`).

**Unknown (cannot verify from provided materials):**
- Whether the real Production 5775ms boundary was dominated by lock wait vs. query execution vs. network — the docs explicitly say this is UNKNOWN and I have no per-statement trace to confirm or refute it.
- Whether 10,000ms is sufficient headroom under real Production load/lock contention (as opposed to the synthetic test harness) — no live load data was available to me.
- Content of any future Founder approval for the compensation proposal — `founderExactContentApproval` is `null`, confirmed by direct read of the JSON, and I verified no code anywhere in this candidate reads or acts on that field.

## 6. Architecture Risks
1. **CAS batching correctness** — sound. Each OR arm is keyed on a unique `id`, so no row can satisfy two arms and no double-count/ordering ambiguity exists; a single partial mismatch still throws `QueueRecoveryRejected` inside the Prisma interactive transaction, which Prisma rolls back automatically — verified by the new "partial CAS and audit failure" test actually exercising this against real Postgres.
2. **Timeout scoping** — correct and minimal. Only the two EXPIRE actions get `timeout: 10_000`; the new unit test (`observed` array assertion) locks this in at the type/behavior level, and the diff shows no change to the shared Prisma client defaults.
3. **Moving no safety read outside the transaction** — appropriate. All reads that establish fence/identity/freshness remain inside the Serializable transaction; moving any of them out would reopen a TOCTOU window between validation and the CAS write, which is exactly the invariant the design freeze protects. The 10s budget and 2-saved-round-trips are a reasonable, minimal availability tuning, not a safety loosening.
4. **Residual uncertainty on 10s adequacy** — this is a tuning/availability risk, not a correctness regression: if real Production lock contention regularly exceeds 10s, operators get `P2028`/fail-closed again (safe) but recovery stays blocked longer. This is acceptable per the stated priority (fail-closed over fail-open) but worth monitoring once FIELD evidence exists.
5. **Compensation proposal's open authentication question** — the SEALED-DRAFT doesn't yet specify how `founderExactContentApproval` would be cryptographically bound/signed to prevent a forged or loosely-worded "approval" from being conflated with this timeout fix's SHA. This must be closed before any implementation task, per the proposal's own framing.
6. **Admission-gate/CORE blocking is a release concern, not a code concern** — the Cashier frozen-boundary registry will need an explicit, Founder-approved successor entry for the new `service.ts` hash before merge; this is orthogonal to whether the code is correct.

## 7. Acceptance Recommendation
Accept the code candidate as **technically correct and scope-compliant** for `service.ts` + its test. Minimum safe next action, without deployment authority:
1. Prepare and have Founder approve the exact frozen-successor registry entry admitting `service.ts` SHA256 `b8f770...8` into the Cashier/Diamond boundary test (same pattern as `ES-DIAMOND-P0-FOUNDER-QUEUE-RECOVERY-01.md`), so CORE can move from `BLOCKED` to a clean lane result without loosening any check.
2. Keep the compensation mechanism strictly as a SEALED-DRAFT; any future implementation task must independently review how the Founder approval of that JSON is authenticated and bound to a specific candidate SHA before writing any runtime code.
3. Do not infer from this review that printing is ready — mode remains `BLOCKED_UNKNOWN` in Production and the one-time REVIEW grant remains consumed/expired; a fresh, separately-authorized compensation grant and FIELD evidence are still required before any EXPIRE/REVIEW/FINALIZE is executed live.

## 8. Reviewer Declaration
- **Materials actually read:** `BINDINGS.json`, `REVIEW-BRIEF.md`, `TASK-STATE.md`, `VERIFY-CANDIDATE.py` (source), both full `service.ts` files (candidate and parent, lines 1–890/881 inspected in relevant sections plus a full `diff`), `evidence/EXACT-PRODUCT-DIFF.patch`, `evidence/VALIDATION-RESULTS.json`, `evidence/CANDIDATE-SCOPE.log`, `evidence/BASELINE-COMPARISON.json`, `evidence/RELEASE-LINEAGE.log`, `evidence/targeted-tests.log` (full), `evidence/baseline-customer-order-recovery.test.log`, `evidence/baseline-cashier-realtime-integration.test.log`, `evidence/core/core/summary.json` (full), `evidence/core/core/root-core-suite.log` (cashier-failure excerpt), `candidate/lib/v3-print-job-adapter.ts` (relevant sections), `candidate/docs/change-gates/gate-config.json`, `candidate/docs/freezes/*.md`, `candidate/docs/diamond/.../CANDIDATE-MANIFEST.json`, `ROOT-CAUSE-AND-MINIMAL-FIX.md`, `RELEASE-AND-ROLLBACK-PLAN.md`, `ONE-TIME-COMPENSATION-SEALED-DRAFT.json`, `ONE-TIME-COMPENSATION-PROPOSAL.md`.
- **No shared implementer conversation** was provided or consulted; all conclusions are from the materials above.
- **Files modified: none. External actions: none.** Only `python3 -B VERIFY-CANDIDATE.py` and local read-only `Bash`/`Read`/`Grep` were run inside this working directory (diff/grep/wc on copied files, no network, no live API, no install, no FIELD/print).
- **Verifier result:** `{"result": "PASS", ...}` (full JSON captured above in tool output).
- **Verified vs. inference:** Scope compliance, predicate equivalence, timeout boundedness, and the two CORE failures' unrelatedness to this diff are **verified** by direct source/log inspection. Production's exact 5775ms lock/query/network split, and whether 10s is sufficient under real future load, remain **explicitly unknown/inferred** per the task's own disclosure — I did not claim certainty there. No FIELD action, legal grant activation, or Production state change is claimed or was performed.
