# E-Shop Printer Tools P0 — Supplemental Static Audit

Audit date: 2026-08-14. Software/binary conclusions in this document are `STATIC CONFIRMED` unless explicitly marked otherwise. Photograph and self-test facts are supplied physical reference evidence; they were not produced by this Mac audit and are not Windows golden-machine `FIELD VERIFIED`. No supplied executable was run against a printer.

## Evidence inventory

| Artifact | SHA-256 | Size | Static format/signature |
|---|---|---:|---|
| `IPSettingTool.exe` | `262c9e7cf6b12922e7ace67735440c9ee940ce626c524d59569d9275fd711084` | 17,920 | PE32 x86 .NET, unsigned |
| `rongtaprintertool_v2-63-0.zip` | `bc1493dc684977c1e80c36f08ab73154897d49cb8b34d632d628804f5a8d9f8e` | 2,822,240 | ZIP |
| outer `RongTaDriverInstall.exe` | `2b7699154235e8100eeb714a484da09fac33331ca12946ad65fa72beb57cb9df` | 18,438,643 | PE32 x86 Inno Setup 5.5.7 wrapper, unsigned |

Extracted Rongta components:

| Artifact | SHA-256 | Static format |
|---|---|---|
| `RongtaPrinterTool.exe` | `81f1dbfd8fa4d5f3a11266535403365dbddc9188b33441eefb69754adb2d20d6` | PE32 x86, unsigned |
| `PrinterTool.exe` | `f793af94b1f2058374006d7dafa6dfada4be709e946e7ce7c6216797b74d6cb0` | PE32 x86, unsigned |
| `ToolUseDll.dll` | `c820f53261afaa8fac8b4d31523ab8bf1871c6904318e09e3bc9d98b4d843b0` | native PE32 x86, unsigned |
| inner driver installer | `2e35513c57f0b5155b8543ccc81a2c655869ae36cf7406b689caa75156fa6f49` | PE32 x86, unsigned |

Hashes identify the audited inputs; they do not establish licensing, trust, redistribution permission, or RP331A compatibility.

## RP331A physical references

The supplied photographs establish two observed LAIMONTON / 来付通 RP331A variants from 安徽黑桃互联网科技有限公司:

- USB + Ethernet.
- Wi-Fi + USB + Ethernet.

The supplied network self-test page establishes one observed device configuration: EPSON ESC/POS mode, USB and 10/100 Ethernet, DHCP disabled, MAC `A8:01:57:30:27:A4`, IPv4 `192.168.1.87`, RAW port `9100`, mask `255.255.255.0`, gateway `192.168.1.1`, cutter/beeper/drawer enabled, and Chinese character mode enabled. These observed addresses are evidence only and are never application defaults.

The photos do not establish that RP331A is a Rongta-manufactured device or that it accepts Rongta drivers/protocols. That compatibility remains `NOT FIELD VERIFIED`.

## IPSettingTool protocol

`IPSettingTool.exe` identifies itself as `IP Setting Tool V1.01`. Its recovered .NET code binds a UDP client to `0.0.0.0:4040`, sends to the limited broadcast `255.255.255.255:1460`, and receives replies on the bound socket.

### MP4200FIND

Exact packet: ASCII `MP4200FIND`, 10 bytes, no NUL, framing, or checksum.

```text
4d 50 34 32 30 30 46 49 4e 44
```

The tool sends once per Search action. No internal retry or explicit discovery timeout was recovered.

### MP4200FOUND

The receiver searches for the 11-byte ASCII header anywhere in a received datagram. Starting at that header, the recovered layout is:

| Offset | Length | Field | Encoding |
|---:|---:|---|---|
| 0 | 11 | `MP4200FOUND` | ASCII |
| 11 | 6 | MAC | raw bytes |
| 17 | 2 | data length | little-endian; expected `15` |
| 19 | 4 | IPv4 | raw octets |
| 23 | 4 | subnet mask | raw octets |
| 27 | 4 | gateway | raw octets |
| 31 | 2 | printer port | little-endian |
| 33 | 1 | DHCP | `0` or `1` |

Total from header: 34 bytes. No model, manufacturer, firmware, serial, checksum, or device-ID field exists in this layout. Duplicate responses are keyed by normalized MAC.

### MP4200SAVE

The recovered write packet is:

| Offset | Length | Field | Encoding |
|---:|---:|---|---|
| 0 | 10 | `MP4200SAVE` | ASCII |
| 10 | 6 | target MAC | raw bytes |
| 16 | 2 | data length | little-endian `15` (`0f 00`) |
| 18 | 4 | target IPv4 | raw octets |
| 22 | 4 | subnet mask | raw octets |
| 26 | 4 | gateway | raw octets |
| 30 | 2 | printer port | big-endian/network order |
| 32 | 1 | DHCP | `0` or `1` |

