# EP-MB3-06A Concurrency Evidence

## PIN Activation

- Activation locks the active PIN row:
  - `SELECT "id" FROM "DesktopActivationPin" WHERE "storeId" = ... AND "activeSlot" = 'ACTIVE' FOR UPDATE`
- Database uniqueness enforces one active PIN per store:
  - `@@unique([storeId, activeSlot])`
- Successful activation consumes the PIN in the same transaction:
  - `status = USED`
  - `activeSlot = null`
  - `usedAt = now`
  - `usedByDeviceId = device.id`

## Installation Identity

- Activation locks the active installation row:
  - `SELECT "id" FROM "DesktopDevice" WHERE "installationIdHash" = ... AND "activeSlot" = 'ACTIVE' FOR UPDATE`
- Database uniqueness enforces one active installation identity:
  - `@@unique([installationIdHash, activeSlot])`
- Same installation and same store reactivation reuses the device row, rotates the token hash, increments `tokenHashVersion`, and audits `DEVICE_REACTIVATED` plus `TOKEN_ROTATED`.
- Same installation and different active store is rejected with `INSTALLATION_BOUND_TO_OTHER_STORE`.

## Revocation

- Device revoke locks the target device row with `FOR UPDATE`.
- Revocation sets:
  - `status = REVOKED`
  - `activeSlot = null`
  - `revokedAt = now`
  - `revokedByUserId = owner user`
- `tokenHash` remains on the revoked row.
- Revoked tokens fail verify because device auth rejects non-`ACTIVE` status.
- Re-activation after revocation creates a new `DesktopDevice` and sets `replacesDeviceId` to the latest revoked device when available.

## Race Handling

- Prisma `P2002` uniqueness conflicts during activation return `CONFLICT_RETRY_REQUIRED`.
- There is no full activation response replay and no full raw token persistence. If a successful response is lost, the owner creates a new PIN.
