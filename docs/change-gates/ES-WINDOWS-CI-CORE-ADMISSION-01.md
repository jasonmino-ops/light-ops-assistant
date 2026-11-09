# ES-WINDOWS-CI-CORE-ADMISSION-01 — exact CORE admission disposition

**SEALED DRAFT — NOT ACTIVE.** Requested authority is the Founder’s exact disposition of a frozen baseline under ES-ENG-001 and Workflow V1 §6.1–6.2. This file records a proposal and evidence. It has no executable effect on CORE, its runner, or release-foundation.

## Exact subject

| Binding | Value |
| --- | --- |
| Windows workflow candidate | `c2cae0621588bba9d5f1be52eb3f1e68d3714119` |
| Candidate tree | `356e0d9dc1b3f3530aa26b6360da5cad6e97398e` |
| Sole parent and reviewed `origin/main` | `d931a77c63b9c080214ab56117123b0230c0c4e2` |
| Reviewed parent tree | `e349c63ee63d62302877cd173559ba355c50131f` |
| Exact binary Git diff SHA-256 | `2d565167a7f16fbcd93ec640240df8e926b8069da397d347938ff5934fb89c0f` |
| Unchanged frozen test SHA-256 | `ccad9c0a1c3fb485871966a4c5aa9fcd7acfe7fdc9f9e567b0ff19d686235b60` |

The candidate changes exactly these two existing paths. The digest for each is the SHA-256 of its candidate Git blob.

| Path | SHA-256 |
| --- | --- |
| `.github/workflows/desktop-release-pilot.yml` | `87c9e1f022229e406365d558873cb8302c677dd022c9a8379645deb7b53de0d3` |
| `.github/workflows/desktop-windows-build.yml` | `e4542f0ffed26056cfc6db95c4dda4a3863f11623703aafc1be5d48a4cb6e04d` |

## Reproduced failure

The unchanged `tests/cashier-realtime-integration.test.ts` passed on the clean reviewed parent and exited 1 on the clean exact candidate. The only candidate failure in this focused test was `ERR_ASSERTION`, operator `deepStrictEqual`, at `assertBoundary` line 285, called from the final fallback at line 819. Expected was `[]`. Actual was exactly the two ordered paths above. The candidate full CORE run remains 103 executed, 101 passed, 2 failed, exit 1, BLOCKED. Its other failure is `tests/customer-order-recovery.test.ts`.

| Evidence | SHA-256 |
| --- | --- |
| Fresh parent focused log, exit 0 | `907ddfab753eb474337fd295cf32cf3900d916fba68c32f600c1ba3673e937d2` |
| Fresh candidate focused log, exit 1 | `a98f4cf0991690471caec6cf902fb611bb0dad700a00311b11fedbc3d329e5b3` |
| Unchanged candidate full CORE log | `ce6a07519af8f54b0b621c357488652a9c8b54525ace398ead43751ed4d657ef` |

Windows run 42558679463 binds the same candidate. Provider tests 3/3 and the single-installer contract 2/2 passed, and the worktree cleanliness diagnostic did not recur. The unit step remains failed on two release-foundation checks. Provider artifact construction and Windows installer construction were skipped.

## Proposed effect, after exact approval only

Record one **RAW FAIL — task-specific two-path admission disposition** for the exact focused failure above. Preserve the assertion, raw output, runner verdict and all other gates. This proposal covers the original candidate by SHA and tree on its pinned base only. It does not cover an integration commit, rebased or cherry-picked candidate, governance document, additional path, mode change, or another failing assertion.

Application requires independent review and an explicit Founder decision on the sealed record. Before application, verify the current trusted base, exact sole parent, candidate tree, path set, Git blob and checkout byte digests, clean index and worktree including untracked files, and absence of skip-worktree or assume-unchanged flags. Reproduce the same focused result with the unchanged test bytes. Any mismatch makes this disposition inapplicable. The proposed window permits one use and ends at `2026-11-16T00:00:00Z` UTC exclusive. This is a proposed cutoff for this record only and carries no authority. There is no automatic extension.

The separately registered USB product successor and its deadline are outside this disposition. Approval of this document would not record CORE PASS, activate an executable grant, authorize a merge, or authorize a release.

## Independent blocker handoff

| Responsibility | Evidence and current state |
| --- | --- |
| Customer order recovery | `tests/customer-order-recovery.test.ts` remains the independent CORE failure on trusted main and this candidate. Route, fixture and business behavior are outside this disposition. |
| Release foundation governance | `release:foundation:policy` still reports Prisma, Payment, Scanner and cashier/customer/mobile business on trusted main and the workflow candidate. The Windows hosted run also preserves its two frozen-policy failures. |
| Historical path governance | The USB integration replay still rejects six CLOSED paths, one DRAFT/PENDING path and one path without a valid grant. All eight stay outside this disposition. |

Windows USB FIELD remains blocked by the lack of a qualified isolated physical printer. This document does not provide a FIELD or ESC-2 result.
