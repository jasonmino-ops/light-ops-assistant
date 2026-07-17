# EP-MB3-06A Security Evidence

## Token Storage

- Raw device token format is `edt_v1_<base64url-random>`.
- Token entropy is 32 random bytes from `crypto.randomBytes`.
- Token format now enforces a maximum base64url payload length of 128 characters.
- Raw token is returned only by `POST /api/desktop/activate` on success.
- `DesktopDevice.tokenHash` stores only HMAC-SHA-256 using `DESKTOP_DEVICE_TOKEN_SECRET`.
- No `AUTH_SECRET` fallback exists in `lib/desktop-activation/crypto.ts`.
- `assertDesktopActivationSecretsConfigured` verifies both desktop activation secrets so sensitive activation/auth flows fail closed when either secret is missing.
- `tokenHashVersion` is fixed hash algorithm/key-format version. `tokenVersion` is credential rotation version. Audit metadata uses `credentialVersion`.

## PIN Storage

- Activation PIN is a 6 digit value from `crypto.randomInt(0, 1_000_000)`.
- PIN TTL is 24 hours.
- PIN lockout is 5 failed attempts and 15 minutes.
- `DesktopActivationPin.pinHash` stores only HMAC-SHA-256 using `DESKTOP_ACTIVATION_PIN_SECRET`.

## Device Authentication

- Device APIs parse `Authorization: Bearer edt_v1_...`.
- `getDesktopDeviceContext` hashes the bearer token before database lookup.
- Revoked devices fail verification because `device.status !== 'ACTIVE'` returns `DESKTOP_DEVICE_REVOKED`.
- Expired tokens fail verification with `DESKTOP_TOKEN_EXPIRED`.
- Subscription `EXPIRED` and `CANCELLED` return blocked access.

## Cache and Logging

- All new desktop activation routes use `noStoreJson` or `apiError`, both of which set `Cache-Control: no-store, max-age=0`.
- New activation code does not call `console.*`.
- New activation code does not write `OperationLog`.
- `DesktopActivationAudit` uses an allowlist and rejects metadata keys containing token, pin, authorization, secret, hash, installation, payload, request, or response.
- `tokenHashVersion` was removed from audit metadata allowlist to close Claude C-1. `credentialVersion` is allowed and maps to `tokenVersion`.

## Error Redaction and Response Minimization

- All seven 06A routes are wrapped with `withDesktopApiError`, which maps unexpected exceptions to `INTERNAL_ERROR` without stack, Prisma error, request body, token, PIN, or payload data.
- `POST /api/desktop/auth/verify` and `GET /api/desktop/device/status` return only public device identity fields: `deviceId`, `tenantId`, `storeId`, `storeCode`, `status`, `tokenExpiresAt`, and `credentialVersion`.
- Device list responses no longer include `revocationReason`, `replacesDeviceId`, `revokedByUserId`, raw internal hash fields, or complete Store relation objects.

## Legacy Isolation

- New routes do not import `lib/desktop-pos-auth.ts`.
- New routes do not call `authorizeDesktopPosRequest`.
- New routes do not call `allowStoreCodeFallback`.
- Only `POST /api/desktop/activate` accepts `storeCode`; post-activation device APIs use bearer token context only.
