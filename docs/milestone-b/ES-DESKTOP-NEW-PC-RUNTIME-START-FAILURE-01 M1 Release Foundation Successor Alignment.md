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
