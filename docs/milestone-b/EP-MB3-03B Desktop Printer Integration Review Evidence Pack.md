# EP-MB3-03B Desktop Printer Integration Review Evidence Pack

## Baselines

- Desktop baseline: `cf9b44faa172769ef46945d24a8208bdbb003713`
- Desktop branch: `feat/ep-mb3-03b-desktop-printer-integration`
- Provider baseline: `10145c61e6b878daf0b7eb85064787147f73abc5`
- Provider branch: `feat/ep-mb3-03b-real-receipt-payload`
- Provider pinned commit: `8b95380481da66d897b34b63f1987a443d53aa5d`
- Desktop final reviewed commit: `2d81931e55c691b5dd9d4c7e040c794972d403cf`
- Frozen Contract: `1.0.0`
- Contract modified: No

## Final Print Chain

Cashier sale completion calls the Desktop print adapter.

- Electron Desktop: adapter calls `window.eshopDesktopPrinter.printReceipt(payload)`.
- Employee preload: fixed IPC invoke channel `desktop:printer:print-receipt`.
- Electron Main: validates payload, creates frozen `PRINT_RECEIPT` command.
- Desktop pipe client: sends `command.request` and waits for `command.result`.
- Windows Provider: validates `params.receipt`, maps to helper request.
- .NET helper: renders one bitmap and submits through Windows `PrintDocument`.
- Windows spooler: accepted submission is reported as `SUBMITTED`.

Browser fallback remains only for non-Electron browser usage.

## Receipt Schema

Renderer maps existing `DesktopReceiptData` into strict runtime receipt payload:

- No HTML, CSS, URL, file path, token, or full private member data.
- Maximum 200 items.
- String length limits and finite number checks.
- Quantity must be positive.
- Main process validates again before command creation.

## IPC Security

- Only employee preload exposes `window.eshopDesktopPrinter.printReceipt`.
- Customer preload does not expose printer APIs.
- No `ipcRenderer` object is exposed.
- IPC channel is fixed and whitelisted.
- Main verifies sender role and main frame.
- Renderer cannot choose device, command type, provider, or capability.

## Idempotency

Renderer adapter uses session-scoped keys:

- `receipt:{saleId-or-receiptId}:auto:v1`
- `receipt:{saleId-or-receiptId}:manual-initial:v1`

Auto print locks the manual button while in flight.

`SUBMITTED`, `TIMED_OUT`, and `UNKNOWN` prevent automatic retry in the current session.

## Command Transport

`WindowsProviderPipeClient` now supports:

- `command.request`
- `command.result`
- correlation pending map
- timeout cleanup
- pipe disconnect cleanup
- shutdown cleanup
- unknown correlation logging
- duplicate correlation protection
- pending map size protection

## Installer Pin

Desktop Windows workflow now checks out Provider commit:

`8b95380481da66d897b34b63f1987a443d53aa5d`

The workflow builds/tests Provider, publishes the .NET helper, packages Provider, stages it into Desktop resources, and verifies:

- `dist/index.js`
- `provider-manifest.json`
- `helper/win-x64/eshop-print-helper.exe`

## Health

Runtime health now includes minimal printer readiness:

- `providerConnected`
- `printerCapabilityAvailable`
- `configuredPrinterName`
- `printHelperPresent`
- `printerExecutorAvailable`
- `lastPrintCommandAt`
- `lastPrintOutcome`
- `lastPrintError`

It does not claim physical printer online state, paper state, or physical output completion.

## Local Verification

Desktop local:

- `desktop npm run typecheck`: PASS
- `desktop npm test`: PASS
- `desktop npm run compile`: PASS
- root `npm run build`: PASS

Provider local:

- `npm run type-check`: PASS
- `npm test`: PASS
- `npm run build`: PASS
- `npm run helper:build`: NOT RUN locally because `dotnet` is not installed on this macOS host

## Windows CI

Run:

- Workflow: `desktop-windows-build`
- Run ID: `29497425563`
- Run URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29497425563`
- Runner: `GitHub Actions 1000000267` / `windows-latest`
- Trigger commit: `2d81931e55c691b5dd9d4c7e040c794972d403cf`
- Final status: PASS

Verified steps:

- Node setup: PASS
- .NET setup: PASS
- Contract install/build: PASS
- Desktop install: PASS
- Provider install: PASS
- Exact Provider commit `8b95380481da66d897b34b63f1987a443d53aa5d`: PASS
- Provider tests: PASS
- Provider print helper publish: PASS
- Provider artifact build: PASS
- Provider artifact staged into Desktop packaging: PASS
- Desktop type check: PASS
- Desktop unit tests: PASS
- Main/preload compile: PASS
- Provider supervision pipe integration: PASS
- Provider `command.request` real receipt dry-run: PASS
- Electron runtime Provider smoke with spaces: PASS
- Provider process cleanup: PASS
- Windows installer build: PASS
- Packaged Provider resource verification: PASS
- Installer artifact upload: PASS

Installer artifact:

- Name: `eshop-desktop-windows-installer`
- Artifact ID: `8375049359`
- Digest: `sha256:59b13013f7116b80d9e8c3f0cb198b3b05b6cf88cf5bd488f91f5fcc3e2261eb`
- Size: `131779089` bytes
- Commit correspondence: `2d81931e55c691b5dd9d4c7e040c794972d403cf`
- Expires: `2026-10-14T12:15:05Z`

CI physical printer test: NOT RUN.

## Real Device Checklist

Pending XP-80C verification:

- Manual print from Desktop sale completion
- Auto print from Desktop sale completion
- No browser print popup in Electron Desktop
- Chinese readable
- Khmer readable
- Item quantity and amount correct
- Auto cut requested
- No duplicate print
- UI says `已提交打印`

## Deferred Scope

Not included:

- Raw ESC/POS
- Multi-printer routing
- Printer settings UI
- Cloud printing
- Kitchen printing
- Windows Service
- Database or API schema changes
- Sales flow rewrite
- Driver installation
- USB fault, paper-out, spooler-stop acceptance tests

## Known Limitations

- Local macOS cannot validate the .NET helper build because `dotnet` is not installed.
- CI does not prove physical paper output.
- Runtime result confirms command/spooler submission only, not physical completion.
