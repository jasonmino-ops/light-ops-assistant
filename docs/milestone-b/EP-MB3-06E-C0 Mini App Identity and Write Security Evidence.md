# EP-MB3-06E-C0 Mini App Identity and Write Security Evidence

Date: 2026-07-20

Repository branch: `feat/ep-mb3-06c-activation-pin-console`

Baseline: `7ce3a4f9648359d6a52a1d15eed4c18d929e8a0a`

## Closure Status

**CONDITIONAL PASS**

The shared write-origin guard, route ordering, zero-side-effect proofs, identity
privacy changes, compatibility matrix, CI coverage, and local regression gate
are complete. The real Founder Telegram binding is intentionally not performed:
the authorized read-only Staging check found the target FK-backed administrator
unbound, no signed Founder Telegram WebView session was available, and the
Staging `_ops` audit tenant prerequisite is absent. No allowlist, browser
storage, log, ad hoc SQL, migration, or seed was used to infer or create the
binding.

## Readiness Conditions

| Condition | Result | Evidence |
| --- | --- | --- |
| Founder Telegram identity bound to a real Staging OpsAdmin | OPEN | Target administrator is FK-backed, `SUPER_ADMIN`, `ACTIVE`, unlocked, and versioned, but remains unbound. |
| Same-origin/CSRF guard for PIN issuance and revoke | CLOSED | Shared fail-closed guard runs before auth and database access in both POST routes. |
| Cloud CI paths and tests cover future Device Center work | CLOSED LOCALLY | Push/PR filters and a dedicated C0 security gate are configured. Remote run is verified separately after push. |

## Staging Identity Snapshot

The check used a read-only transaction against `eshop-staging` and rolled it
back. The environment identity was recorded only as the approved short project
fingerprint `c18c04531444`.

- Target identity: real FK-backed `OpsAdmin`.
- Role: `SUPER_ADMIN`.
- Status: `ACTIVE`.
- Lock state: unlocked.
- Session version: present and valid.
- Telegram binding: not bound.
- Bound OpsAdmin count: zero.
- Desktop activation PIN count: zero.
- Desktop device count: zero.
- Historical full-Telegram-ID Ops audit rows: zero.
- `_ops` audit tenant prerequisite: absent.
- Production access or write: none.

## Binding Privacy

The existing controlled SUPER_ADMIN binding route was hardened before any real
binding:

- repeated submission of the same binding is idempotent;
- a repeated binding does not increment `sessionVersion`;
- a repeated binding does not create a duplicate audit event;
- binding audit messages contain only `bound` / `unbound` state transitions;
- the administrator list returns `telegramBound` and never returns the stored
  Telegram identifier;
- Telegram login audit payloads record only the identity source and FK-backed
  binding category;
- an unbound-login response does not echo the Telegram identifier;
- internal auth errors do not log request material.

No real Telegram identifier was read, printed, logged, persisted in Evidence,
or derived from `OPS_TG_IDS` / `OPS_USER_IDS`.

## Same-Origin Guard

`lib/ops-write-origin.ts` protects state-changing methods only. It performs an
exact `http` / `https` origin comparison against the request origin.

Evaluation order in both protected POST routes:

1. method and write-origin validation;
2. Ops authentication and minimum role;
3. FK-backed OpsAdmin identity validation;
4. body and business validation;
5. database mutation.

Every rejected request returns HTTP 403 with
`OPS_WRITE_ORIGIN_FORBIDDEN` and `Cache-Control: no-store, max-age=0`.
There is no wildcard host, CORS-only check, Telegram domain allowlist,
frontend secret, or unknown-origin fallback.

## Allowed Request Matrix

| Request | Result |
| --- | --- |
| Chrome exact same-origin `Origin` + `Sec-Fetch-Site: same-origin` | PASS |
| Telegram WebView exact same-origin fetch | PASS |
| Isolated Preview exact same-origin fetch | PASS |
| `localhost` exact same-origin fetch | PASS |
| Missing `Origin` + `Sec-Fetch-Site: same-origin` | PASS |
| Missing `Origin` + exact same-origin `Referer` fallback | PASS |
| GET with cross-site metadata | UNAFFECTED |

