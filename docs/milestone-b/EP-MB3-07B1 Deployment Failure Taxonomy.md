# EP-MB3-07B1 Deployment Failure Taxonomy

## Purpose

The deployment failure taxonomy is the support-readable boundary between raw runtime errors and any renderer-visible failure UX. Raw `Error`, stack, URL, response body, token, PIN, cookie, or customer data must not cross this boundary.

Source of truth: `desktop/src/shared/deploymentDiagnostics.ts`

## Descriptor Fields

Each failure descriptor contains:

- `code`
- `component`
- `severity`
- `title`
- `explanation`
- `recommendedAction`
- `retryable`
- `supportRequired`
- `healthImpact`
- `logEvent`
- `metadataAllowlist`

## Components

- `ACTIVATION`
- `BUSINESS_CLOUD`
- `PROVIDER`
- `DISPLAY`
- `DIAGNOSTICS`
- `SYSTEM`

## Codes

| Component | Codes |
| --- | --- |
| Activation | `ACTIVATION_NETWORK_ERROR`, `ACTIVATION_INVALID_PIN`, `ACTIVATION_PIN_LOCKED`, `ACTIVATION_PIN_EXPIRED`, `ACTIVATION_DEVICE_REVOKED`, `ACTIVATION_TOKEN_EXPIRED`, `ACTIVATION_SAFE_STORAGE_UNAVAILABLE`, `ACTIVATION_CREDENTIAL_CORRUPTED`, `ACTIVATION_SUBSCRIPTION_BLOCKED`, `ACTIVATION_SERVER_ERROR` |
| Business Cloud | `BUSINESS_CLOUD_DNS_FAILURE`, `BUSINESS_CLOUD_TLS_FAILURE`, `BUSINESS_CLOUD_HTTP_ERROR`, `BUSINESS_CLOUD_TIMEOUT`, `BUSINESS_CLOUD_UNAUTHORIZED`, `BUSINESS_CLOUD_RENDERER_CRASHED`, `BUSINESS_CLOUD_UNKNOWN` |
| Provider | `PROVIDER_ENTRY_MISSING`, `PROVIDER_CONNECT_FAILED`, `PROVIDER_INCOMPATIBLE`, `PROVIDER_PIPE_CLOSED`, `PROVIDER_EXITED` |
| Display | `DISPLAY_EMPLOYEE_UNAVAILABLE`, `DISPLAY_CUSTOMER_UNAVAILABLE`, `DISPLAY_CUSTOMER_LOAD_FAILED`, `DISPLAY_TOPOLOGY_CHANGED` |
| Diagnostics | `DIAGNOSTICS_EXPORT_REDACTION_FAILED`, `DIAGNOSTICS_EXPORT_WRITE_FAILED`, `DIAGNOSTICS_EXPORT_TIMEOUT`, `DIAGNOSTICS_EXPORT_SIZE_LIMIT` |
| System | `SYSTEM_SAFE_STORAGE_UNAVAILABLE`, `UNKNOWN_FAILURE` |

## Classification Rules

Business Cloud failures are classified from Electron error code, safe description category, or HTTP status. URLs and bodies are not stored in renderer DTOs.

Activation failures are classified from public activation state only.

Provider failures are classified from status codes already used by the Provider supervisor. B1 recheck does not call `start()`.

Display failures are classified from display lifecycle events and customer load failures.

Diagnostics failures are classified from export stage results after redaction or size checks.

## Metadata Boundary

Only keys listed in `metadataAllowlist` survive. Unknown fields are dropped. Secret-shaped fields are dropped or cause diagnostics export failure depending on the pipeline stage.
