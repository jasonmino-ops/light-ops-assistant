# E-Shop Tray V0.1 — FIELD Cloud Relay Candidate

This FIELD-only candidate keeps the existing E-Shop Tray and Windows printing path, while moving Telegram mobile submission across E-Shop Cloud HTTPS.

```text
ST169E7000 Telegram OWNER
→ existing Sales Order Print Action
→ existing HTML / Bitmap / ESC/POS command stream
→ Cloud Print Job
→ E-Shop Tray poll / claim / execute / result
→ existing WindowsQueueTransport
→ fixed Windows queue “前台”
```

The Cloud Relay gate defaults OFF and accepts only `ST169E7000`. It is not a general task platform, heartbeat system, printer discovery service, multi-printer product, or new printing engine.

## FIELD binding

The OWNER opens `网络打印` and creates a one-time connection code through the existing Desktop activation identity. In Tray, choose `Connect FIELD Store` and enter that code. The resulting store-bound, revocable device bearer is stored only as Electron `safeStorage` ciphertext under the Windows user-data directory.

No long-lived credential is embedded in the installer. Other stores cannot create, claim, or update ES-TRAY-02 jobs.

## Cloud task reliability

- Cloud creation is idempotent per Store and idempotency key.
- Claim is atomic and uses a 30-second lease.
- `EXECUTING` work is never automatically re-leased.
- Tray persists ACCEPTED/EXECUTING/terminal recovery records before crossing the relevant boundary.
- A terminal result that could not reach Cloud is replayed without reprinting.
- An interrupted execution reports `CROSSING_UNKNOWN` and is not executed again.
- `SUCCEEDED` means Windows accepted the bytes; physical paper completion is never claimed.

## Existing Local API

`GET /v1/health`, `POST /v1/print`, port `17631`, CORS/PNA behavior, and the fixed `前台` queue remain unchanged for regression compatibility. The Telegram FIELD Browser path does not call the LAN API.

## Build

```bash
cd e-shop-tray
npm ci
npm run check
npm run dist:win
```

The unsigned x64 FIELD installer is:

```text
e-shop-tray/release/E-Shop-Tray-Setup-0.1.0-FIELD-CLOUD-RELAY.exe
```

It does not overwrite the formal, FIELD-SANDBOX, or FIELD-DIAGNOSTIC artifact filenames.

## FIELD check

1. Confirm the existing Windows RAW queue is named exactly `前台`.
2. Install the FIELD Cloud Relay candidate.
3. As the real Telegram OWNER for `ST169E7000`, open `/records → 网络打印` and create a connection code.
4. In Windows Tray choose `Connect FIELD Store`, enter the code, and confirm `Cloud Relay · Connected`.
5. Open a real completed sales order and press Print.
6. Confirm Tray `Last Job` / `Last Result`, Windows queue submission, and one physical print.

## Release boundary

- FIELD Store only: `ST169E7000`.
- Windows x64 only; unsigned candidate.
- One fixed queue: `前台`.
- No heartbeat, discovery, multiple printers, OTA, or extra hardware capabilities.
- Production printing/layout/order/payment baselines remain unchanged.
