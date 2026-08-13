# Exact Windows Golden Machine FIELD Verification Required Next

All steps below must run later on the designated Windows golden machine with real RP331A hardware. Nothing in this checklist is field verified by Mac development or fixtures.

## Preserve a before-state evidence bundle

1. Record Windows edition/build/architecture and PowerShell version.
2. Export `Get-Printer`, `Get-PrinterPort`, `Get-PrinterDriver`, `Get-NetIPConfiguration -All`, and relevant PnP printer devices.
3. Photograph both RP331A labels and print fresh self-test pages.
4. Record each physical device's role, serial, interfaces, MAC, current IP/mask/gateway/DHCP/port, and USB VID/PID/PNP identity.
5. Capture hashes and signatures of every installer/driver component used.

## Kitchen: LAN discovery first

1. Connect RP331A only by Ethernet to the store LAN; do not use USB.
2. Run a packet capture filtered to UDP ports 4040 and 1460.
3. Send one exact `MP4200FIND` and confirm source `4040`, destination `255.255.255.255:1460`, payload bytes, reply source/destination, and complete `MP4200FOUND` bytes.
4. Confirm extracted MAC/IP/mask/gateway/port/DHCP against the self-test page.
5. Confirm whether model, serial, or firmware can be obtained by any separate network query; do not infer them from FOUND.
6. Repeat with duplicate replies, two discoverable printers, multiple NICs, Windows Firewall enabled, and printer configured to a different IPv4 subnet on the same layer-2 LAN.
7. Confirm discovery fails across a routed layer-3 boundary unless an explicitly designed relay exists.

## Kitchen: controlled network provisioning

1. Use a non-production test LAN and preserve a physical recovery path.
2. Read the host IPv4/mask/gateway at runtime and generate the plan; verify no photographed address was used as a default.
3. Select an address only after ARP/ping/neighbor-table conflict checks and explicit operator confirmation of the target MAC.
4. Capture the exact `MP4200SAVE` bytes and verify MAC, length, IP, mask, gateway, big-endian port, and DHCP flag before transmission.
5. Transmit once under supervision; determine acknowledgment, apply delay, reboot behavior, DHCP behavior, and failure recovery.
6. Rediscover and compare self-test output. Confirm the device is reachable by TCP 9100.
7. Repeat the same requested state to prove idempotency and verify no duplicate queue/port is created.

## Front: USB identity and queue

1. Start with no printer queue, connect the intended front RP331A by USB, and capture PnP event/device data.
2. Confirm VID, PID, instance ID/serial stability, friendly model/manufacturer, USBPRINT identity, and the Windows USB port binding.
3. Verify reconnect, different USB socket, reboot, and a second similar printer do not cause identity confusion.
4. Confirm the user explicitly selects the discovered fingerprint before role assignment.

## Driver

1. On a clean snapshot, inspect the supplied installer UI and capture Procmon/SetupAPI/spooler logs.
2. Determine the exact RP331A-compatible model selection and resulting `Get-PrinterDriver` name, architecture, files, signatures, ports, monitors, and queues.
3. Determine whether the outer `/SILENT` or `/VERYSILENT` flow prompts, restarts, creates an unwanted queue, or selects defaults incorrectly.
4. Prove or reject a safe driver-only unattended path. Do not automate missing-driver provisioning until proven.
5. Verify licensing/redistribution permission separately from technical success.
6. When the driver already exists, confirm the adapter reuses it without reinstalling.

## Queue and readiness

1. Create/repair exactly `前台` on the confirmed USB port and `厨房` on a Standard TCP/IP RAW 9100 port.
2. Verify driver name, port name, host address, protocol, port number, queue status, and absence of duplicates.
3. Repeat every operation to prove idempotency.
4. Perform a test print only after the queue is verified; capture success/failure without changing the existing E-Shop printing core.
5. Restore the golden machine snapshot or document every persistent change.

Only successful evidence from these steps may be promoted to `FIELD VERIFIED`.
