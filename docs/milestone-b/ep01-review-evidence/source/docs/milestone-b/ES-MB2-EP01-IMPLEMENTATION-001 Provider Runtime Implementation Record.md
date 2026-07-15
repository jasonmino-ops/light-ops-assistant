# ES-MB2-EP01-IMPLEMENTATION-001 Provider Runtime Implementation Record

## Basic Information

| Item | Value |
| --- | --- |
| Milestone | Milestone B |
| Workstream | WS-1 Desktop Runtime / HRT Logic Core |
| Engineering Package | EP-MB2-01 Provider Runtime |
| Gate | MB-2A Provider Session / Lifecycle Ready |
| Status | IMPLEMENTED FOR MB-2A REVIEW / NOT ACCEPTED / NOT FROZEN |
| Formal Starting HEAD | 89873f5c1b2c5b20c981033eb45a3bfe977cd456 |
| Branch | mb2/ep01-provider-runtime |
| Date | 2026-07-15 |

## Scope

This package implements the Desktop Runtime Provider Runtime core inside `desktop/src/main/hrt/`.

Implemented scope:

- Provider Session
- Provider Lifecycle
- Provider Registry
- Provider Ownership
- Stale Instance Invalidation
- Runtime-Initiated Handshake enforcement
- Provider Supervision policy model
- Restart / Backoff / Max Restart model
- Provider Health and Device Health separation
- Structured Runtime Diagnostics
- Simulator package metadata
- Provider Runtime conformance vectors
- Desktop Runtime tests

## Module Structure

- `providerSession.ts` defines the formal Provider Session shape.
- `providerLifecycle.ts` defines lifecycle states and legal transitions.
- `providerRegistry.ts` tracks active, stale, and rejected provider sessions.
- `providerOwnership.ts` checks command result, event, display, health, and device ownership.
- `providerSupervision.ts` defines deterministic restart/backoff/max-restart policy.
- `providerHealth.ts` keeps provider health separate from device health.
- `runtimeDiagnostics.ts` emits structured redacted runtime diagnostic events.
- `hrtLogicCore.ts` remains the facade and composition root.

## Lifecycle States

- `NEW`
- `CONNECTING`
- `REGISTERED`
- `HANDSHAKING`
- `READY`
- `DEGRADED`
- `DISCONNECTED`
- `REJECTED`
- `SHUTTING_DOWN`
- `STOPPED`

Provider cannot self-enter `READY`. `READY` is authorized only after Runtime registration, compatibility, capability, provider identity, and handshake gates pass.

## Registry Policy

Milestone B RC1 allows one active provider per Runtime.

Registry tracks:

- active provider session
- rejected provider sessions
- stale provider sessions
- current authoritative instance
- compatibility result
- last handshake
- last rejection
- last disconnect
- ownership state through Provider Ownership
- supervision state through Provider Supervision

Duplicate handling:

- same instance duplicate: rejected as `REJECTED_DUPLICATE_SAME_INSTANCE`
- new instance for same provider identity: accepted as restart, previous instance marked stale
- different provider identity: rejected as `REJECTED_CONFLICTING_PROVIDER`

## Ownership Policy

Provider ownership is valid only for the current authoritative provider instance.

Rejected stale subjects:

- command result
- scanner event
- display response / snapshot
- health snapshot
- device registration

Ownership invalidation emits structured diagnostics with `HRT_PROVIDER_OWNERSHIP_INVALIDATED`.

## Supervision Policy

This package implements policy/model only. It does not spawn a Windows process, create a Windows Service, or open a Named Pipe.

Default policy:

- initial backoff: `500ms`
- multiplier: `2`
- max backoff: `5000ms`
- max restart attempts: `3`
- restart window: `60000ms`

Exceeding the max restart attempts moves supervision to `STOPPED` and Runtime lifecycle to stopped/shutdown compatibility state.

Manual reset clears restart counters and backoff.

## Health Model

Provider health and device health remain separate.

Provider `READY` does not imply device `ONLINE`.

Disconnect invalidates provider ownership and updates provider lifecycle/supervision state. It does not rewrite device health to a false successful state.

## Diagnostics Model

Structured diagnostics include:

- event code
- severity
- provider identity
- provider instance ID
- session ID
- lifecycle state
- previous state
- new state
- correlation ID when available
- reason
- timestamp
- redacted details

Sensitive keys such as token, password, secret, private key, authorization, and cookie are redacted.

## Simulator Scenarios

Provider Simulator remains:

TEST / DEVELOPMENT ONLY. NOT A PRODUCTION PROVIDER.

This package adds simulator package metadata and Provider Runtime conformance vectors for:

- valid registration
- incompatible contract
- missing capability
- duplicate registration
- restart with new instance
- stale instance result
- disconnect
- supervision backoff
- max restart
- illegal transition
- shutdown

## Conformance Vectors

Path:

`packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json`

Vectors are language-neutral JSON and include expected decision, rejection reason, diagnostic code, or state outcome.

## Tests

Added / updated tests:

- `desktop/tests/provider-runtime.test.ts`
- `desktop/tests/hrt-logic-core.test.ts`

Coverage includes:

- lifecycle valid and invalid transitions
- provider cannot self-ready
- READY requires Runtime compatibility gate
- registry first registration
- duplicate same instance
- restart with new instance
- conflicting provider
- stale instance ownership rejection
- disconnect and max restart
- deterministic backoff
- manual reset
- health separation
- stale health rejection
- structured diagnostics and redaction
- conformance vector loading

## Known Limitations

- Full Device Assignment Runtime is not implemented in this EP.
- Full Command Dispatcher and Command Lifecycle are not implemented in this EP.
- Scanner Event Router is not implemented in this EP.
- Customer Display Snapshot Store is not implemented in this EP.
- No real Windows Provider is initialized.
- No real process supervision, Named Pipe, driver, COM, VID/PID, printer queue, or hardware executor is implemented.

## Excluded Scope

This package does not modify:

- Legacy print
- Legacy scan
- Web Serial customer display
- Cloud print
- Cashier
- POS
- Store Applications
- Database
- Prisma
- Migration
- Production feature flags
- Windows Provider repository
- Real hardware executors

## Verification

Required verification commands:

- `npm --prefix packages/hrt-contract ci`
- `npm --prefix packages/hrt-contract run build`
- `npx tsx tests/hrt-contract.test.ts`
- `npm --prefix packages/hrt-provider-simulator test`
- `npm --prefix packages/hrt-provider-simulator run typecheck`
- `npm --prefix desktop run typecheck`
- `npm --prefix desktop test`
- `npm --prefix desktop run compile`
- `npm run build`

Final command results are recorded in the final Codex response for this EP.

## MB-2A Suggested Status

Suggested status after verification:

`IMPLEMENTED FOR MB-2A REVIEW`

Acceptance remains pending independent review, Windows CI, Vercel Preview confirmation, and Founder Approval.

## Milestone Status

| Gate | Status |
| --- | --- |
| MB-0 | PASS |
| MB-1 | PASS / ACCEPTED / MERGED |
| MB-2 | IN PROGRESS |
| MB-2A | IMPLEMENTED FOR REVIEW |
| MB-3 | BLOCKED |
