# ES-DESKTOP-NEW-PC-RUNTIME-START-FAILURE-01 / M1 Release Foundation Successor Alignment

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-NEW-PC-RUNTIME-START-FAILURE-01 / M1` |
| Action | `RELEASE FOUNDATION SUCCESSOR ALIGNMENT — DRAFT / PENDING` |
| Risk | `L3 / FINAL-FROZEN Desktop Runtime boundary` |
| Founder authorization | Formal successor-governance authorization supplied in the task instruction |
| Starting trusted `origin/main` | `0d5e221aaec8a325a71372591c39e4fdb4c914a3` |
| Starting Production | `a35b2e88c372f79b8ce2614306ab92f13c6a3e58` / `READY FOR LINEAGE` |
| Prior historical freeze anchor | `439dcac561734d07b9e022c8d99e693c99d26794` |
| Immutable M1 candidate | `227146b9e215e1441082c04e8941de8611592226` |
| Successor registry snapshot | `227146b9e215e1441082c04e8941de8611592226` |
| Production change | `NO` |
| Windows FIELD | `NOT VERIFIED` |

This is a narrow executable Release Foundation alignment. It does not overwrite the EP-MB3-07A Final Freeze Record or Desktop Milestone A freeze, and does not authorize merge, push, deployment, installer release, V727, or FIELD.

## Actual Gate Failure Classification

The prior default comparison anchor is historical (`439dcac...`) while trusted `origin/main` is now `0d5e221a...`. The current M1 candidate is based on that trusted `origin/main`. The historical comparison therefore reports pre-existing mainline drift in addition to the current M1 delta.

For this task, the candidate delta from the Founder-authorized trusted baseline is limited to:

| Frozen group | Candidate path | Disposition |
| --- | --- | --- |
| `ActivationRuntime` | `desktop/src/main/activation/activationRuntime.ts` | `AUTHORIZED M1 SUCCESSOR` |
| `main startup gate` | `desktop/src/main/main.ts` | `AUTHORIZED M1 SUCCESSOR` |

No Prisma, Payment, Scanner, cashier/customer/mobile, Provider, Installer, database, or other product delta is introduced by this candidate. Those paths remain outside this task's authorized candidate binding.

## Exact Candidate Binding

| Candidate path | SHA-256 |
| --- | --- |
| `desktop/src/main/activation/activationRuntime.ts` | `5e1ad55a7fb29a5c96c8fef0455cbdcdcdb8a07ff2d1db512aa1e6cf1e85a44b` |
| `desktop/src/main/main.ts` | `ae6dc84429ccb32e79586c7d92dda451465af6bfac86ae4dd6e9f8e5cd4ea2a9` |
| `desktop/tests/activation-state-machine.test.ts` | `f62bdee02fe4d24ce566fcf249c224b45ef82d8fd146139681dbb6041e1e7821` |
| `desktop/tests/authorized-runtime-start.test.ts` | `0a03c4d61d2c2c8f9b401095ad8def108ceb8e1bc1c7741e4d1af4049a087f23` |

The four hashes are the Founder-authorized immutable-intent binding. No candidate commit SHA is claimed before local commit preparation.

## Minimal Durable Alignment

The executable alignment will:

1. advance the default frozen comparison anchor from the historical `439dcac...` to the Founder-authorized trusted `origin/main` SHA `0d5e221aaec8a325a71372591c39e4fdb4c914a3`;
2. register the exact immutable M1 candidate snapshot `227146b9e215e1441082c04e8941de8611592226` for `ActivationRuntime`;
3. advance the existing `main startup gate` successor entry to `227146b9e215e1441082c04e8941de8611592226`;
4. update only the corresponding governance test expectation.

This changes no frozen group definition, protected path, exact `git diff --name-only` operation, failure condition, release-asset allowlist, provenance invariant, security check, or general exception. Explicit comparison against the historical anchor remains fail-closed and is retained as a regression assertion.

## Historical Anchor Advance — Corrective Provenance Register

The advance from historical anchor `439dcac561734d07b9e022c8d99e693c99d26794` to trusted anchor `0d5e221aaec8a325a71372591c39e4fdb4c914a3` is not a neutral metadata update. The following machine-derived inventory records the frozen-path changes present in that interval and their governing evidence.

| Frozen group | Exact paths / state | Governing evidence and status |
| --- | --- | --- |
| `main startup gate` | `desktop/src/main/main.ts` | `17c764427f1e53288dedb82a1965b1365c1ded3d` launch-context successor plus V3 records; current bytes exact to registered `5756a4476f36f0d847835fd3ea83679240c86856` successor; known and safe |
| `WindowManager` | `desktop/src/main/windowManager.ts` | `17c764427f1e53288dedb82a1965b1365c1ded3d` / `ES-DESKTOP-ACTIVATION-LAUNCH-CONTEXT-FIX-01`; current bytes exact to registered successor; known and safe |
| `Prisma` | `prisma/migrations/20260919090000_add_computer_binding_network_mode_snapshot/migration.sql`; `prisma/migrations/20260923022000_add_v3_print_control_plane/migration.sql`; `prisma/migrations/20261005120000_add_customer_order_fulfillment_intent/migration.sql`; `prisma/migrations/20261006160000_add_customer_order_render_dispatch/migration.sql`; `prisma/migrations/20261007090000_add_customer_order_submission_idempotency/migration.sql`; `prisma/migrations/20261009090000_add_customer_order_fulfillment_purpose/migration.sql`; `prisma/migrations/20261010_es_dine_in_01/migration.sql`; `prisma/schema.prisma` | `dd7121b554b41bbddecaa7f0fd6cf3cb3acfa5ff` canonical print, `cb55c5a9e78cb7f80c8295a0387bb82cb0af8494` V3, `f71bfb590f1cf5766eb3744dfc6b62c121e212af` H5, `bb01c60a6c2705b1cc8cac7956716279baf49dca` H5 three-ticket, and `cc65d46c82aafd3e91888554d5c9d4a97b1c39be` ES-DINE-IN records; known and safe as existing mainline state |
| `Payment` | `app/api/orders/[orderNo]/cancel/route.ts`; `app/api/orders/[orderNo]/checkout/route.ts` | `cc65d46c82aafd3e91888554d5c9d4a97b1c39be` / ES-DINE-IN exception, acceptance, and freeze records; known and safe as existing mainline state |
| `Scanner` | `app/sale/page.tsx` | `8317b4c2bd0ee0a90b7df4b2fe64b3489ebd6a99` / ES-PRODUCT-SKU-SEARCH-01 CLOSED records; current bytes exact to registered successor; known and safe |
| `cashier/customer/mobile business` | `app/cashier/page.tsx`; `app/home/computer-client/page.tsx`; `app/home/page.tsx`; `app/menu/page.tsx`; `app/records/page.tsx` | Cashier/H5/Dine-in/P5 records cover the known changes. `app/home/page.tsx` is separately bound by `ES-HISTORICAL-HOME-GOVERNANCE-REMEDIATION-01`: the original `1b64504979136a150a8de215f273fbfeee0fc02b` change remains `HISTORICAL EXACT-PATH VIOLATION = CONFIRMED`; Founder Option A accepts only the current exact hash `b031e438b5384c1f2cbb2c903c685ae8e20a6b6dd82f6f904e34a5603b05b8a2` as the new governed state. |

The non-drifting groups in this anchor comparison are `ActivationRuntime`, `CredentialStore`, `Runtime Core`, `Provider Contract`, and `Printer`. The M1 `ActivationRuntime` and `main startup gate` changes are separately bound to immutable candidate `227146b9e215e1441082c04e8941de8611592226`.

After the independent home remediation record is included, `UNKNOWN absorbed drift = 0` and `CONFLICTING absorbed drift = 0`. This does not erase the historical violation or authorize unrelated changes. The original historical-anchor comparison remains fail-closed; the executable baseline remains the trusted `0d5e...` snapshot.

## Required Validation

After the immutable candidate and alignment metadata exist:

- Release Foundation policy and release-foundation tests;
- M1 focused tests and Desktop full suite;
- TypeScript and compile;
- Scope Guard;
- Release Lineage;
- exact four-file SHA-256 verification;
- diff audit and fresh-context independent review package.

No result is pre-claimed by this draft.

## Stop Boundary

The maximum outcome is a local successor candidate with a LOCAL COMMIT. Push, merge, deployment, Production promotion, installer release, V727, Windows FIELD, FINAL FROZEN, and CLOSED remain prohibited.
