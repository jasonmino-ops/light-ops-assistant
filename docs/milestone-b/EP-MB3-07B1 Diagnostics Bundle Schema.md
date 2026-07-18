# EP-MB3-07B1 Diagnostics Bundle Schema

## Bundle Name

`eshop-desktop-diagnostics-YYYYMMDD-HHmmss-<shortId>.zip`

The renderer never supplies the output path. Main opens a native save dialog and writes only to the user-selected path.

## Limits

- Maximum bundle size: 20MB.
- Assembly timeout: 15 seconds after save target selection.
- Recent log cap: 256KB per log source.
- Unknown filesystem paths are not accepted.
- ZIP entries must be basename-only and may not contain traversal segments.

## Allowed Files

| File | Contents |
| --- | --- |
| `manifest.json` | Bundle metadata, file hashes, redaction policy result |
| `runtime-health.json` | Deployment health snapshot |
| `system-info.json` | Support-readable system information |
| `display-topology.json` | Electron display topology |
| `provider-status.json` | Provider status snapshot |
| `activation-status-redacted.json` | Public activation state, masked store, short installation ID |
| `network-failures.json` | Most recent classified Business Cloud failure, if any |
| `recent-main-logs.txt` | Capped recent main logs after path redaction and secret scan |
| `README.txt` | Bundle handling note |

## Manifest

`manifest.json` has schema version `1` and includes:

- `createdAt`
- `bundleName`
- `shortInstallationId`
- `maskedStoreCode`
- `appVersion`
- `distributionClass`
- `files[]` with `name`, `bytes`, `sha256`
- `redaction.policy = ALLOWLIST_THEN_SECRET_SCAN`
- `redaction.finalSecretScan = PASS`

## Failure Behavior

If redaction, traversal, size, timeout, or write checks fail, export returns a structured diagnostics failure and no unsafe bundle is produced.
