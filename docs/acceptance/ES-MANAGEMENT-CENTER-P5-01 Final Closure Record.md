# ES-MANAGEMENT-CENTER-P5-01 Final Closure Record

## Closure status

```text
P5-01 IMPLEMENTED = YES
P5-01 FIELD CORRECTIVE IMPLEMENTED = YES
PRODUCTION = YES (selective P5-only release)
FIELD VERIFIED = YES (Founder, real Production, V727)
FINAL FROZEN = YES
CLOSED = YES
MIGRATION = NO
```

This is a governance/evidence-only closure record. It changes no business
code, no release pointer and no Production deployment. It authorizes no
further ES-MANAGEMENT-CENTER-P5-01 development; P5-01 is not extended.

## Delivery identity

| Item | Evidence |
| --- | --- |
| Task | `ES-MANAGEMENT-CENTER-P5-01` (Management Center successor, L2 Web UI) |
| P5-01 integration | `201756d8d2407aafc5bcd67d95e558c5b7ff5eb8` (Customers & coupons, Campaigns, Computers & Desktop activation, Print job records entries + return context) |
| Desktop OWNER dependency | `ES-DESKTOP-OWNER-WEB-SESSION-01`, `393b2f65` / merge `42992ffae1a122c152d336d5d55dff8fa39bfcfa` |
| FIELD navigation corrective (main) | `fe5958650e88db820c93dd4e6ffed06c22b3a1ba` + `c62080094ca051d0161b9c02d294726579b7fac0` (Records hash evidence), merge `8b1d75d78a9b4d21392adc3a4dd99a58c220be35`, exception closed in `dfa155642ccce7448ed3cd01f78916c09fca9f70` |
| Production base before this release | `42992ffae1a122c152d336d5d55dff8fa39bfcfa` |
| Production release candidate | `a242e3b7e8c03fade6c060fc340d818f9d4e97d7` (branch `codex/es-management-center-p5-01-release-p5-only`) |
| Candidate commits | `4408d25` cherry-pick of `fe595865`; `a242e3b` cherry-pick of `c6208009` |
| Release update | `release 42992ffa → a242e3b7`, atomic fast-forward push, no force |
| Production deployment | GitHub deployment `6689885177`, environment `Production – light-ops-assistant`, state `success` (2026-09-27T08:20:44Z) |
| Production SHA | `a242e3b7e8c03fade6c060fc340d818f9d4e97d7` |
| Trusted `origin/main` at closure | `dfa155642ccce7448ed3cd01f78916c09fca9f70` |
| Governance Closure SHA | The commit containing this record; reported after promotion |

## Selective-release provenance (Founder decision)

Release model: `main` = integration line; `release` = approved Production line.

The FIELD corrective reached `main` after three Printing commits that have no
Printing Production (FG-3) authorization. Founder therefore approved a
P5-only release candidate built on the Production base by standard cherry-pick
instead of fast-forwarding `release` to `main`:

- Exact release diff `42992ffa..a242e3b7` (5 files, +54 / −7):
  `app/management/page.tsx`, `app/products/page.tsx`, `app/records/page.tsx`,
  `tests/management-center-static.test.cjs`,
  `tests/v3-reprint-recovery.test.ts` (single Records hash line).
- These 5 files are byte-identical to the final P5 bytes on `main` (`dfa15564`).
- `app/records/page.tsx` SHA-256
  `48efc97f9b77dd63bed22fb0e3b69e44bf13ababbad3a8956cf39a6426912a22` = the
  Founder-sealed candidate of `ES-MANAGEMENT-CENTER-P5-01-FIELD-NAV`
  (pre-change `3660f5b4…`, patch `ecf037f0…`). The release carries the
  byte-identical Founder-approved protected-file result already integrated into
  main; this is release provenance verification, not a new Records
  development authorization. No additional exception was created.
- Excluded from Production (not ancestors of `a242e3b7`; their files are
  byte-identical to `42992ffa`):
  `296cbf3b` (V3 HELD persistence scope), `5681b88d` (HOLD_LOCAL admission P1
  merge), `d772ff33` (V3 reprint delivery claims). Printing V3 was not carried
  by this release.
