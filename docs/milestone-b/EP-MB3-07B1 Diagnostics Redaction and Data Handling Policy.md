# EP-MB3-07B1 Diagnostics Redaction and Data Handling Policy

## Policy

Diagnostics export is fail-closed.

Pipeline:

1. Raw source collection from approved runtime sources.
2. Allowlisted schema reconstruction.
3. Path redaction for local home and userData paths.
4. Secret-pattern scan.
5. Bundle assembly.
6. Final secret-pattern scan.
7. ZIP write through native save dialog.

## Prohibited Data

Diagnostics must not include:

- device token
- PIN
- authorization header
- cookies or session values
- encrypted credential ciphertext
- full installation ID
- full store code by default
- customer phone, address, order, receipt, or payment details
- API response bodies or query strings
- environment variables
- home directory paths
- arbitrary filesystem files
- GitHub, signing, certificate, or Cloud secrets

## Renderer Boundary

The employee local renderer receives only fixed-method IPC results. It cannot provide paths, channel names, URLs, shell commands, or filesystem targets.

The customer fallback renderer receives no diagnostics IPC surface.

## Current Static Guards

- `tests/deployment-diagnostics.test.ts` checks taxonomy classification and metadata allowlists.
- `tests/deployment-ipc.test.ts` checks deployment IPC mode gating and no renderer path payloads.
- `tests/static-security.test.ts` checks preload channel strings and no Node capability exposure.
- `tests/ipc-whitelist.test.ts` locks the IPC channel set.
