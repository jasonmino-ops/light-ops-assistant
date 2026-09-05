# ES-PRINT-DUAL-CHANNEL-01 — Channel A Production Relay Contract V0.1

## Scope

This contract reliably transfers an already-rendered ESC/POS command stream from an authenticated E-Shop OWNER context to one approved Desktop `ComputerBinding`, then to the existing Windows RAW queue `前台` through E-Shop Tray 0.1.3.

It does not change Desktop 0.4.7, printer discovery, queue selection, printer drivers, V5/V6 installers, or Channel B.

## Compatibility and versioning

- Enqueue input remains the frozen Desktop 0.4.7 relay `0.1` request.
- The durable job and Tray protocol use `schemaVersion = 1`.
- The enqueue response remains HTTP 202 and retains `fieldOnly=true`, `jobId`, `requestId`, and `status=PENDING_RECEIVE` solely because Desktop 0.4.7 validates that historical envelope. `productionContract=true` identifies the new server behavior.
- Tray 0.1.3 is the first client permitted to claim this production contract. Every device request carries `x-es-tray-version: 0.1.3`; authenticated older clients receive HTTP 426 before any job is claimed.

## Endpoints

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| `POST /api/es-tray-02/print-jobs` | Active OWNER tenant/store context | Idempotent enqueue |
| `POST /api/es-tray-02/print-jobs/receive` | Active bound `ComputerBinding` device credential | Atomically claim one scoped job |
| `POST /api/es-tray-02/print-jobs/{jobId}/executing` | Same binding plus claim token/attempt | Enter the non-retryable execution boundary |
| `POST /api/es-tray-02/print-jobs/{jobId}/result` | Same binding plus claim token/attempt | Idempotent terminal ACK |

The server derives tenant and store scope from authenticated state. It never trusts a tenant, store, installation, or binding identifier from a print payload.

## Enqueue idempotency

`(tenantId, storeId, idempotencyKey)` is database-unique. The server stores a canonical SHA-256 `requestHash`.

- Same key and same hash returns the original job.
- Same key and different hash returns HTTP 409.
- The database unique constraint is the concurrency authority.

## State and claim model

The public state machine is:

`PENDING → CLAIMED → EXECUTING → SUCCEEDED | FAILED`

`PENDING | CLAIMED → EXPIRED` applies before the execution boundary. A safely expired pre-execution claim returns to `PENDING` with `RETRYABLE` result metadata until `maxAttempts` or TTL is reached.

Each claim increments `claimAttempt` and `attemptCount`, generates a high-entropy claim token, and stores only its HMAC-SHA-256 hash. The claim is atomically scoped to tenant, store, and `ComputerBinding`. A previous attempt token cannot execute or complete a later attempt.

The default claim lease is 30 seconds. Lease, execution-result timeout, TTL, and maximum attempts are bounded environment configuration values.

## Effect boundary and completion semantics

`effectBoundary` is one of:

- `NOT_CROSSED`: Winspool has not been invoked.
- `CROSSING_UNKNOWN`: execution may have crossed into Winspool and must not be automatically repeated.
- `CROSSED`: Winspool accepted the complete RAW command stream.

After `EXECUTING`, a missing terminal result becomes `FAILED / CROSSING_UNKNOWN`; it never becomes claimable again. This favors explicit operator recovery over a duplicate physical side effect.

`SUCCEEDED` means only that Tray completed its Windows transport call and Winspool accepted the complete RAW stream. It never asserts physical paper output. `physicalCompletionKnown` is always `false` in V0.1.

## Tray journal

Before each relevant side-effect boundary, Tray atomically persists `{jobId, claimAttempt, protected claim token, state, effectBoundary, result, timestamps}` in its user-data directory. The claim token is protected by Electron `safeStorage` and is never written in plaintext or operational logs.

On restart:

- An unacknowledged terminal result is ACKed again without printing.
- `EXECUTING / CROSSING_UNKNOWN` is failed and ACKed without printing again.
- `EXECUTING / NOT_CROSSED` is failed and ACKed without printing.
- An expired local `CLAIMED` record is abandoned so the server may safely issue a new attempt.
- A permanently rejected stale/conflicting terminal ACK is retained as `QUARANTINED`, never printed again, and does not block later jobs. Authentication, authorization, network, and server failures remain retryable and fail closed.

## Data and migration boundary

The production ledger is the dedicated `EshopTrayPrintJob` model. It does not reuse `OperationLog` or the historical FIELD `StoreRuntimePrintTask` mailbox. The new migration is additive and leaves existing FIELD tables and data untouched.