- `a242e3b7` is a fast-forward descendant of `42992ffa`; it is intentionally
  not an ancestor of `main`. No lineage-only merge, registration-only merge or
  additional governance layer was created for ancestry form. `main − release`
  equals exactly the Printing diff `42992ffa..d772ff33` plus the FIELD-NAV
  exception evidence file.
- Superseded local candidates (`8b7262e6`, `d95fc16d`) were never pushed.

## Verification

Release candidate (before deployment):

- Scope: zero schema / migration, `desktop/`, `lib/`, `app/api`, Cashier,
  OWNER Web Session, Desktop runtime or Records business-logic changes.
- `git diff --check`: PASS. tsc: 0 errors. Build: PASS.
- `test:core`: 87 PASS, 0 new failures (only the known date-dependent
  `subscription-expiry-reminder`, identical on Production base).
- Static: management-center, management-legacy-navigation, settings-center,
  desktop-owner-web-session: PASS. `v3-reprint-recovery`: PASS.
- Browser and simulated Desktop smoke (OWNER): FIELD navigation PASS; all other
  cases identical to the Production base per role.
- Independent release review: APPROVE WITH NOTES (no blocker).
- Deployment pre-checks re-run at push time: all PASS; migration = NO.

Founder FIELD (real Production, V727), 2026-09-27 — all PASS:

1. Desktop Management Center shows OWNER / 老板.
2. Management → Products → top-left return to Management.
3. Management → Records → top-left return to Management.
4. Cashier → Records → existing 返回收银台.
5. 顾客与优惠券 enter / return.
6. 推广活动 enter / return.
7. 电脑与 Desktop 激活 enter / return.
8. 打印任务记录 enter / return.
9. Existing Management Center entries regression.

The Desktop OWNER dependency (Desktop Management previously resolving as STAFF)
is resolved by `ES-DESKTOP-OWNER-WEB-SESSION-01` and field-verified here as a
P5-01 dependency. This record does not close `ES-DESKTOP-OWNER-WEB-SESSION-01`
itself.

This FIELD verification covers Web UI navigation only; it is not claimed as
printer, Printing V3 or Runtime FIELD verification.

## Known limitations and DEFER (not reopened)

ES-DESKTOP-OWNER-WEB-SESSION-01 accepted limitations (Founder 方案 A), tracked
in that task, not in P5-01:

- up to 12 h validity of an issued `auth-session` after Desktop revocation;
- standard `auth-session` has no server-side expiry or device binding;
- a renderer-held Desktop POS token can mint an OWNER web session;
- multi-OWNER store selection uses `findFirst`;
- no rate limit on denial audits;
- N1 remains an observation only.

Other independent items:

- `ES-DESKTOP-OWNER-WEB-SESSION-01` separate closure record: pending.
- P6A Settings Founder acceptance: pending (separate record).
- Printing line (`296cbf3`, `5681b88`, `d772ff3`): requires its own review,
  FIELD and FG-3 Production authorization. When approved, `release` must take
  `main` through a normal merge (release is not an ancestor of main); no
  force-push and no history rewrite.
- Stale ACTIVE exception `ES-PRODUCT-SALES-REPORT-01`: hygiene item, not P5-01.
- Historical P5 evidence gaps (real STAFF session, Desktop hold/resume) remain
  as recorded in the ES-DESKTOP-UX-01 P5 closure.

## Rollback

Rollback target: Production base `42992ffae1a122c152d336d5d55dff8fa39bfcfa`.
Per Founder rule, rollback is by a minimal revert commit on the release line
under separate Founder rollback authorization, not by force-resetting
`release`.

## Governance closure and boundary

- `ES-MANAGEMENT-CENTER-P5-01-FIELD-NAV` exception: already `CLOSED`
  (`dfa15564`); cannot authorize future Records changes.
- No Business Code, release pointer or Production deployment is changed by
  this record.
- ES-MANAGEMENT-CENTER-P5-01: `FIELD VERIFIED / FINAL FROZEN / CLOSED`.
  Next authorized P5-01 work: `NONE`.
