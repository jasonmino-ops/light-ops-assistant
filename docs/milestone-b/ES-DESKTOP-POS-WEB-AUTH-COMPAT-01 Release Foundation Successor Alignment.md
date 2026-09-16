# ES-DESKTOP-POS-WEB-AUTH-COMPAT-01 Release Foundation Successor Alignment

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-POS-WEB-AUTH-COMPAT-01` |
| Action | Minimal exact Release Foundation successor alignment |
| Founder authorization | `APPROVE` |
| Starting `origin/main` | `0934b1b8ac09d0780ee7775c254778dc83c3f8c3` |
| Trusted governance main before final scope amendment | `2021db3b646987a77cb1c70e64f95607dc9a20da` |
| Immutable Product Candidate | `20d9eb89e3957520605e69127dd59d137528e5a9` |
| Frozen group | `cashier/customer/mobile business` |
| Production change | `NO` |
| P1A | `FINAL FROZEN / CLOSED` |
| P1B | `NOT STARTED` |

This record covers only the Founder-approved compatibility correction that lets the Desktop POS route reuse the existing Browser POS device-authorization flow. It does not reopen P1A, authorize P1B, deploy Production, or introduce a new authorization architecture.

## Authorized Successor Basis

The Product Candidate changes the frozen path `app/cashier/page.tsx` so `/desktop/pos`, `from=desktop`, and `deviceAuth=1` enter the existing POS device-authorization flow. The accepted behavior is limited to four conditions:

1. Desktop POS probes the existing `/api/cashier/access` authorization state instead of treating the Desktop Activation credential as POS business authorization.
2. A missing or explicitly rejected POS device token enters the existing QR authorization flow without Telegram relogin.
3. A verified POS device token authorizes the cashier; explicit `401` or `403` clears the stale token and returns to QR authorization.
4. Existing cached-token offline tolerance and Browser OWNER/STAFF behavior remain unchanged.

The Candidate reuses existing endpoints, token storage, QR approval, cashier access checks, and Computer Client behavior. It adds no API, schema, migration, Desktop IPC, Desktop product code, credential semantic, RC9/Printing change, or third authorization system.

The focused runtime test is registered in the root integration-test manifest as `LOCAL_RUNTIME_BROWSER`. The hash-bound Scope Guard exception is carried by trusted governance lineage beginning at `2021db3b646987a77cb1c70e64f95607dc9a20da` and accepts only these exact reviewed bytes:

- `app/cashier/page.tsx` — `a0c3bb2736f77874b2a682256ad19af6e1a7f6b0861a5181d9a91bdec048d4e9`
- `tests/desktop-pos-web-auth-compat.test.ts` — `b73f2c7ff72a12f34c8e7bf8031948f95e479485f93a24917eda8e9925ed2c35`
- `tests/es-tray-device-print-contract.test.ts` — `1fad70a416c904627feab6a20393699843a90b37359d8cc31961f096d61f5753`

The third path is authorized solely to synchronize its exact Cashier SHA-256 assertion with the reviewed Cashier bytes `a0c3bb2736f77874b2a682256ad19af6e1a7f6b0861a5181d9a91bdec048d4e9`. It changes no print-contract behavior, RC9/Printing implementation, or assertion strength.

## Exact Frozen-Boundary Delta

The successor snapshot is the immutable Product Candidate:

`20d9eb89e3957520605e69127dd59d137528e5a9`

Within the `cashier/customer/mobile business` frozen group, its only product-code delta is `app/cashier/page.tsx`. The Candidate also contains its focused test and exact test-manifest registration. No other frozen group is changed by this task.

The two existing successor registrations remain semantically unchanged:

| Frozen group | Existing successor snapshot |
| --- | --- |
| `main startup gate` | `17c764427f1e53288dedb82a1965b1365c1ded3d` |
| `WindowManager` | `17c764427f1e53288dedb82a1965b1365c1ded3d` |

This alignment adds exactly the third group-to-snapshot registration above. The successor is not Candidate self-comparison: the final governance Candidate must descend from immutable implementation snapshot `20d9eb89...`, while the executable policy compares the current frozen-group bytes with that earlier exact snapshot.

## Gate Strength Preservation

The alignment does not change:

- any frozen group or protected path;
- baseline or freeze semantics;
- exact-path comparison behavior;
- failure semantics;
- release-asset or provenance validation;
- any general allowlist, wildcard, bypass, or exception shortcut.

Unknown future bytes, including any later cashier, P1A, or P1B change, remain unaccepted and fail the unchanged gate.

## Security Debt Boundary

This task does not alter the separately deferred existing POS-device authorization debt, including legacy token lifetime/delivery, public status/start surfaces, device-revocation coupling, or the read-only store-code fallback. Those findings are neither fixed nor broadened by this successor alignment.

## Required Validation

Before the Candidate may be handed to the Founder, all of the following must pass on the exact final bytes:

- Release Foundation focused tests and default policy;
- Scope Guard using the active hash-bound exception;
- focused Desktop POS Web authorization compatibility tests;
- required Browser/cashier regressions and the exact print-contract suite;
- TypeScript and Production build;
- fresh-context independent review.

The authoritative results are the command evidence and final task report; this record does not pre-claim them.

## Stop Boundary

This alignment authorizes no Product merge, Production deployment, V727 action, P1A reopening, P1B start, or unrelated correction. After all required gates pass, the task stops at a local release Candidate awaiting a separate Founder merge/deploy decision.

## Final Disposition

The exact feature merged as `7d9dae4c1d3a61672a1f49bd32327eb14ccd9c8a`. Founder subsequently classified this capability `CLOSED-AS-FALLBACK`: it remains available for Browser fallback, Desktop recovery fallback, and legacy migration fallback, but it is not the normal one-computer/one-OWNER-authorization Desktop flow. The consumed Scope Guard exception closed at `2026-09-16T14:04:45Z`; the exact Release Foundation successor snapshot remains unchanged as historical frozen evidence.
