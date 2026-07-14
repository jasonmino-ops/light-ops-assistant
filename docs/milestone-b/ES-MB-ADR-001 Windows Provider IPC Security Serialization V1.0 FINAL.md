# ES-MB-ADR-001 Windows Provider IPC Security Serialization V1.0 FINAL

STATUS: ACCEPTED / CLOSED / FINAL
FINAL DECISION: Windows Named Pipe + Versioned JSON Schema Frames
APPROVAL AUTHORITY: Founder
APPROVAL DATE: 2026-07-14

## 1. Final Decision

Desktop Runtime and Windows Provider shall communicate through Windows Named Pipe using Versioned JSON Schema Frames.

## 2. Mandatory Controls

- Named Pipe is only for Desktop Runtime and Windows Provider.
- Store Applications must not connect directly.
- Provider must not expose a second application-facing entry point.
- Pipe ACL is mandatory.
- Pipe access must be limited to trusted principal(s).
- Arbitrary local processes must not call Provider.
- Runtime remains the only authoritative controller.
- Provider gains no business decision authority.

Every frame must include:

- Contract version.
- Message type.
- Correlation ID.
- Instance ID.
- Sequence or timestamp.
- Payload.

Protocol must define:

- Maximum frame size.
- Schema validation.
- Malformed frame behavior.
- Unknown message type behavior.
- Partial frame behavior.
- Truncated frame behavior.
- Timeout behavior.
- Disconnect behavior.
- Reconnect behavior.

No arbitrary JSON object may be accepted without schema validation.

## 3. Rejected Alternatives

- localhost HTTP as primary command transport: rejected because localhost is not automatically trusted and can become a second application-facing entry point.
- WebSocket as primary command transport: rejected for RC1 as it carries the same exposure risks without stronger Windows-local ACL properties.
- stdio as primary transport: rejected for RC1 because Provider is independently installed and not merely a Runtime child process.
- Unversioned JSON: rejected because Contract compatibility must be enforceable.

## 4. Consequences

- Windows transport tests are required.
- Contract schemas and validators are mandatory.
- Diagnostics must not bypass Contract transport controls.
- Store Applications remain behind Runtime-facing APIs.

## 5. Security Controls

- Pipe ACL verification.
- Provider identity and instance verification through ADR-02 handshake.
- Frame size limit.
- Schema validation before dispatch.
- Rejection of unknown, partial, truncated, or malformed frames.
- Log redaction for trust material and sensitive payloads.
- Provider impersonation defense.

## 6. Test Obligations

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

## 7. Closure Record

| Field | Value |
| --- | --- |
| Closure status | CLOSED |
| Decision | Windows Named Pipe + Versioned JSON Schema Frames |
| Authority | Founder |
| Date | 2026-07-14 |

## 8. Reopening Conditions

Reopen only if:

- Windows Named Pipe cannot satisfy real-device acceptance or security requirements.
- OS ACL behavior cannot be made reliable for the target deployment model.
- Contract frame format must change incompatibly.
- Founder explicitly orders ADR reopening.
