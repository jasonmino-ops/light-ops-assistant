# ES-MB-ADR-002 Provider Registration Handshake Compatibility V1.0-RC1

Status: PROPOSED / NOT APPROVED / NOT CLOSED

Title: Provider Registration, Handshake, and Version Compatibility

## 1. Context

ES-MB-GATE-001 maps Provider registration, handshake, and version compatibility into ADR-02. The frozen architecture assigns Provider Ownership SoT to HRT and requires Windows Provider to execute Contract messages without becoming a second Runtime.

## 2. Problem

Runtime must know which Provider instance it is speaking to, what capabilities it has, which Contract versions it supports, what devices it can own, and whether it is healthy enough to receive commands or emit events.

## 3. Decision Drivers

- Provider identity must be stable and auditable.
- Runtime owns provider supervision.
- Capability must not imply business permission.
- Version mismatch must fail safely.
- Device discovery must not override Cloud Device Slot Definition.
- UNKNOWN and side-effect states must survive provider reconnects.

## 4. Options

| Option | Notes |
| --- | --- |
| Static config registration | Simple, but weak for upgrades and diagnostics |
| Runtime-initiated handshake on connection | Good control from Runtime, supports compatibility check |
| Provider self-registers on startup | Useful for service startup, but cannot become second entry point |
| Installer writes manifest consumed by Runtime | Good for version binding, insufficient for live health alone |

## 5. Trade-offs

- Runtime-initiated handshake keeps Runtime authoritative but requires Provider to be reachable before capability is known.
- Provider self-registration is operationally convenient but must not expose Provider as a public service.
- Installer manifest helps support and rollback but cannot replace runtime health.

## 6. Proposed Decision

Recommended for approval:

- Use Runtime-initiated handshake as the authoritative live registration flow.
- Use installer-generated Provider manifest only as supporting evidence for installed version and expected executable path.
- Handshake response must include:
  - provider identity;
  - provider instance ID;
  - provider version;
  - supported Contract versions;
  - platform;
  - capability list;
  - supported device families;
  - health summary;
  - diagnostics availability;
  - startup time;
  - trust status.
- Runtime accepts a Provider only if identity, trust, Contract version, and capability compatibility pass.
- Provider capabilities do not grant business permissions; Runtime/HRT still owns assignment, ownership, state, and command policy.

## 7. Consequences

- Provider Manager must exist in HRT Logic Core.
- Contract test fixtures must include compatible, incompatible, degraded, and unknown Provider handshake cases.
- Runtime can reject Provider without breaking Store Applications; Legacy rollback remains separate.

## 8. Security Impact

- Provider identity must be authenticated, not merely declared.
- Handshake must not leak secrets.
- Failed handshake must not expose command execution endpoints.

## 9. Operations Impact

- Support bundle must include installed manifest, last handshake, accepted Contract version, and rejection reason.
- Upgrade flow must validate compatibility before enabling Provider.

## 10. Testing Impact

- Tests for version mismatch, missing capability, identity mismatch, trust failure, degraded health, timeout, and reconnect are required.
- Windows runner required for live Provider process tests.
- macOS can execute schema fixtures.

## 11. Migration Impact

- Legacy remains active until handshake and capability are accepted for the target terminal.
- Cutover gate must verify accepted Provider ownership before disabling Legacy consumption.

## 12. Open Questions

- Exact Provider identity source: generated install ID, signed manifest, certificate thumbprint, or OS account binding.
- Whether multiple Provider instances can be installed but only one accepted.
- Version compatibility policy: N/N-1 or exact pair matrix for RC1.

## 13. Closure Conditions

- Handshake envelope approved.
- Provider identity model approved.
- Compatibility policy approved.
- Rejection and degraded-health behavior approved.
- Test fixture list approved.

## 14. Approval Record

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Founder | TBD | NOT APPROVED | TBD | Required before WS-2 |
| CTO | TBD | NOT CLOSED | TBD | Required before Provider Manager implementation |
