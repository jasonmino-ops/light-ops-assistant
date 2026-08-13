# E-Shop Printer Tools P0 Report

## 1. Result

P0 is complete on the Mac development branch as an isolated TypeScript core and safe diagnostic CLI. Static audits, exact MP4200 protocol code, Windows abstractions, plan/queue gates, and unit tests are included. No deployment or real printer write occurred. `NOT FIELD VERIFIED`.

## 2. Branch

`codex/e-shop-printer-tools-p0`; `main` was not modified.

## 3. Commit SHA

The immutable SHA is recorded in the delivery response and the real Obsidian development record after Git creates the commit; a commit cannot embed its own final SHA.

## 4. Added / Modified Files

Only `tools/e-shop-printer-tools/**` is added: package/lock/config, source adapters, tests/fixtures, README, static audit, EXE feasibility, field checklist, and this report. No pre-existing production source file is modified.

## 5. Final P0 Architecture

Independent CLI/core → Windows network detection → USB and LAN discovery → RP331A/IPSetting and quarantined Rongta compatibility adapters → explicit-confirmation provisioning plan → driver inspection → idempotent queue plan → connect-only verification. It is not Printing Core V2.

## 6. Windows EXE Status

Standalone `E-Shop-Printer-Tools.exe` is feasible. The P0 CLI is directly runnable from source; no Windows EXE/GUI/Setup was built or field tested. Recommended next packaging experiment is a pinned x64 Node SEA after the Windows adapter path is proven. `NOT FIELD VERIFIED`.

## 7. RP331A Hardware Findings

Physical evidence shows LAIMONTON/来付通 RP331A USB+Ethernet and Wi-Fi+USB+Ethernet variants. One self-test proves USB, 10/100 Ethernet, static IPv4/DHCP setting, MAC, port 9100, ESC/POS, and cutter for that unit. Rongta relationship remains a compatibility candidate, not a fact.

## 8. USB Discovery Status

Generic Windows CIM/PnP enumeration, VID/PID extraction, stable fingerprint inputs, and fixture parsing are implemented. The Rongta native bridge remains injected and unloaded. RP331A USB hardware ID, descriptor, USB port mapping, and Rongta-tool detection are `NOT FIELD VERIFIED`.

## 9. LAN Discovery Status

Exact MP4200 broadcast discovery and binary response parsing are implemented independently. Duplicate MAC handling is implemented. RP331A response and Windows firewall/multi-NIC behavior are `NOT FIELD VERIFIED`.

## 10. IPSettingTool Protocol Findings

Managed-code audit recovered exact UDP bind/send/receive and FIND/FOUND/SAVE layouts. FOUND exposes MAC, IPv4, mask, gateway, port, and DHCP, but no model/firmware/device ID. SAVE targets raw MAC. No checksum, terminator, or separate reboot packet was recovered.

## 11. MP4200FIND Packet

ASCII `MP4200FIND`, exactly 10 bytes: `4d503432303046494e44`; no NUL/framing/checksum. One send per Search action was recovered.

## 12. MP4200FOUND Packet

From the located 11-byte header: header 11, MAC 6, little-endian length 2 (`15`), IPv4 4, mask 4, gateway 4, little-endian port 2, DHCP 1; total 34 bytes. The P0 parser validates length, mask, port, DHCP, and preserves raw hex.

## 13. MP4200SAVE Packet

Header 10, target MAC 6, little-endian length 2 (`15`), IPv4 4, mask 4, gateway 4, big-endian port 2, DHCP 1; total 33 bytes. P0 exact generation requires a matching confirmed MAC and is not exposed to any sender/CLI command.

## 14. Discovery UDP Port

Source bind `0.0.0.0:4040`; destination `255.255.255.255:1460`.

## 15. Cross-subnet Discovery Feasibility

Limited broadcast may reach a printer configured for another IPv4 subnet when both are on the same L2 broadcast domain. It normally will not cross a router. RP331A and Windows behavior are `NOT FIELD VERIFIED`.

## 16. Rongta Tool Findings

Supplied tools/DLL are x86. Native exports/imports confirm SetupAPI USB enumeration, Winsock UDP discovery, Windows spooler access, and Rongta query/send paths. MP4200 strings overlap with IPSettingTool. The DLL has mixed native ABI naming and VC++ 2010/libintl/libiconv dependencies. No RP331A identity evidence was found.

