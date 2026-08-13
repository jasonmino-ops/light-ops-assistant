# Windows EXE Feasibility

Status: feasible, packaging not yet built, `NOT FIELD VERIFIED`.

## P0 packaging boundary

The core is an independent Node/TypeScript package with no import from the existing E-Shop web, POS, QZ, printing, or desktop runtime. It has a minimal diagnostic CLI and clean adapters for:

- Windows network inspection.
- Windows USB PnP printer discovery.
- MP4200 LAN discovery and exact packet parsing.
- Connect-only RAW TCP 9100 verification.
- Provisioning-plan gates.
- Windows driver inspection and queue command generation.

That boundary can be bundled into a dedicated `E-Shop-Printer-Tools.exe` without changing the existing product runtime.

## Feasible packaging paths

1. Node Single Executable Application: best fit for the current Node networking and child-process APIs and a small diagnostic executable. Final injection/signing should run in a controlled Windows build job using a pinned Node runtime.
2. A minimal independent Windows GUI host that calls the same adapter contracts: feasible after real-device protocol and driver gates are closed. The UI needs only Front, Kitchen, redetect, confirm role, READY, and test-print states.
3. A full Electron-style runtime is technically possible but is not justified for P0 and would add size and update/security surface.

P0 deliberately does not choose or add a GUI framework, code-signing certificate, installer technology, auto-updater, or vendor driver payload. Those decisions would expand scope before the hardware path is proven.

## Remaining packaging gates

- Run the CLI/core on Windows x64 and confirm PowerShell compatibility.
- Confirm whether Windows PowerShell 5.1 is sufficient or PowerShell 7 is required; current commands are designed for the inbox Windows printer/network cmdlets.
- Confirm UDP source port 4040 behavior under Windows Firewall and multi-NIC conditions.
- Confirm an RP331A-compatible signed driver and its exact `Get-PrinterDriver` name.
- Select x64 packaging, produce deterministic hashes/SBOM, sign the EXE, and validate on a clean Windows machine.
- Only after the standalone EXE is stable, decide whether a separate Setup EXE is needed.

Conclusion: `E-Shop-Printer-Tools.exe` is architecturally feasible. `E-Shop-Printer-Tools-Setup.exe` is premature until driver redistribution and unattended-install evidence exist.