## Rejected Request Matrix

| Request | Result |
| --- | --- |
| Foreign `Origin` | 403 |
| `Origin: null` | 403 |
| Malformed origin | 403 |
| Exact origin with contradictory cross-site Fetch Metadata | 403 |
| Missing origin with `same-site` Fetch Metadata | 403 |
| Foreign/spoofed Referer | 403 |
| Missing all origin signals | 403 |

## No-Side-Effect Proof

Real route tests ran against an isolated temporary PostgreSQL database after
all 46 migrations were deployed.

- Cross-origin PIN issuance: HTTP 403; PIN count unchanged; activation audit
  count unchanged.
- Cross-origin device revoke: HTTP 403; device remained `ACTIVE`; active slot
  and revocation reason unchanged; revoke audit count unchanged.
- Legacy `_ops_admin` and `OPS_USER_IDS` identities still reach read-only Ops
  behavior but PIN issuance and revoke remain blocked by
  `OPS_ADMIN_IDENTITY_REQUIRED` when the request origin is valid.

## Telegram Login Verification

The automated auth test uses synthetic signed initData and an isolated test
database. It verifies:

- controlled binding to an existing FK-backed OpsAdmin;
- idempotent repeated binding;
- exact session `userId = OpsAdmin.id`;
- matching `opsRole` and `opsSessionVersion`;
- `ACTIVE`, unlocked, and current-version enforcement;
- successful `getFkBackedOpsAdminIdentity` resolution;
- no full Telegram identifier in API output or operation audit data.

This proves the route contract but is not represented as a real Founder
Staging login. Real login verification remains `NOT RUN` until Founder performs
the binding from a signed Telegram WebView session.

## Cloud CI Coverage

Push and pull-request filters now include:

- `app/ops/device-center/**`;
- `app/ops/_components/**`;
- Telegram Ops auth and administrator binding APIs/UI;
- Desktop activation and management APIs;
- `lib/ops-write-origin.ts`;
- origin and Telegram Ops auth tests.

The dedicated C0 gate runs after migration deployment and the existing 06D
database gate. It does not use `db push`, `migrate resolve`, `continue-on-error`,
Staging/Production credentials, migration bypasses, or secret output.

## Verification Results

- Prisma validate: PASS.
- Prisma generate: PASS.
- Empty-database migration deploy: 46/46 PASS.
- Migration status: up to date.
- Migration drift: none.
- Repeated migration deploy: no-op.
- Migration chain smoke: PASS.
- Shared origin matrix: PASS.
- Telegram Ops FK identity/privacy test: PASS.
- PIN console database suite: PASS.
- Desktop management/revoke database suite: PASS.
- Desktop activation runtime database suite: PASS.
- Subscription lifecycle: PASS.
- Ops/Desktop static and domain tests: PASS.
- Telegram and customer-display regressions: PASS.
- 06D Playwright: 3/3 PASS, including 390 px no-overflow.
- TypeScript: PASS.
- Production build: PASS.

## Safety Statement

- No Device Center UI or menu was implemented.
- No schema or migration changed.
- No Desktop Runtime, Device Token, subscription model, PIN issuance service,
  or revoke business service changed.
- No real activation PIN was generated.
- No real device was revoked.
- No Staging variable, migration, seed, or deployment command was executed.
- Production was not connected, queried, migrated, seeded, deployed, or changed.

## Remaining Conditions

1. Establish an explicitly authorized `_ops` audit-tenant prerequisite through
   a separately reviewed environment operation; C0 did not seed it.
2. Deploy the reviewed commit to the isolated Preview through the normal branch
   workflow and confirm the deployment commit without recording its URL.
3. Founder personally binds the signed Telegram identity through the controlled
   Staging administrator flow; Codex must not receive the identifier.
4. Verify the resulting Telegram session is FK-backed, versioned, ACTIVE, and
   unlocked, then repeat the read-only zero-state check.

Until these conditions are complete, EP-MB3-06E implementation, first Staging
PIN generation, Windows field activation, merge, tag, and release remain
unauthorized.
