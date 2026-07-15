# Runtime Diagnostics and Redaction Evidence

## Event Codes

- `HRT_PROVIDER_LIFECYCLE_TRANSITION`
- `HRT_PROVIDER_REGISTRATION_ACCEPTED`
- `HRT_PROVIDER_REGISTRATION_REJECTED`
- `HRT_PROVIDER_RESTART_ACCEPTED`
- `HRT_PROVIDER_STALE_INSTANCE_MARKED`
- `HRT_PROVIDER_STALE_INSTANCE_REJECTED`
- `HRT_PROVIDER_OWNERSHIP_INVALIDATED`
- `HRT_PROVIDER_DISCONNECTED`
- `HRT_PROVIDER_RESTART_BACKOFF`
- `HRT_PROVIDER_MAX_RESTART_REACHED`
- `HRT_PROVIDER_STOPPED`
- `HRT_PROVIDER_ILLEGAL_TRANSITION`

Severity values: `INFO`, `WARN`, `ERROR`.

## Redaction Review

Current redaction matches keys using case-insensitive pattern: `secret|token|password|privateKey|authorization|cookie`.

Coverage:

- `token`: covered
- `password`: covered
- `secret`: covered
- `private key` / `privateKey`: camel-case key covered by substring `privateKey`; spaced key not explicitly normalized
- `authorization`: covered
- `cookie`: covered
- `accessToken`: covered by `token` case-insensitive substring
- `client_secret`: covered by `secret`

Risk:

- Redaction is shallow: it only processes top-level `details` keys.
- Nested objects and arrays are not recursively redacted.
- It can still record non-key-sensitive payload values if caller passes them under safe-looking keys.
- This is non-blocking for MB-2A but should be hardened before support bundle/export work.
