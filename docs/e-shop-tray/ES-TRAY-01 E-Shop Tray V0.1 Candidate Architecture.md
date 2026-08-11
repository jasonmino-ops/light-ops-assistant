# ES-TRAY-01 — E-Shop Tray V0.1 Candidate Architecture

## Status

- Development: **CANDIDATE COMPLETE**
- Product scope: E-Shop Tray V0.1 only
- Printing Capability V1.1: reused, not modified
- Production deployment: not performed
- FIELD VERIFIED: pending Windows + phone + physical printer verification

## Final architecture

```text
Mobile Browser / existing Records print action
→ Runtime Client (`lib/eShopTrayClient.ts`)
→ Runtime Locator (explicit LAN URL → persisted URL → current private/local host)
→ LAN HTTP `http://<Windows-LAN-IP>:17631`
→ E-Shop Tray Local API
→ unchanged ESC/POS Print Command Stream
→ fixed Windows RAW queue `前台`
→ existing Windows driver / port
→ printer
```

The Browser retains the existing print action and existing Browser print fallback. When Tray is online, the same existing print HTML is passed to the existing 576px bitmap renderer and existing ESC/POS encoder. Only the completed `Uint8Array` crosses the Local Communication boundary.

Tray has no document model, receipt/kitchen logic, profile selection, rendering, image processing, language composition, encoding, printer discovery, queue selection, order state, identity, activation, cloud connection, heartbeat, or task queue.

## Local Communication V0.1

- Bind: `0.0.0.0:17631`
- Protocol: HTTP + JSON, version `0.1`
- Endpoints: `GET /v1/health`, `POST /v1/print`, CORS/PNA `OPTIONS`
- Locator: query parameter `eshopTray`, localStorage persistence, current private/local host only; no unconfigured LAN probing
- Request integrity: byte length + SHA-256 + canonical base64
- Browser trust: exact E-Shop origins only; no credentials sent
- Network trust boundary: private/local hostnames only, Host validation, private Windows Firewall profile only
- Concurrency: one in-flight print; additional request returns `409`, with no queue or retry
- Result: transport delivery only; it does not become a business fact

## Existing Printing reuse

Unmodified files:

- `app/components/OrderShareCard.tsx` — existing receipt HTML
- `lib/qzHtmlBitmapRenderer.ts` — existing 576px bitmap rendering
- `lib/qzEscPosBitImage.ts` — existing ESC/POS encoding/feed/cut and base64 utility
- `lib/qzPrinterAdapter.ts` — existing QZ transport remains unchanged

The new Windows transport performs only RAW delivery of the completed command stream to the already frozen queue `前台`. It does not inspect or change the stream.

## Browser behavior

1. User taps the existing Print button in Records.
2. Runtime Locator checks Tray health.
3. If Tray is absent before submission, the unchanged Browser print-window path runs.
4. If Tray is present, existing Printing Core creates the command stream and Runtime Client submits it once.
5. If the result is lost or delivery fails after submission, Browser does not auto-fallback, preventing duplicate print ambiguity.

## Installer and Windows Sandbox

The x64 NSIS installer is per-machine and unsigned. It installs the PowerShell/Winspool RAW delivery helper, opens private-profile inbound TCP `17631`, creates a Start Menu shortcut, starts Tray, and enables launch at login.

Windows Sandbox can validate install/start, single-instance behavior, firewall, health, CORS/PNA, schema validation, and deterministic missing-queue failure. A physical printer and existing `前台` queue remain required for FIELD VERIFIED output.

## Deferred

Cloud, Store Runtime, Activation, Store Identity, Task Queue, Heartbeat, Runtime Platform, Customer Display, Cash Drawer, Scanner, Raspberry Pi, Android/iOS native runtime, Bluetooth, AirPrint, multiple printers, printer discovery, and Print Center.