## 17. Rongta Driver Automation Findings

Outer Inno wrapper has standard silent switches and x86/x64 payloads, but the inner installer creates drivers/ports/queues and no safe driver-only unattended mode is confirmed. No INF/CAT or RP331A model string was found. P0 reuses an exact installed driver idempotently and blocks automatic missing-driver provisioning.

## 18. TCP 9100 Probe Status

Implemented connect-only success/timeout/refused/error classification; socket closes immediately and sends zero bytes. Fixture-tested, `NOT FIELD VERIFIED` on RP331A.

## 19. Provisioning Plan Status

FRONT/USB and KITCHEN/NETWORK only. Runtime Windows subnet/gateway selection, safe edge candidate selection, conflict hook, same/different subnet handling, exact role queue, explicit fingerprint confirmation, and write blockers are implemented and fixture-tested.

## 20. Windows Queue Adapter Status

PowerShell command generation and state validation support idempotent `前台` USB and `厨房` Standard TCP/IP RAW 9100 create/repair behavior. Commands are generated only after plan gates. Not executed on Windows; `NOT FIELD VERIFIED`.

## 21. DIRECT_DLL vs PROTOCOL_REIMPLEMENTATION Recommendation

Prefer the exact minimal IPSetting protocol reimplementation for LAN plus supported Windows APIs for USB/driver/queue. Keep Rongta DIRECT_DLL as a quarantined fallback pending RP331A need, full ABI/lifetime/error review, redistribution permission, and x86 isolation. Do not broadly reverse or reimplement unneeded Rongta paths.

## 22. Tests

31 deterministic tests cover network parsing, invalid masks, multiple NICs, USB empty/one/malformed, generic Windows PnP parsing, Rongta heuristic fixtures, exact FIND/FOUND/SAVE bytes and malformed packets, duplicate MAC, roles, provisioning candidates/conflicts/confirmation, TCP probe outcomes, driver reuse/block, and idempotent queue plans. TypeScript build and all tests pass.

## 23. What Is STATIC CONFIRMED

Artifact hashes/formats, IPSetting UDP endpoints and packet layouts, Rongta exports/imports/dependencies/x86 status, driver bundle architecture/model strings/spooler behavior, outer wrapper switches, absence of RP331A string and INF/CAT in extracted payload, and source-level P0 architecture. Photo/self-test facts are separately identified as supplied physical reference evidence.

## 24. What Is TEST VERIFIED

The 31 fixture/unit-test behaviors described in item 22, including exact protocol byte vectors and safety gates.

## 25. What Is NOT FIELD VERIFIED

Every Windows execution and RP331A interaction: USB identity/port, Rongta compatibility, actual LAN reply, cross-subnet discovery, SAVE acceptance/apply/reboot, driver compatibility/name/install, queue execution, TCP 9100 reachability, test print, READY state, Windows EXE packaging, signing, and installer behavior.

## 26. Production Modified: YES / NO

NO.

## 27. Printing Capability Modified: YES / NO

NO.

## 28. E-Shop V1 Setup Modified: YES / NO

NO.

## 29. Exact Missing Evidence

Real RP331A USB VID/PID/Hardware ID/descriptors/serial stability/USB port binding; actual MP4200 capture and parsed values; model/firmware query availability; same-L2 old-subnet behavior; SAVE acknowledgment/apply/reboot/recovery; exact compatible signed driver name/files/architecture; safe driver-only unattended path and redistribution rights; Windows firewall/multi-NIC behavior; queue/test-print/READY evidence; Windows EXE clean-machine execution/signing evidence.

## 30. Exact Windows Golden Machine FIELD Verification Required Next

Preserve before-state → capture USB/PnP and UDP evidence → prove LAN-first discovery with no USB → confirm MAC and plan → controlled conflict-checked SAVE on an isolated LAN → rediscover/self-test/TCP 9100 → verify driver on clean snapshot → create/repair `前台` and `厨房` twice → test print → verify READY/idempotency → preserve artifacts and restore/document state. The detailed checklist is in `WINDOWS-FIELD-VERIFICATION.md`.
