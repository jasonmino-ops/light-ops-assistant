# ES-DESKTOP-UX-01 / P6A Settings — Repository Acceptance Record

## Status

```text
P6A IMPLEMENTED            = YES
P6A IN origin/main         = YES
P6A IN PRODUCTION          = YES
REPOSITORY EVIDENCE        = RECORDED (this record)
FOUNDER ACCEPTANCE         = PENDING
FIELD VERIFIED             = NOT CLAIMED
FINAL FROZEN               = NO
CLOSED                     = NO
```

This is a governance/evidence-only record. It fills the missing
acceptance evidence for the P6A Settings product that is already in
`origin/main` and Production. It changes no product file, authorizes no
further development, and does not start P6B, P6C, P7, or P8. P6A may be
declared `FINAL FROZEN` / `CLOSED` only by a later explicit Founder
acceptance that references this record.

Authorization: Founder Scope Gate for ES-MANAGEMENT-CENTER-P5-01
(2026-09-24): "P6A Settings 的缺失 Acceptance / Closure 可以补齐，但必须作为
独立 governance-only commit，不和 P5-01 Business UI commit 混合." The same
instruction forbids declaring FIELD VERIFIED / FINAL FROZEN / CLOSED without
further explicit authorization; this record therefore stops at repository
acceptance evidence.

## Delivery identity

| Item | Evidence |
| --- | --- |
| Task | `ES-DESKTOP-UX-01 / P6A SETTINGS` |
| Delivery class | L2 Web UI (canonical Settings ownership surface) |
| Product commit | `93c79af0dfeb80ecd14b79b9254ae31288ae2fc8` — feat: add canonical settings center (2026-09-20) |
| Product files | `app/settings/page.tsx` (new), `app/management/page.tsx` (Settings entry), `lib/i18n/{zh,en,km}.ts`, `tests/settings-center-static.test.cjs`, `tests/settings-center-browser.spec.ts` |
| Baseline decisions | `docs/governance/ES-DESKTOP-UX-01-P6A-SETTINGS-PRE-IMPLEMENTATION-BASELINE-RESOLUTION.md` (C-1–C-12, R-1–R-7, D1–D5) |
| Pre-merge review evidence | same record §7 (candidate `93c79af0`, baseline-vs-candidate attribution, related tests, diff review) |
| Landing in `origin/main` | first-parent commit `93c79af0` directly after `f995b423` (no merge commit) |
| First Production containing P6A (recorded) | Product SHA `7c645293…` (`dpl_6XDdRnmBHVFMVvdJqQKi713iTMeX`, see ES-DESKTOP-PRINT-SETTINGS-ENTRY-01 Final Closure Record) |
| Current Production (2026-09-24) | `39269762698656d370ff679da21c45bf3bbf7ccf` — GitHub deployment `6638055706` "Production – light-ops-assistant" by vercel[bot], state `success`; contains `93c79af0` = YES |
| `origin/main` at record time | `0d8d23020e3a6d67c99174633a57691a53fb923d` (Release Lineage Gate PASS against Production `39269762`) |

## Accepted P6A boundary (from D1–D5, verified against current code)

- `/settings` is the canonical Settings Center and is OWNER-only
  (`effectiveRole !== 'OWNER'` → `/home`; APIs use existing OWNER context).
- Store info, payment mode/currency (KHQR editing excluded), language
  (operator Web UI preference only), table-QR entry.
- Printing card is informational; `cashier:autoPrint` is a Desktop-only
  device preference, distinct from network printing.
- Display Settings and Desktop preferences render only on the Desktop
  surface and are read-only; no IPC, preload, Electron or assignment code.
- Dashboard/Cashier legacy settings UI retained (D1); cleanup is separate.
- No API, schema, migration, Electron, IPC, Printing Core, Runtime or
  scope exception in the P6A product commit.

## Verification recorded at `origin/main` `0d8d2302` (2026-09-24)

| Check | Result |
| --- | --- |
| `node tests/settings-center-static.test.cjs` | PASS |
| Settings Playwright spec (2 cases) against local `next dev`, APIs stubbed | 2/2 PASS |
| `tsc --noEmit --incremental false` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:core` | exit 0; 84 PASS; 1 time-dependent FAIL (`subscription-expiry-reminder`) accepted by the runner baseline, not related to Settings |

The 2026-09-20 pre-existing build/typecheck/KTF blockers recorded in the
baseline resolution did not reproduce with a complete dependency install.

## Evidence gaps (not converted to PASS)

- No repository record of an explicit Founder merge authorization for
  `93c79af0` was found; the baseline resolution record states it did not
  authorize merge. Founder confirmation is required for closure.
- Founder product acceptance of `/settings`: PENDING.
- Real V727 / Desktop `/settings` FIELD: NOT CLAIMED (the
  ES-DESKTOP-PRINT-SETTINGS-ENTRY-01 closure explicitly does not claim it;
  Roadmap §19 does not make P6A FIELD mandatory).
- Real Telegram STAFF session redirect: NOT VERIFIED in a real session.
- Known limitation: the Management → Settings entry is the literal
  `/settings#printing` (pinned by `tests/settings-center-static.test.cjs`)
  and carries no Desktop `from=desktop&storeCode` context, so Settings →
  back on Desktop returns to plain `/management`. Changing it requires
  authorization to amend that pinned assertion; deferred.

## Stop point

```text
Business Code Changed = NO (this record)
Database Changed      = NO
Migration             = NO
Push / Merge / Deploy = NO
FIELD                 = NOT CLAIMED
CLOSED                = NO
```
