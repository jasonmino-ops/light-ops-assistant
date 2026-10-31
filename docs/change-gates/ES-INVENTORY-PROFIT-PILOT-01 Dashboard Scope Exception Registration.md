# ES-INVENTORY-PROFIT-PILOT-01 Dashboard Scope Exception Registration

## Governance and authorization

This is an L3 governance-only registration prepared under the Founder Implementation Authorization for `ES-INVENTORY-PROFIT-PILOT-01`. The verified development baseline is `db88c10ca8ee33e63b22b3f92f231b67c1c14bb5`; Production is `cca61da1e3ab7f604359e827362f1d0d7c305460`; Release Lineage was rechecked as STRICT PASS before implementation.

This local registration changes only this document and `docs/change-gates/exceptions/ES-INVENTORY-PROFIT-PILOT-01.json`. It contains no runtime, build, dependency, database, CI or platform change. It does not use the docs-only lineage exception: the production identity and lineage were explicitly checked.

## Exact sealed candidate

The protected path is exactly `app/dashboard/page.tsx` on feature branch `codex/es-inventory-profit-pilot-01`.

- Base file SHA-256: `e929b9a7bb2903d3cf1a7cc456ddbb8d22fe82831d77894057950f52818a6968`.
- Resulting file SHA-256: `084df25056a4081e1efa3f9a08703ecdf2ec299e82a3d886ed621d02d1f52e63`.
- Sealed patch SHA-256: `fdd35288c0e107c4a1f2b5417cf467757b32bba339b9329f67d7cff826aa01ea`.
- Diff: 2 insertions, 0 deletions.

The two additions are limited to importing `SalesProfitEntry` and rendering it under the existing `realRole === 'OWNER'` condition. Dashboard Summary, permission logic, existing cards, main layout and every other Dashboard behavior remain unchanged. Any byte drift requires a renewed Founder Gate.

## Activation boundary

The ACTIVE record grants nothing while it exists only on this local governance branch. The current Scope Guard requires the byte-identical record to exist in trusted `origin/main`; it also checks the task ID, feature branch, approved baseline ancestry, exact path and resulting content hash.

The current authorization expressly excludes push, merge to main, Preview or Production deployment, Production environment changes, Google activation, release, FIELD VERIFIED, FINAL FROZEN and CLOSED. Therefore this package must stop after local validation, commit and independent read-only review. A separate Founder authorization is required to integrate this governance-only record into `origin/main`. Only after trusted activation may the sealed Dashboard patch be applied to the feature branch.

## Required validation

Validate the exception with the current Guard schema, recompute all sealed hashes, confirm the exact `+2/-0` diff, run the Scope Guard regression suite, run Scope Guard on the two governance files, check whitespace and obtain a fresh-context independent review. No protected application file may be changed in this governance worktree.
