# E-Shop Tray V0.1

E-Shop Tray is a minimal Windows tray application that lets the existing E-Shop mobile Browser print through a Windows machine on the same LAN.

```text
Existing Browser Print Action
→ ECCP Runtime Client
→ ECCP Runtime Locator
→ LAN HTTP :17631
→ E-Shop Tray
→ Existing ESC/POS Print Command Stream
→ fixed Windows queue “前台”
→ existing Windows driver / port / printer
```

It is not Store Runtime, Cloud Runtime, Activation, Identity, Task Queue, device discovery, or a printing center. It owns no receipt, kitchen, layout, language, bitmap, ESC/POS encoding, or business semantics.

## Browser configuration

The Runtime Locator uses the following candidates in order:

1. `eshopTray` URL parameter;
2. the last valid URL saved by that parameter in browser `localStorage`;
3. the current Browser hostname only when that hostname is already private/local.

Use the Windows LAN address shown in the Tray menu for initial setup:

```text
https://elifekh.com/records?eshopTray=http%3A%2F%2F192.168.18.10%3A17631
```

Only private IP, loopback, and `.local` HTTP endpoints on port `17631` are accepted. Chrome asks the user to allow Local Network Access. If no Tray is located before any print is submitted, the existing Browser print window remains the fallback. After a request is submitted to Tray, there is no automatic fallback, preventing an ambiguous response from producing a duplicate print.

An unconfigured public Browser does not probe the LAN and falls back immediately. This avoids changing print latency or triggering a Local Network Access prompt for existing merchants that have not installed Tray.

## Local API

### `GET /v1/health`

Returns the service version, protocol `0.1`, and `online` or `busy`.

### `POST /v1/print`

Headers:

```text
Content-Type: application/json
X-E-Shop-Tray-Protocol: 0.1
```

Body:

```json
{
  "protocolVersion": "0.1",
  "requestId": "browser-generated-id",
  "commandStream": {
    "encoding": "base64",
    "byteLength": 1234,
    "sha256": "64-lowercase-hex-characters",
    "data": "base64 ESC/POS command stream"
  }
}
```

The API accepts only the already generated command stream. It synchronously writes to the fixed Windows queue `前台`; concurrent requests return `409 TRAY_BUSY` and are not queued.

Browser CORS access is limited to `https://elifekh.com`, `https://www.elifekh.com`, and the two local development origins. The server also validates the Host header, command length, canonical base64, byte length, and SHA-256 digest. Maximum command size is 8 MiB.

## Build

```bash
cd e-shop-tray
npm ci
npm run check
npm run dist:win
```

The unsigned x64 installer is written to `e-shop-tray/release/E-Shop-Tray-Setup-0.1.0.exe`. The NSIS installer runs per-machine, adds a private-network Windows Firewall rule for TCP `17631`, creates a Start Menu shortcut, and starts Tray after installation. The app enables launch at Windows login on its first packaged start.

## Windows Sandbox / field check

1. Ensure the existing Windows RAW queue is named exactly `前台`.
2. Install `E-Shop-Tray-Setup-0.1.0.exe` and allow the installer elevation.
3. Confirm the Tray menu shows `Online · http://<LAN-IP>:17631`.
4. Run `scripts/windows-sandbox-smoke.ps1 -TrayHost <LAN-IP>` from another LAN device or inside Windows for API checks.
5. Use Tray `Test Print`; verify one sheet, feed, and cut.
6. On the phone, open `/records` once with the encoded `eshopTray` parameter, allow Chrome Local Network Access, and print an existing order.

Windows Sandbox without the existing `前台` queue can verify installation, startup, firewall, CORS, health, and deterministic print failure, but cannot establish physical `FIELD VERIFIED` output.

## Known release boundary

- Windows x64 only.
- One fixed queue: `前台`.
- No printer discovery or queue selection.
- Unsigned candidate installer; Windows SmartScreen may warn.
- Chrome Local Network Access is the target Browser path for LAN HTTP. Other mobile browsers require field confirmation.
