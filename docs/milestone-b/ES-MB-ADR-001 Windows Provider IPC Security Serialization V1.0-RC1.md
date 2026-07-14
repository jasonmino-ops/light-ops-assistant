# ES-MB-ADR-001 Windows Provider IPC Security Serialization V1.0-RC1

Status: PROPOSED / NOT APPROVED / NOT CLOSED

Title: DR to Windows Provider IPC, Security, and Serialization

## 1. Context

ES-MB-GATE-001 maps DR to Windows Provider IPC selection, IPC identity verification, local security boundary, Contract serialization, and version negotiation into ADR-01. The frozen architecture requires Desktop Runtime to remain the only local entry and Windows Provider to remain Provider Host + Executor.

## 2. Problem

Milestone B needs a local transport between Desktop Runtime and Windows Provider that can carry Provider Contract messages without allowing Store Applications or arbitrary local processes to control hardware.

## 3. Decision Drivers

- Windows support for USB, HID, Serial, and Windows Print API execution.
- Strong local access boundary.
- Contract version handshake.
- Correlation ID and timeout support.
- Crash/reconnect behavior.
- Testability in CI and self-hosted Windows runner.
- Long-term maintainability.
- No direct Store Application to Provider connection.

## 4. Options

| Option | Notes |
| --- | --- |
| Named Pipe | Windows-native local IPC, good ACL control, good fit for local process pair |
| localhost HTTP | Easy tooling, but broad attack surface unless authenticated and bound tightly |
| WebSocket | Useful for events, but needs same auth concerns as localhost HTTP |
| stdio child process | Simple if Runtime owns Provider process, weaker fit if Provider is independently installed/service-managed |
| Windows Unix-domain equivalent / local socket | Possible but less aligned with standard Windows operations than Named Pipe |

Technology stack context:

- .NET Worker / Windows Service: strong Windows API and service lifecycle fit.
- Node.js independent process: fast iteration and JSON-native, but native hardware APIs may require packages or bridges.
- Electron child process: convenient for Desktop ownership, but risks collapsing Provider into Runtime and complicating independent lifecycle.

## 5. Trade-offs

- Named Pipe gives the strongest Windows-local boundary but requires explicit schema framing and test harness.
- localhost HTTP is easiest to debug but easiest to accidentally expose to Store Applications or other local processes.
- WebSocket is attractive for scanner events, but should be layered over the same authenticated Contract if selected.
- stdio is simple for managed child process but conflicts with independent Provider lifecycle if ADR-03 selects service/user background process.

## 6. Proposed Decision

Recommended for approval:

- Use Windows Named Pipe as the preferred Contract transport for the formal Windows Provider.
- Use versioned JSON schema frames for RC1 unless ADR review requires a binary format later.
- Require every request/event envelope to include contract version, provider identity, runtime identity, correlation ID, timestamp, timeout budget, and message type.
- Use local authentication based on an installer-provisioned Runtime-Provider trust secret or OS ACL-backed identity binding. Final secret storage design remains an implementation task.
- For scanner events, use Provider-to-Runtime event frames over the same authenticated transport or a paired pipe, not a direct Store Application channel.
- Permit localhost HTTP only as a diagnostic surface bound to loopback and disabled by default, not as the primary command channel.

## 7. Consequences

- Provider cannot be debugged purely with browser tools; test harness must include pipe client utilities.
- Contract fixtures become mandatory.
- Runtime must own Provider connection supervision and reconnection.
- Store Applications remain behind Runtime APIs.

## 8. Security Impact

- Named Pipe ACLs and local trust handshake reduce accidental exposure.
- Arbitrary local process calls must fail without identity and handshake.
- Logs must redact trust material and message payloads that contain sensitive store data.

## 9. Operations Impact

- Support bundle must include Provider connection health, handshake version, pipe availability, and last error.
- Installer must provision or repair local trust material.

## 10. Testing Impact

- Contract transport tests require Windows runner.
- Authentication failure, timeout, reconnect, crash, malformed frame, and version mismatch tests are required.
- macOS can run schema and fixture tests but not final transport tests.

## 11. Migration Impact

- Legacy browser print, keyboard scanner, and Web Serial paths remain until Provider transport and HRT Core are accepted.
- No Store Application code may be migrated to call Provider directly.

## 12. Open Questions

- Exact trust material storage: DPAPI, user profile file with ACL, Windows credential store, or service account mechanism.
- Whether scanner event stream uses same pipe or paired event pipe.
- Whether diagnostic localhost endpoint is needed in RC1.
- Whether Contract schemas live first in main repo or separate package.

## 13. Closure Conditions

- Founder/CTO approves primary transport.
- Authentication and identity model documented.
- Envelope fields approved.
- Contract serialization format approved.
- Windows test harness scope approved.

## 14. Approval Record

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Founder | TBD | NOT APPROVED | TBD | Required before WS-2 |
| CTO | TBD | NOT CLOSED | TBD | Required before Provider WS |
