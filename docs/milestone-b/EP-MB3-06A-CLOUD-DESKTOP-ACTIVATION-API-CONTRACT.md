# EP-MB3-06A Cloud Desktop Activation Identity API Contract

Status: implementation contract
Scope: Cloud API and database identity only

## Security Invariants

- Desktop device tokens are opaque random tokens with format `edt_v1_<base64url-random>`.
- Clients receive the raw token once. The database stores only HMAC-SHA-256 token hashes.
- PINs are 6 digit numbers. The database stores only HMAC-SHA-256 PIN hashes.
- Desktop token hashes use `DESKTOP_DEVICE_TOKEN_SECRET`.
- Activation PIN hashes use `DESKTOP_ACTIVATION_PIN_SECRET`.
- Production requests fail closed when either secret is missing.
- New Desktop APIs never call legacy POS authorization helpers and never authorize by `storeCode` fallback after activation.
- Activation audit metadata is built from an allowlist and never contains raw request or response payloads.
- All activation/token responses use `Cache-Control: no-store`.

## Subscription Access State

The current database stores subscription status as strings. EP-MB3-06A does not add subscription enum values.

| Subscription status | Access state | PIN create | Activate | Verify |
| --- | --- | --- | --- | --- |
| `TRIAL` | `ALLOWED` | yes | yes | yes |
| `ACTIVE` | `ALLOWED` | yes | yes | yes |
| `EXPIRED` | `BLOCKED` | no | no | blocked state |
| `CANCELLED` | `BLOCKED` | no | no | blocked state |

No `GRACE` state is implemented in V1 because the repository has no reliable 3 day grace policy.

## Routes

### `POST /api/desktop/activation-pins`

Auth: merchant session, `OWNER` only.

Request:

```json
{
  "storeId": "store_id"
}
```

Success `201`:

```json
{
  "pinId": "pin_id",
  "pin": "123456",
  "storeId": "store_id",
  "expiresAt": "2026-07-18T00:00:00.000Z",
  "subscription": {
    "accessState": "ALLOWED",
    "status": "ACTIVE",
    "warning": null
  }
}
```

Errors: `LOGIN_REQUIRED`, `OWNER_REQUIRED`, `INVALID_JSON`, `MISSING_STORE_ID`, `STORE_NOT_FOUND`, `TENANT_INACTIVE`, `STORE_INACTIVE`, `SUBSCRIPTION_BLOCKED`, `INTERNAL_ERROR`.

### `POST /api/desktop/activation-pins/[id]/revoke`

Auth: merchant session, `OWNER` only.

Request: empty JSON body or no body.

Success `200`:

```json
{
  "ok": true,
  "pinId": "pin_id"
}
```

Errors: `LOGIN_REQUIRED`, `OWNER_REQUIRED`, `PIN_NOT_FOUND`, `INTERNAL_ERROR`.

### `POST /api/desktop/activate`

Auth: public activation endpoint. Only this route accepts `storeCode + PIN`.

Request:

```json
{
  "storeCode": "STORE-A",
  "pin": "123456",
  "installationId": "opaque-installation-id"
}
```

Success `201`:

```json
{
  "deviceToken": "edt_v1_...",
  "tokenExpiresAt": "2027-07-17T00:00:00.000Z",
  "device": {
    "id": "device_id",
    "tenantId": "tenant_id",
    "storeId": "store_id",
    "status": "ACTIVE",
    "tokenHashVersion": 1
  },
  "subscription": {
    "accessState": "ALLOWED",
    "status": "ACTIVE",
    "warning": null
  }
}
```

Errors: `INVALID_JSON`, `INVALID_REQUEST`, `STORE_NOT_FOUND`, `TENANT_INACTIVE`, `STORE_INACTIVE`, `SUBSCRIPTION_BLOCKED`, `INVALID_PIN`, `PIN_LOCKED`, `PIN_EXPIRED`, `PIN_ALREADY_USED`, `INSTALLATION_BOUND_TO_OTHER_STORE`, `TOKEN_SECRET_NOT_CONFIGURED`, `PIN_SECRET_NOT_CONFIGURED`, `CONFLICT_RETRY_REQUIRED`, `INTERNAL_ERROR`.

### `POST /api/desktop/auth/verify`

Auth: `Authorization: Bearer edt_v1_...`.

Request: no body required.

Success `200`:

```json
{
  "ok": true,
  "device": {
    "id": "device_id",
    "tenantId": "tenant_id",
    "storeId": "store_id",
    "status": "ACTIVE",
    "tokenExpiresAt": "2027-07-17T00:00:00.000Z"
  },
  "subscription": {
    "accessState": "ALLOWED",
    "status": "ACTIVE",
    "warning": null
  }
}
```

Blocked subscription `403`:

```json
{
  "ok": false,
  "error": "SUBSCRIPTION_BLOCKED",
  "subscription": {
    "accessState": "BLOCKED",
    "status": "EXPIRED",
    "warning": null
  }
}
```

Errors: `DESKTOP_DEVICE_UNAUTHORIZED`, `DESKTOP_DEVICE_REVOKED`, `DESKTOP_TOKEN_EXPIRED`, `TENANT_INACTIVE`, `STORE_INACTIVE`, `SUBSCRIPTION_BLOCKED`.

### `GET /api/desktop/device/status`

Auth: `Authorization: Bearer edt_v1_...`.

Success `200`:

```json
{
  "device": {
    "id": "device_id",
    "tenantId": "tenant_id",
    "storeId": "store_id",
    "status": "ACTIVE",
    "tokenIssuedAt": "2026-07-17T00:00:00.000Z",
    "tokenExpiresAt": "2027-07-17T00:00:00.000Z",
    "lastSeenAt": "2026-07-17T00:00:00.000Z"
  },
  "store": {
    "id": "store_id",
    "name": "Store",
    "status": "ACTIVE"
  },
  "subscription": {
    "accessState": "ALLOWED",
    "status": "ACTIVE",
    "warning": null
  }
}
```

Errors: same as verify.

### `GET /api/desktop/devices`

Auth: merchant session, `OWNER` only.

Query:

- `storeId` optional. If present, list one store. If absent, list all tenant devices.

Success `200`:

```json
{
  "devices": [
    {
      "id": "device_id",
      "tenantId": "tenant_id",
      "storeId": "store_id",
      "status": "ACTIVE",
      "tokenHashVersion": 1,
      "tokenIssuedAt": "2026-07-17T00:00:00.000Z",
      "tokenExpiresAt": "2027-07-17T00:00:00.000Z",
      "lastSeenAt": null,
      "activatedAt": "2026-07-17T00:00:00.000Z",
      "revokedAt": null,
      "revocationReason": null,
      "replacesDeviceId": null
    }
  ]
}
```

Errors: `LOGIN_REQUIRED`, `OWNER_REQUIRED`, `STORE_NOT_FOUND`.

### `POST /api/desktop/devices/[id]/revoke`

Auth: merchant session, `OWNER` only.

Request:

```json
{
  "reason": "optional reason"
}
```

Success `200`:

```json
{
  "ok": true,
  "deviceId": "device_id",
  "status": "REVOKED"
}
```

Errors: `LOGIN_REQUIRED`, `OWNER_REQUIRED`, `DEVICE_NOT_FOUND`, `INTERNAL_ERROR`.

## Legacy Boundary

Legacy cashier POS authorization remains unchanged and is intentionally out of scope. Its known token-in-OperationLog risk is not fixed by EP-MB3-06A. The new Desktop activation path does not repeat that pattern.
