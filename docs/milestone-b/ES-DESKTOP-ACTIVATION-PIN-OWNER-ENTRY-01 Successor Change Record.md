# ES-DESKTOP-ACTIVATION-PIN-OWNER-ENTRY-01 Successor Change Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-ACTIVATION-PIN-OWNER-ENTRY-01` |
| Risk | `L3` — frozen Release Foundation boundary and Production deployment |
| Founder decision | `D3 APPROVE OPTION A MINIMAL IMPLEMENTATION`; `D4 DESKTOP ACTIVATION IS NOT LEGACY` |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| Scope Guard | No forbidden path; no exception required |
| P1A FIELD | `NOT VERIFIED` |
| P1B | `NOT STARTED` |

## Successor-Change Review

### Why the frozen boundary must be touched

The only existing merchant OWNER device-management location is:

`Telegram OWNER Home -> 电脑收银台 -> 电脑客户端 -> 管理电脑`

Its page is `app/home/computer-client/page.tsx`, which belongs to the Release Foundation `cashier/customer/mobile business` group because that group deliberately protects all of `app/home`.

The current Production backend already provides the accepted OWNER-only contract `POST /api/desktop/activation-pins`, but current Production exposes no OWNER product control that can call it. This missing UI blocks the first legitimate activation of the new E-Shop Desktop on V727.

### Why this is the minimum regular product path

- The existing Computer Client management page is already OWNER-only and store-oriented.
- Reusing it avoids a second device-management landing page or a hidden direct URL.
- The current store code from `WorkModeProvider` can be matched against the existing OWNER `/api/stores` response to obtain the exact `storeId` required by the frozen activation endpoint.
- Internal Ops authentication is a different identity boundary and is not a substitute for a merchant OWNER action.
- Converging Desktop Activation into Computer Client approval is Founder-deferred Option B and is not implemented here.

No equally regular OWNER entry can be added without touching a protected merchant surface. A standalone page with no product entry would not satisfy the authorized objective; changing the main navigation would be broader than adding the action to the existing device-management page.

### Authorized successor behavior

The authorized delta is limited to:

- loading the OWNER's existing store list;
- resolving the exact current store context by `storeCode`;
- calling the existing `POST /api/desktop/activation-pins` with that store's `storeId`;
- showing the returned six-digit PIN only in in-memory React state;
- showing the accepted 24-hour / one-time-use guidance;
- explicit copy and regenerate actions;
- clearing the plaintext naturally on navigation or refresh because there is no persistence or read-back endpoint.

### Preserved security and product boundaries

- API OWNER authorization remains authoritative and unchanged.
- API tenant/store validation remains authoritative and unchanged.
- No new API, schema, migration, secret, token, role, identity source, or environment variable is added.
- HMAC storage, 24-hour TTL, one-time consumption, failed-attempt lock, audit trail, and previous-active-PIN revocation remain unchanged.
- PIN plaintext is not written to localStorage, sessionStorage, cookies, URLs, logs, analytics, or repository evidence.
- Computer Client request approval, disable, recovery, and launch-ticket flows remain unchanged.
- The separate `failedAttempts` success-path and activation endpoint abuse-protection findings remain deferred follow-ups exactly as Founder directed.
- Desktop Candidate `c9506307e42bc49d583d90f20a173e17450a7ba9`, RC9, Printing, V727, P1A, and P1B are untouched.

## Release Foundation Treatment

This is an authorized successor change, not an exception or known-failure waiver. After the exact implementation candidate exists, the Release Foundation comparison ref may be advanced only to that immutable candidate commit. The alignment must retain every frozen group, path, exact `git diff` comparison, failure condition, release-asset check, and provenance invariant. It must not accept any unknown future bytes.

## Validation Gate

Required before merge/deploy:

- focused OWNER entry and Computer Client regression tests;
- existing Desktop Activation security and lifecycle static tests;
- TypeScript and production build;
- mobile-sized browser verification with mocked issuance only (no real PIN);
- Scope Guard PASS;
- Release Foundation PASS after exact successor alignment;
- fresh-context independent review PASS.

## Stop Boundary

This record does not authorize generating a real PIN, operating V727, completing Activation, changing Production data, modifying the Desktop Candidate, or starting P1A FIELD or P1B.
