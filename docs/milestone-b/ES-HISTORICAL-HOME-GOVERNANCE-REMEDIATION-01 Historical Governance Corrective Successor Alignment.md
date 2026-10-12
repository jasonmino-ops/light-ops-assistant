# ES-HISTORICAL-HOME-GOVERNANCE-REMEDIATION-01 Historical Governance Corrective Successor

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-HISTORICAL-HOME-GOVERNANCE-REMEDIATION-01` |
| Related M1 task | `ES-DESKTOP-NEW-PC-RUNTIME-START-FAILURE-01 / M1` — governance reference only |
| Action | `HISTORICAL GOVERNANCE CORRECTIVE SUCCESSOR — LOCAL CANDIDATE` |
| Status | `DRAFT / PENDING — LOCAL GOVERNANCE REMEDIATION CANDIDATE` |
| Founder decision | `OPTION A` — retain current `/dashboard` behavior and current `/home` bytes |
| Trusted current anchor | `0d5e221aaec8a325a71372591c39e4fdb4c914a3` |
| Production change | `NO` |
| Product change in this task | `NO` |

This record is a governance-only remediation. It does not rewrite `TASK-MINO-BOS-001`, does not state that the historical violation was originally authorized, and does not authorize any new product change.

## Historical Violation

The historical commit was:

`1b64504979136a150a8de215f273fbfeee0fc02b`

It changed `app/home/page.tsx` by removing the OWNER-only Mino BOS entry and its four associated style definitions while adding the entry to `app/dashboard/page.tsx`.

At that time, `TASK-MINO-BOS-001` was `ACTIVE` and authorized only:

`app/dashboard/page.tsx`

The same exception explicitly prohibited:

`app/home/page.tsx`

Therefore:

`HISTORICAL EXACT-PATH VIOLATION = CONFIRMED`

The violation remains permanently recorded. This remediation is not retroactive legalization of `1b645049...` or of unrelated Mino changes.

## Founder Current-State Decision

Founder selected Option A and confirmed that the Mino BOS OWNER entry is to remain at `/dashboard`; the `/home` entry is not to be restored.

The current decision accepts the present `/home` bytes as a new governed state only after discovery of the historical violation and through this independent remediation record. It does not expand the original Mino authorization.

## Exact Corrective Successor Binding

| Item | Value |
| --- | --- |
| Exact path | `app/home/page.tsx` |
| Legal predecessor mainline state | `0a276fd173bef42e82bad0af08040b7a701e1577` |
| Predecessor SHA-256 | `a21a2a8a9d86baf21e22bb6493ff3498d83c5830aa8f1c46846083497d190cee` |
| Violating commit | `1b64504979136a150a8de215f273fbfeee0fc02b` |
| Accepted current mainline state | `0d5e221aaec8a325a71372591c39e4fdb4c914a3` |
| Accepted current SHA-256 | `b031e438b5384c1f2cbb2c903c685ae8e20a6b6dd82f6f904e34a5603b05b8a2` |
| Violating/current byte equality | `YES` |

The accepted current hash is bound to this one path only. No other path, commit, or Mino task scope is included.

## Discovery Evidence

The remediation decision followed a Git/object and exact-byte audit of `app/home/page.tsx` from historical anchor `439dcac561734d07b9e022c8d99e693c99d26794` through trusted current anchor `0d5e221aaec8a325a71372591c39e4fdb4c914a3`.

The latest legal `/home` state was the H5 exact candidate in `f71bfb590f1cf5766eb3744dfc6b62c121e212af`, merged by `0a276fd173bef42e82bad0af08040b7a701e1577`. Its exact SHA-256 is the predecessor hash above. The later `1b645049...` bytes are the current `0d5e...` bytes.

The Mino exception's exact binding remains unchanged: it authorizes only the sealed dashboard bytes and explicitly prohibits `/home`.

## Scope and Exclusions

Allowed purpose:

1. Record the historical exact-path violation;
2. Record Founder Option A current-state acceptance;
3. Bind the exact current `app/home/page.tsx` SHA-256 as a one-path corrective successor state.

Explicitly excluded:

- wildcard or directory authorization;
- broad `/home` authorization;
- retroactive expansion of `TASK-MINO-BOS-001`;
- any other Mino commit or path;
- `app/dashboard/page.tsx` changes;
- M1 product/test paths;
- Release Foundation script/test weakening;
- anchor mutation;
- database, Provider, Installer, Production, Push, Merge, Deploy, or FIELD.

## Release Foundation Registry Treatment

No executable Release Foundation registry change is required for this one-path record. The default executable baseline is already the trusted `0d5e...` snapshot. Registering `0d5e...` as the successor for the entire `cashier/customer/mobile business` frozen group would be broader than this exact-path remediation and is therefore prohibited.

The existing group successor registry remains unchanged. The exact path, historical violation, Founder decision, and current hash are governed by this record and the related M1 absorbed-drift inventory.

## Activation and Closure Conditions

This local candidate becomes eligible for independent governance re-review only after:

- the record is included in a local governance-only commit;
- exact predecessor/current byte and SHA-256 verification passes;
- the M1 absorbed-drift inventory records this remediation without `UNKNOWN` or `CONFLICTING` provenance;
- Release Foundation, Scope, Lineage, and clean-worktree checks pass.

This record does not authorize Push, Merge, Deploy, FIELD VERIFIED, FINAL FROZEN, or CLOSED status.
