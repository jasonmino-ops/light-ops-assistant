# ES-DESKTOP-UX-01 / P2 Candidate Evidence

Status: `CANDIDATE / PRE-FIELD READY` — no Production deployment, FIELD verification, final freeze or closure.

## Lineage and authorization

- Starting trusted `origin/main`: `122b37e3f2c589fc0aacad55d26b01b6f0773d1c`.
- Production SHA used for lineage: `b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4`.
- Release Lineage Gate: `PASS`.
- Governance-only Scope Exception commit: `150524da711bbb886afed086064ad1965b6d80d7`.
- Verified new `origin/main`: `150524da711bbb886afed086064ad1965b6d80d7`.
- Exception: `ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION`, `ACTIVE`.
- Exact protected path: `app/cashier/page.tsx`.
- Baseline protected SHA-256: `a0c3bb2736f77874b2a682256ad19af6e1a7f6b0861a5181d9a91bdec048d4e9`.
- Authorized candidate protected SHA-256: `01e2b3d4487a2aff983acc9e6b0d33acb4aa44cf9a8fd508956a5f3760ece099`.

## Implementation

- Branch: `codex/es-desktop-ux-01-p2-cashier-minimal-simplification`.
- Implementation commit: `508f82bcc75241a9e5fc334f54c8be551b1b5419`.
- Regression-fixture commit: `883df1a7ddc4141c6af739f091d3db3cd8428589`.
- Final candidate tip after this evidence record: recorded by the commit containing this file.
- Changed files: `app/cashier/page.tsx`, `tests/browser-pos-customer-display-entry.test.ts`, and one exact Cashier SHA fixture line in `tests/es-tray-device-print-contract.test.ts`.
- Runtime implementation change: only conditional presentation visibility. No Cashier business, Order, Payment, offline/sync, authorization, Activation, Customer Display business, P1A/P1B, Printing source, schema, migration, API, dependency or redesign change.

## Required behavior

- Desktop hides `安装到电脑` / `Install to PC` and `打开顾客屏` / `Open Customer Display`.
- Desktop collapses only the technical `cacheText` detail.
- Desktop retains language, Management Center navigation, fullscreen control, network/offline status, pending offline count and existing sync capability.
- Browser retains both install and customer-display controls and the existing customer-display route/fallback.

## Verification

- Exact-hash Scope Guard with task ID: `PASS`.
- `git diff --check`: `PASS`.
- Focused Browser customer-display/P2 contract: `PASS`.
- Cashier Browser UI regression: `10 passed`.
- Root CORE: `74/74` collected, `73 passed`, `0 new failures`; overall runner `PASS` with one pre-registered known failure `KTF-20260912-07`.
- Printing/device contract regression: `35 cases passed`; only its Cashier exact-hash fixture was updated, Printing source is unchanged.
- Browser order-sync static, Desktop compatibility static, Cashier realtime and QZ/Printing static contracts: `PASS`.
- TypeScript check: `PASS` after generating the locked Prisma client with the local test `DATABASE_URL`.
- Next production build: `PASS` (180 static pages generated).
- Independent review: `PASS`; fresh read-only review confirmed the exact three-file diff, protected hash, scope and unchanged prohibited source areas.
- P1A/P1B boundary: `PASS` by unchanged Desktop source boundary; no `desktop/` file changed. P1B remains implementation frozen and dual-display FIELD deferred for hardware.

## Stop state

- Production deploy/promotion: `NO`.
- FIELD VERIFIED: `NO`.
- FINAL FROZEN: `NO`.
- P1A reopened: `NO`.
- P1B reopened: `NO`.
- P2 scope drift: `NO`.
- Remaining Founder action: perform the controlled P2 FIELD checklist on an approved Windows target; decide separately on merge/release/Production promotion after FIELD evidence. The existing Desktop auth runtime test requiring `DESKTOP_POS_AUTH_RUNTIME_BASE_URL` was not run live because no local runtime URL was supplied; its static checks passed.
