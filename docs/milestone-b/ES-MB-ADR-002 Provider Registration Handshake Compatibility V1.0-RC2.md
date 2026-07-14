# ES-MB-ADR-002 Provider Registration Handshake Compatibility V1.0-RC2

Status: RECOMMENDED FOR APPROVAL / FOUNDER PRINCIPLE DECISION RECORDED / NOT YET CLOSED

Title: Provider Registration, Handshake, and Version Compatibility

## 1. Context

Milestone B requires Runtime to supervise Windows Provider without letting Provider own business decisions. The founder principle decision recorded for RC2 is Runtime-Initiated Authoritative Handshake.

## 2. Problem

Runtime must verify Provider identity, instance, version, Contract compatibility, capabilities, and health before Provider can participate in hardware execution.

## 3. Decision Drivers

- Desktop Runtime is authoritative controller.
- Provider is registered and supervised executor.
- Provider startup alone cannot grant device business ownership.
- Provider health and device health must remain separate.
- Compatibility failure must be recorded and must not enter READY.

## 4. Options Considered

- Static config registration.
- Runtime-initiated handshake.
- Provider self-registration.
- Installer manifest only.

## 5. Recommended Decision

Use Runtime-Initiated Authoritative Handshake.

Mandatory rules:

- Desktop Runtime is authoritative controller.
- Provider is a supervised execution subject.
- Provider cannot self-assign business ownership.
- Provider cannot self-declare READY.
- Runtime initiates and completes the authoritative handshake.
- Provider restart requires re-registration.
- Old instance ownership does not automatically carry over.
- Runtime invalidates stale ownership for old instances.
- Capability changes require re-handshake.
- Handshake success does not mean device availability.
- Provider health is separate from device health.

## 6. Handshake Data

Handshake must exchange at least:

- Provider identity.
- Provider instance ID.
- Provider version.
- Contract version.
- Supported capabilities.
- Platform information.
- Process information.
- Optional diagnostic metadata.

Runtime must record:

- Accepted or rejected status.
- Rejection reason.
- Compatibility failure reason.
- Capability insufficiency reason.
- Last successful instance.
- Last rejected instance.

## 7. READY Transition

Provider may enter READY only when:

- Provider identity is accepted.
- Instance ID is current.
- Contract version is compatible.
- Provider version is allowed by compatibility matrix.
- Required capabilities exist.
- Runtime trust validation passes.
- Provider process health is acceptable.

Device READY is separate and requires device-level state.

## 8. Disconnection and Restart

When Provider disconnects:

- Runtime owns device ownership/state transition.
- New commands must not be issued to disconnected Provider.
- In-flight commands must resolve according to frozen Command Outcome and Side-Effect Boundary.
- Reconnected Provider must handshake again.
- Runtime must not assume old instance state is valid.

## 9. Compatibility Matrix

Handshake must support Runtime/Provider/Contract compatibility matrix. Contract version mismatch or unsupported Provider version blocks READY.

## 10. Security Impact

- Provider identity must be authenticated, not just declared.
- Instance ID prevents stale process takeover.
- Rejected Providers must not execute commands.

## 11. Operations Impact

- Logs and diagnostics must show Provider identity, instance ID, version, Contract version, capability summary, READY decision, and rejection reason.

## 12. Testing Impact

Required tests:

- Compatible Provider accepted.
- Contract version mismatch rejected.
- Capability missing rejected.
- Provider restart requires re-handshake.
- Old instance ownership invalidated.
- Health degraded does not imply device failure.
- Device unavailable does not imply Provider handshake failure.
- Capability change requires re-handshake.

## 13. Migration Impact

Legacy cannot cut over until Provider handshake, capability, and device readiness gates pass for the terminal.

## 14. Open Questions

- Exact Provider identity material.
- Exact compatibility matrix format.
- Multiple installed Provider behavior before single accepted instance is selected.

## 15. Closure Conditions

- Handshake envelope approved.
- Identity and instance model approved.
- READY transition approved.
- Compatibility matrix format approved.
- Rejection reason taxonomy approved.
- Disconnect/reconnect state handling approved.
- Provider health vs device health separation approved.

## 16. Approval Record

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Founder | TBD | PRINCIPLE DECISION RECORDED / NOT CLOSED | TBD | Runtime-initiated authoritative handshake |
| CTO | TBD | NOT CLOSED | TBD | Closure required before Provider Manager implementation |
