# E-Shop Printer Tools — P0 / P0.5

Independent, isolated printer configuration tooling for the future Windows executable `E-Shop-Printer-Tools.exe`.

P0 is a TypeScript core plus a read-only diagnostic CLI. It does not modify the existing Printing Core, ESC/POS Core, Browser POS, QZ, Desktop Runtime, E-Shop V1 Setup, or production paths. It also does not redistribute or load the supplied vendor binaries.

P0.5 packages that core into a single Windows x64 `E-Shop-Printer-Tools.exe`. The executable embeds Node.js and opens a minimal Windows WinForms review UI through the inbox Windows PowerShell/.NET components. `SAFE_MODE` is compile-time `true`; the review UI and its authenticated localhost API expose no printer, queue, driver, registry, firewall, or print write route.

## Frozen product roles

- `FRONT`: USB identity, then an idempotent Windows queue named `前台`.
- `KITCHEN`: LAN discovery first, network provisioning plan, RAW TCP 9100, then an idempotent Windows queue named `厨房`.
- Temporary USB recovery is a later capability and is not implemented in P0.

Every discovered device uses one common model:

```ts
{
  manufacturer,
  model,
  mac,
  ip,
  port,
  transport,
  capabilities,
  rawData,
  metadata
}
```

Unknown values stay `null`; RP331A manufacturer/model are never inferred from an MP4200FOUND packet because that packet has no such fields.

## P0 safety gates

- Network state is read from the target Windows machine at runtime; no store IP, mask, or gateway is hardcoded.
- A provisioning plan requires an explicit fingerprint match for the selected device.
- A new kitchen address is blocked until the conflict detector reports it available.
- TCP 9100 verification sends zero bytes.
- `MP4200SAVE` can be built and unit-tested but is not exposed through the CLI and is never transmitted by P0.
- Queue commands are generated only after the plan gates pass and reuse/repair existing state idempotently.
- Missing-driver automation remains blocked until RP331A driver compatibility and a safe driver-only installation path are field verified.

## Diagnostic CLI

```bash
npm install
npm run check
npm run cli -- --help
```

Available commands inspect Windows networking, USB PnP devices, and installed drivers; scan with exact `MP4200FIND`; decode captured `MP4200FOUND`; and perform a connect-only TCP 9100 probe. No CLI command writes printer configuration or changes a queue.

## P0.5 Windows EXE

```bash
npm run app:self-test
npm run package:windows
npm run verify:windows
npm run verify:repeatability
```

Artifact output:

```text
dist/windows/
├── E-Shop-Printer-Tools.exe
├── artifact-manifest.json
└── INDEPENDENT-REVIEW.txt
```

The build downloads the pinned official Node.js `v24.14.0` Windows x64 archive, verifies its SHA-256 against the release `SHASUMS256.txt`, bundles the app, creates a cross-platform SEA blob with snapshots/code cache disabled, removes the now-invalid upstream Authenticode certificate, injects the SEA resource, and changes the PE subsystem to Windows GUI. The review artifact is intentionally reported as unsigned.

## Evidence documents

- [Static audit](docs/STATIC-AUDIT.md)
- [Windows EXE feasibility](docs/WINDOWS-EXE-FEASIBILITY.md)
- [Windows golden-machine verification](docs/WINDOWS-FIELD-VERIFICATION.md)
- [P0 report](docs/P0-REPORT.md)
- [P0.5 EXE packaging](docs/P05-EXE-PACKAGING.md)

Evidence labels are strict:

- `STATIC CONFIRMED`: supported by supplied files, binary metadata, strings, imports/exports, or recovered code paths.
- `TEST VERIFIED`: exercised by deterministic fixture/unit tests only.
- `FIELD VERIFIED`: requires real execution on the Windows golden machine with the actual RP331A hardware. P0 contains no field-verified claims.
