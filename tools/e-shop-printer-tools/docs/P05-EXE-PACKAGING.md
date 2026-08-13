# E-Shop Printer Tools P0.5 — Windows EXE Packaging

## Result

P0.5 produces one Windows x64 GUI executable at `dist/windows/E-Shop-Printer-Tools.exe`, plus a machine-readable artifact manifest and independent-review note. Windows execution remains `NOT VERIFIED`; generation and inspection were performed on the Mac development machine.

## Packaging architecture

```text
E-Shop-Printer-Tools.exe (Windows x64 PE32+ GUI)
├── pinned Node.js v24.14.0 runtime
├── Node SEA resource
│   ├── existing P0 Core
│   ├── SAFE_MODE review service
│   ├── authenticated 127.0.0.1 read/preview API
│   └── embedded WinForms launcher script
└── Windows inbox runtime
    ├── Windows PowerShell 5.1
    └── .NET Framework WinForms
```

This avoids Electron, a browser window, an installer, and external Node/npm dependencies on the review machine.

## SAFE_MODE enforcement

- `SAFE_MODE` is compile-time `true`.
- `WRITE_OPERATIONS_ENABLED` is compile-time `false`.
- Local API routes are an explicit allowlist for status, network read, USB discovery, LAN discovery, redetect, front preview, kitchen preview, and kitchen TCP 9100 probe.
- There is no execute/save/install/print/queue-write route.
- The WinForms UI has no confirmation/execution button and prominently states that it will not modify printer or Windows configuration.
- Kitchen probe accepts only the IP belonging to the currently selected discovered printer and sends zero bytes.
- Existing P0 write adapter source remains outside the review UI execution path.

## GUI

The minimal WinForms window displays:

- Product name, P0.5 version, build commit, and SAFE_MODE warning.
- Current Windows interface, IPv4, mask, and gateway.
- Front USB printers with manufacturer/model, VID/PID, and PnP hardware identity.
- Kitchen printers with MAC, current IP, mask, gateway, port, and DHCP.
- FRONT/KITCHEN provisioning and queue previews.
- Connect-only TCP 9100 probe result.
- Local log path.

## Logging

Default path:

```text
%LOCALAPPDATA%\E-Shop Printer Tools\logs\e-shop-printer-tools.log
```

JSON-lines events cover startup/version/commit, network detection, USB/LAN discovery, discovered device identity, TCP 9100 probe, previews, and errors. The localhost session token is neither logged nor returned by the API.

## Reproducible build

Pinned build inputs:

- Node.js `v24.14.0` Windows x64 archive.
- `esbuild 0.28.2`.
- `postject 1.0.0-alpha.6`.
- `adm-zip 0.6.0`.

The Node archive is checked against the official release `SHASUMS256.txt`. Cross-platform SEA generation disables code cache and snapshot. Two clean builds must produce identical EXE and manifest hashes.

Commands:

```bash
npm ci
npm run check
npm run app:self-test
npm run package:windows
npm run verify:windows
npm run verify:repeatability
```

## Static artifact verification

The verifier requires:

- DOS `MZ` and PE signature.
- PE32+ optional header.
- x86-64 machine `0x8664`.
- Windows GUI subsystem.
- zero Authenticode certificate-table pointer/size (`Code Signed: NO`).
- embedded `NODE_SEA_BLOB` marker.
- embedded product name and exact build commit.
- manifest size/hash match.
- SAFE_MODE true, write operations false, and Windows execution not claimed.

## Review limitations

- Code signing is not performed.
- Windows PowerShell/WinForms startup is not executable on the Mac builder.
- Windows Firewall, endpoint protection, SmartScreen, PowerShell policy, CIM/Printer cmdlets, UDP 4040/1460, RP331A responses, and TCP 9100 are `NOT VERIFIED` until the golden-machine review.
- No FIELD VERIFIED claim is made.