Total: 33 bytes. No checksum, terminator, or separate reboot/apply command was recovered. After sending, the original UI sleeps approximately two seconds and searches again. Whether RP331A accepts, applies immediately, reboots, or acknowledges this packet is `NOT FIELD VERIFIED`.

The MAC field provides a target identity, but P0 additionally requires the operator-confirmed MAC to match before a packet can be built. P0 has no path that transmits SAVE.

### Same-L2 and cross-subnet behavior

The limited broadcast is intended to reach devices on the same layer-2 broadcast domain even when their configured IPv4 subnet differs from the Windows host. Routers normally do not forward `255.255.255.255`, so this is not routed cross-subnet discovery. Actual RP331A replies, host firewall behavior, switch behavior, and Windows multi-NIC source-interface selection are `NOT FIELD VERIFIED`.

## Rongta printer tool

`ToolUseDll.dll` imports Winsock, SetupAPI, IP Helper, Windows spooler, serial, and file APIs. Export/import evidence includes:

- UDP: `CreateMonitorUDPThread`, `GetLocalIp`, `sendUDPDataSearchPrinter`, `recvUDPSearchResult`, `_UDPRecvSearchPrinterResult@4`.
- USB: `getRongTaUSBPrinter`, `getAllRongTaUSBPrinter`, `getUSBPrinterByPidVid`, `getUSBPrinterByVid`, `getUsbPrinters`, `isRongtaUsbDev`.
- Transport/query: `RT_UsbConnect`, `RT_NetConnect`, `RT_QueryCmd`, `RT_SendCmd`, plus JPOS variants.

SetupAPI imports include `SetupDiGetClassDevsW`, `SetupDiEnumDeviceInterfaces`, `SetupDiGetDeviceInterfaceDetailW`, and `SetupDiGetDeviceRegistryPropertyW`, confirming native Windows USB/device enumeration paths. The DLL contains VID/PID-like recognition strings, including vendor IDs `04E7`, `1A86`, `303A`, `2ECC`, `2717`, `0D3A`, `4348`, `34D6`, `2730`, `20D1`, `0FE7`, `0FE5`, `0B3C`, `0A5F`, `04B8`, `0483`, `5346`, `1233`, `0DD4`, and `0FE6`, with nearby PID strings. Static string proximity alone is insufficient to assert every VID/PID pairing. No RP331A VID/PID evidence was found.

The tools contain `MP4200FIND`/`MP4200SAVE` and Ethernet configuration UI strings, supporting protocol-family overlap. `IPSettingTool.exe`, whose managed code was recovered, is the exact packet-layout authority used by P0.

## DIRECT_DLL constraints

The supplied DLL is x86 native MSVC code with mixed decorated cdecl/stdcall-style exports and runtime dependencies including `msvcr100.dll`, `msvcp100.dll`, `libintl`, and `libiconv`. Its complete ABI, ownership rules, error semantics, thread lifecycle, stability, redistribution rights, and x64 host behavior are not established. A 64-bit process cannot load this x86 DLL in-process.

## Driver automation

The outer installer exposes standard Inno Setup switches such as `/SILENT`, `/VERYSILENT`, `/SUPPRESSMSGBOXES`, `/NORESTART`, `/LOADINF`, and `/SAVEINF`. Those switches apply to the wrapper and do not prove a safe driver-only mode in the inner installer.

The extracted package contains both x86 (`SETUP`) and x64 (`SETUP64`) driver components. GPD/friendly model families include:

- `58Normal`
- `80Normal Printer`
- `RP58 Printer`
- `RP76`
- `RP76III`
- `RP80 Printer`
- `RP807 Printer`

Additional UI strings mention families such as TRP78, IRP42, RP80 Plus, 80mm Series, RPP210/300/200/02. No `RP331A` model string was found.

No `.INF` or `.CAT` payload was found. The inner installer imports spooler operations including `AddPrinterDriverW`, `AddPrinterW`, `AddMonitorW`, `AddPortW`, `XcvDataW`, and deletion APIs; its UI asks for Printer Model, Printer Port, and Printer Name. The observed path therefore provisions more than a driver. No inner unattended or driver-only command switch was statically confirmed.

Component DLLs contain Authenticode signer information for `Xiamen Rongta Technology Co.,Ltd.` with a legacy WoSign chain; the outer and inner installer executables are unsigned. This audit did not establish current trust validation or redistribution permission.

P0 therefore detects and idempotently reuses an installed driver by exact Windows driver name, but blocks missing-driver automation. The actual RP331A-compatible Windows driver name and safe automated provision path are `NOT FIELD VERIFIED`.

## Recommendation

Use `PROTOCOL_REIMPLEMENTATION` for the minimal, isolated MP4200 UDP adapter because the packet layouts are exact, small, testable, and need no vendor binary at runtime. Use supported Windows APIs for USB PnP discovery, driver inspection, and queue management. Keep `DIRECT_DLL` quarantined as a later fallback only if field evidence proves a capability that cannot be obtained reliably through protocol and Windows APIs, and only after ABI/licensing review.
