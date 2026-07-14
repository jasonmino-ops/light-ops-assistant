# ES-MB-ADR-001 Windows Provider IPC Security Serialization V1.0-RC2

Status: RECOMMENDED FOR APPROVAL / FOUNDER PRINCIPLE DECISION RECORDED / NOT YET CLOSED

Title: Desktop Runtime to Windows Provider IPC, Security, and Serialization

## 1. Context

Milestone B requires a local transport between Desktop Runtime and Windows Provider. The founder principle decision recorded for RC2 is Windows Named Pipe plus Versioned JSON Schema Frames.

## 2. Problem

Runtime and Provider need authenticated local Contract transport without letting Store Applications or arbitrary local processes control hardware.

## 3. Decision Drivers

- Desktop Runtime remains authoritative controller.
- Provider is executor only.
- Store Applications must not connect to Provider.
- Local transport must support schema validation, correlation, timeout, reconnect, and compatibility.
- Malformed, partial, truncated, unknown, or oversized frames must fail safely.

## 4. Options Considered

- Windows Named Pipe.
- localhost HTTP.
- WebSocket.
- stdio child process.
- Windows local socket variants.

## 5. Recommended Decision

Use Windows Named Pipe plus Versioned JSON Schema Frames.

Mandatory controls:

- Named Pipe is only for Desktop Runtime and Windows Provider local communication.
- Store Applications must not connect to the pipe.
- Provider must not expose a second application-facing command API.
- Pipe ACL must restrict access to the current trusted user or explicitly authorized principal.
- Arbitrary local processes must fail authentication/authorization.
- Runtime remains the only authoritative controller.
- Provider gains no business decision authority from pipe availability.

## 6. Frame Requirements

Every frame must contain:

- `contractVersion`
- `messageType`
- `correlationId`
- `instanceId`
- `timestamp` or ordered sequence
- `payload`

Protocol must define:

- Maximum frame length.
- Frame boundary rules.
- Partial frame handling.
- Truncated frame handling.
- Malformed frame behavior.
- Unknown message type behavior.
- Timeout behavior.
- Disconnect behavior.
- Reconnect behavior.
- Schema validation before dispatch.
- Compatibility handling.

No arbitrary JSON object may be accepted without schema validation.

## 7. ACL and Ownership Model

- Pipe name ownership belongs to Desktop Runtime / HRT governance.
- Provider may bind only according to the approved Contract transport rules.
- Single-user behavior must be explicit.
- Multi-user session behavior must be explicit before production use.
- Provider impersonation must be rejected through identity, instance, and handshake validation.

## 8. Consequences

- Contract fixtures and validators become mandatory.
- Windows runner is required for transport tests.
- Debugging convenience cannot override pipe ACL and handshake rules.
- localhost must not be treated as trusted by default.

## 9. Security Impact

- Reduces attack surface compared with unauthenticated localhost APIs.
- Requires secret or OS identity handling.
- Requires log redaction for trust material and sensitive payloads.

## 10. Operations Impact

- Support bundle must include pipe reachability, ACL check result, last handshake, last malformed frame count, disconnect count, and timeout count.
- Diagnostics must not expose a command bypass.

## 11. Testing Impact

Required tests:

- Valid frame accepted.
- Missing schema rejected.
- Oversized frame rejected.
- Partial/truncated frame rejected.
- Unknown message type rejected.
- Timeout produces formal outcome.
- Disconnect/reconnect behavior.
- Store Application connection attempt rejected.
- Unauthorized local process rejected.
- Provider impersonation rejected.
- Compatibility mismatch rejected.

## 12. Migration Impact

Legacy remains in place until Runtime and Provider pass Contract transport tests and device vertical slice acceptance. No Store Application migrates to pipe access.

## 13. Open Questions

- Exact trust material storage.
- Single pipe versus paired command/event pipes.
- Whether a disabled-by-default diagnostic endpoint is needed.

## 14. Closure Conditions

- Pipe naming and ACL model approved.
- Frame schema base envelope approved.
- Maximum frame size approved.
- Malformed/partial/unknown handling approved.
- Timeout/reconnect behavior approved.
- Store Application prohibition test approved.
- Provider impersonation defense approved.

## 15. Approval Record

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Founder | TBD | PRINCIPLE DECISION RECORDED / NOT CLOSED | TBD | Windows Named Pipe + Versioned JSON Schema Frames |
| CTO | TBD | NOT CLOSED | TBD | Closure required before WS-2 implementation |
