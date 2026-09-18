# ES-DESKTOP-UX-01 / P2 Browser Environment Predicate Corrective Fix

## Source Acceptance Record

- Task: `ES-DESKTOP-UX-01-P2-BROWSER-PREDICATE-FIX`
- Delivery classification: `WEB`
- Risk class: `L3` governance/runtime boundary because the protected Cashier path, trusted integration, and authorized Production Web delivery are involved.
- Starting `origin/main`: `294d22f644827ddbc44ba0aa6b6916da90146d46`
- Trusted governance `origin/main` before implementation: `1ab32d9841f79eab1ca54544e3d1840450479ed9`
- Implementation commit: `a9e9712b09bc209e7121e2f0a8081e2fa469ec56`
- Production SHA used for lineage: `4d177a8b507aaa8bdccb0abf8677df71fcbe789b`
- Scope Exception: `ES-DESKTOP-UX-01-P2-BROWSER-PREDICATE-FIX`, `ACTIVE`, exact path `app/cashier/page.tsx`
- Authorized raw SHA-256 for `app/cashier/page.tsx`: `9fe763b6a1f59d934bd5fdafef5bd234061d9a9b42faae339a799c94f50ee410`

## Accepted Change

The Desktop predicate now recognizes only the explicit `/desktop/pos` pathname.
Normal Browser `/cashier` remains Browser mode. Desktop-only visibility remains
unchanged: Desktop hides `安装到电脑`, `打开顾客屏`, and the technical cache
detail; Browser retains the existing controls and customer-display fallback.

No business, Offline/Sync, authorization, Activation, Customer Display business,
Desktop Shell, P1A, P1B, P3-B, Printing/RC9/RC10, schema, migration, API,
dependency, or visual redesign change was made. The one-line Cashier hash fixture
update in `tests/es-tray-device-print-contract.test.ts` only tracks the newly
authorized exact Cashier bytes; Printing runtime/source is unchanged.

## Verification

- Release Lineage Gate: `PASS` — Production is an ancestor of trusted `origin/main`; clean working tree.
- Exact-hash Scope Guard with task ID: `PASS`.
- Default Scope Guard fail-closed behavior: preserved and covered by the 70 governance tests.
- `git diff --check`: `PASS`.
- Focused Browser predicate/customer-display regression: `PASS`.
- Existing Desktop POS, Customer Display, tray/printing contract, and auth runtime regressions: `PASS`.
- Root CORE: `75/75` collected, `74` passed, `0` new failures, `1` pre-registered known failure: `PASS`.
- Typecheck: `PASS`.
- Production build: `PASS` — 180 static pages generated.
- Scope Guard tests: `70/70 PASS`.
- Root-suite governance tests: `29/29 PASS`.
- Fresh-context Independent Review: `PASS` — predicate, scope, test-only hash fixture distinction, and prohibited-source boundaries reviewed.

## Status

- Source Acceptance: `SOURCE ACCEPTED`
- Trusted source integration: authorized and pending completion.
- Production Web deployment: authorized after final integration gates; not yet performed by this record.
- P2 FIELD VERIFIED: `NO`.
- P3-B FIELD VERIFIED: `NO`.
- FINAL FROZEN: `NO`.
- Desktop installer / NSIS / Provider / V727 reinstall: `NOT REQUIRED`.
