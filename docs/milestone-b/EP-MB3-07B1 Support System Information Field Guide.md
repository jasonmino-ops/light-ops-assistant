# EP-MB3-07B1 Support System Information Field Guide

## Purpose

The deployment error renderer exposes support-readable system information for first-line troubleshooting without exposing secrets.

## Fields

| Field | Meaning |
| --- | --- |
| Version | Desktop app version from Electron app metadata |
| Distribution | `UNSIGNED_INTERNAL` for B1 |
| Store | Masked store code |
| Installation ID | Short installation ID only |
| Activation | Public activation state |
| Cloud | Deployment Cloud health state |
| Provider | Provider health state |
| Displays | Display count and external display state |
| Logs | Log availability state |
| Last Failure | Last classified deployment failure code |
| Last Cloud Success | Last successful employee Cloud page load time |
| Windows | Windows version when running on Windows |
| Arch | Process architecture |
| Locale | Electron locale |
| Uptime Seconds | Runtime uptime |
| Printer Runtime | `BROWSER_PRINT / NATIVE_NOT_AVAILABLE` |
| Scanner Runtime | `KEYBOARD_MODE / NATIVE_NOT_AVAILABLE` |

## Support Actions

- Retry Cloud: starts bounded retry for employee Cloud page.
- Reload Business: manual reload of the Cloud business URL in the same employee window.
- System Info: shows/copies sanitized summary.
- Open Logs: opens the app log directory from Main; renderer provides no path.
- Export Diagnostics: exports the redacted diagnostics ZIP through native save dialog.
- Quit: exits the desktop runtime.
- Return to Activation: only succeeds if Main decides it is allowed.

## Interpretation

`FAILED` means the component blocks safe formal operation or diagnostics privacy.

`DEGRADED` means the store can continue with reduced capability, such as Browser Print or keyboard scanner mode while Provider is unavailable.

`UNKNOWN` means startup or verification has not produced a stable result yet.
