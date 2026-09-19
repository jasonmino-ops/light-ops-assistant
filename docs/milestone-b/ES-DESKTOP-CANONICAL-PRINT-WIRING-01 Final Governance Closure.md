# ES-DESKTOP-CANONICAL-PRINT-WIRING-01 Final Governance Closure

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Closure Status

| Item | Result |
| --- | --- |
| Task | `ES-DESKTOP-CANONICAL-PRINT-WIRING-01` |
| Final Product Candidate | `a5e1ec4e9c19f85fae4db58745f50d665c831e56` |
| Production SHA at FIELD | `fa7c005bbefbf4350c4b4b03c85c6403a78370f9` / `READY` |
| Production migration | `PASS` |
| Production feature | `DESKTOP_NETWORK_PRINT_ENABLED=1` remains enabled |
| FIELD | `VERIFIED = YES` |
| Final freeze | `FINAL FROZEN = YES` |
| Closure | `CLOSED = YES` |
| Product change in this closure | `NO` |
| Migration/deploy in this closure | `NO` |
| Git state after closure commit | `CLEAN` |

## Production FIELD Evidence

Founder completed the single authorized real Production CASH order through the
normal E-Shop Desktop cashier. No RC10 manual launch was performed and no
second test order was created.

| Item | Evidence |
| --- | --- |
| Store | `Mino Pet Shop / ST169E7000` |
| Order | `S-20260919-ST169E7000-0007` |
| Payment | `CASH` |
| Desktop printing intent | `profile=network-v2` |
| Network mode | `SHARED_PRINTER` |
| Live binding | `PC-20260119FZUI` |
| Operator | `Jason Sun / OWNER` |
| POS authorization | `PASS`; no `POS_DEVICE_UNAUTHORIZED` |
| FRONT physical ticket | `PASS`; exactly one |
| KITCHEN physical ticket | `PASS`; exactly one |
| RC10 manual launch | `NOT REQUIRED` |
| RC10 background availability | `PASS` |

### Durable Production PrintJob Verification

The read-only Production records for the exact order contain exactly two
network-v2 jobs and no other job for the order:

| Role | PrintJob | Status | Claim binding | Attempts | Result |
| --- | --- | --- | --- | --- | --- |
| FRONT | `cmu8om1eb000304kz501ezbkb` | `SUCCEEDED` | `PC-20260119FZUI` | `claimAttempt=1`, `attemptCount=1` | `SUBMITTED_TO_NETWORK_SOCKET` |
| KITCHEN | `cmu8om1qx000404kzvzwr8ho2` | `SUCCEEDED` | `PC-20260119FZUI` | `claimAttempt=1`, `attemptCount=1` | `SUBMITTED_TO_NETWORK_SOCKET` |

Additional read-only results:

- `FRONT count=1`, `KITCHEN count=1`, total exact-order jobs `=2`.
- Retry count `=0`; duplicate jobs `=0`.
- `NETWORK_QUEUED_MODE_MISMATCH` count `=0`.
- No cross-role job evidence.
- `SaleRecord.status=COMPLETED` and `operatorUserId` remains the existing
  `Jason Sun / OWNER` identity.
- `ComputerBinding.lastNetworkMode=SHARED_PRINTER` and
  `lastNetworkModeAt` remained fresh during verification.
- `physicalCompletionKnown=false` is the existing relay contract boundary:
  the runtime records socket submission, while the physical paper result is
  independently established by the Founder FIELD observation above.

## Latency Disposition

`PRINT LATENCY OBSERVATION = NON-BLOCKING / DEFER`.

Existing timestamps show FRONT execution beginning before KITCHEN, with
KITCHEN beginning only after the successful FRONT dependency. Both jobs had
one claim and one attempt. The persisted fields do not retain a separate claim
timestamp, so the exact split between cloud polling and claim sequencing
cannot be further isolated. No latency optimization is included in this
closure.

## Product Byte and Boundary Verification

The nine authorized Candidate paths remain byte-exact at their approved
SHA-256 values:

| Path | SHA-256 |
| --- | --- |
| `prisma/schema.prisma` | `dd75b3f13d82250fac09d83ea718b009b6f5df6f876c5db6e53997ef70983b2e` |
| `prisma/migrations/20260919090000_add_computer_binding_network_mode_snapshot/migration.sql` | `9ee9a1adf7d8abf802131b0241a002510fb662ea6aa2ce555bdede8e108bf1f6` |
| `lib/desktop-network-print.ts` | `55e46c53e8f244708a3cd98e717051c37b73fe8bf759351bef46c2f79127496c` |
| `app/api/es-tray-02/print-jobs/receive/route.ts` | `cb5cd2fd67bc8782d4721c7ebd39750253fe112db9fecd93fb979464ca62c697` |
| `app/api/computer-client/network-mode/route.ts` | `2b3937817b22f1d1dafd51b76a5c27730646190a0f051858ecd728ebad09266e` |
| `app/api/cashier/sales/route.ts` | `cfc0801462a7e596f1fcf9e8f7d8da03630f3ada889e414b7859bae4fdde0788` |
| `app/cashier/page.tsx` | `d63d19b1eefd1170740fa43482230a4d0793e11b2355d57b116bf4b5518a1525` |
| `tests/cashier-network-print-v01.test.ts` | `e0fbf8a73fa867277a8f963ba25e164ee0f6df3df75bcb780d129f81c52901ce` |
| `tests/es-tray-device-print-contract.test.ts` | `c99a8e7009dedf1c0939b8c5085d4f95cd6379a3968fd1a94bedc6ad378a96d4` |

The following remain unchanged and outside this closure:

- RC10 bytes and runtime behavior
- `desktop/**`
- Printing Core and PrintJob contract/model
- schema/migration content
- Local-First, P1B, P6C, and single-installer work

## Deferred Items

- `PRINT LATENCY OBSERVATION`: non-blocking; deferred.
- `KTF-20260912-01`: open / flaky-test-harness quarantine; review deadline
  `2026-09-26`.
- `KTF-20260912-02`: open / recurrence observed and baseline-equivalent;
  review deadline `2026-09-26`.
- `KTF-20260912-03`: open / existing Next.js request-scope harness debt and
  baseline-equivalent; review deadline `2026-09-26`.
- `KTF-20260912-07`: open / baseline-equivalent fixed-date fixture drift;
  review deadline `2026-09-26`.

These deferred items do not invalidate the accepted Production FIELD result
and are not reopened or fixed by this closure.

## Final Decision

`DESKTOP -> CANONICAL NETWORK-V2 = PASS`.

`OPTION D FIELD VERIFIED = YES`.

`ES-DESKTOP-CANONICAL-PRINT-WIRING-01 FINAL FROZEN = YES`.

`ES-DESKTOP-CANONICAL-PRINT-WIRING-01 CLOSED = YES`.

This record is governance-only. It changes no product behavior, Production
configuration, schema, migration, RC10, Desktop, or Printing implementation.
