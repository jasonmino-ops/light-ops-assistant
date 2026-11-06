# Validation and exact CORE admission blocker

Product candidate: `ca7e04ec9d600e568d29258f1e0dc9879c96a72c`. Trusted main: `c1041533abca99657edc09c2e69e2c18d9df13d5`.

## Completed validation
- Targeted real isolated PostgreSQL + contract/readout/adapter: **124 PASS / 0 FAIL / 0 SKIP**. Legacy 5-second expiry reproduces rollback at the audit boundary; identical 5.7-second delay commits with the new 10-second bound. Over-bound timeout, partial CAS, audit failure, replay, claim/report concurrency, expiry and Founder scope negatives remain fail closed.
- TypeScript: PASS (exit 0).
- Build: PASS (exit 0). First build failed from duplicate React copies in the isolated dependency tree; matching the same version/module instance repaired only ignored node_modules. Original failed log retained. No tracked dependency/source change.
- Scope Guard: both product paths ALLOWED, PASS. This does not replace frozen capability admission.
- CORE: **103 collected / 103 executed / 101 PASS / 2 FAIL / 0 SKIP / BLOCKED**. Runner classifies both as newFailures against its own historical baseline. We preserve that classification; no override, manifest/test change, skipped failure or CORE PASS claim.

## Failure 1 — new exact admission failure
`tests/cashier-realtime-integration.test.ts`: assertion “Diamond trusted main may differ only by exact registrations and approved baseline fixes”. Candidate changes the already exact-fingerprint-bound recovery service and its test. On a clean detached trusted-main checkout, the identical frozen test **PASSES**. On this candidate it **FAILS**. This is a candidate-specific admission failure, not an inherited baseline waiver and not proof of a cashier execution regression. Existing guard/registry hashes and task branch predicates do not admit the new two-path content. Full original assertion/path diff is retained in CORE raw log.

Current product SHA256:
- service.ts: `b8f770327615e1e0f258ce2e5eb0e026340d5ef3572f3d82a66bea23d037978a`
- tests/v3-print-control-plane-service.test.ts: `1c62c5e32a3adee1ef7db7be091f9f70175f2290cf54a2f06cf595736c66cb64`

No existing ACTIVE exact-content admission found for this new candidate. No frozen guard, registry, assertions or KTF modified. Before merge/release, Founder must approve an exact successor/admission record under Workflow V1 §6.1–6.2 / ES-ENG-001 frozen capability process. This document is evidence only, **not** an active exception. A future exact registration must be separately scoped and reviewed; do not widen the general cashier allowlist or repurpose old Ops UX disposition.

## Failure 2 — baseline reproducible test fixture defect
`tests/customer-order-recovery.test.ts`: four assertions fail (503 vs 200; retry count 999 vs 1). The test stubs fulfillment/control-plane models but not `eshopTrayPrintJob.findUnique`, now reached by `reviewUnsealedIntentWithJob()` at `lib/customer-order-fulfillment.ts:374`. It attempts the intentionally unreachable synthetic TCP database address; the owned integration fixture listens only on a Unix socket. Same four failures reproduced on clean trusted main with identical synthetic environment. No changed candidate path participates in this route. This establishes baseline attribution in this isolated test environment, not a Production database health assertion. The runner itself still records FAIL / BLOCKED; no formal waiver is claimed or activated.

## Baseline comparison evidence
Separate clean detached worktree `/private/tmp/es-diamond-expire-main-baseline-01`, baseline SHA above. Raw results in evidence `BASELINE-COMPARISON.json` and `baseline-*.test.log`. Initial sandbox-denied IPC attempts retained separately and not counted as test outcomes. Actual unsandboxed runs used only safe synthetic connection information, no Production credentials.

## Release and business status
No merge, push, deployment, REVIEW/EXPIRE/FINALIZE, held release or print performed. New order printing remains blocked by Production BLOCKED_UNKNOWN and consumed/expired one-time review. Timeout fix alone does not renew authority. Adjacent compensation design is proposal only; lawful implementation/activation and fresh evidence are still required.
