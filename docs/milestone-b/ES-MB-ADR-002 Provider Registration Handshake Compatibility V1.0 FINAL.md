# ES-MB-ADR-002 Provider Registration Handshake Compatibility V1.0 FINAL

STATUS: ACCEPTED / CLOSED / FINAL
FINAL DECISION: Runtime-Initiated Authoritative Handshake
APPROVAL AUTHORITY: Founder
APPROVAL DATE: 2026-07-14

## 1. Runtime Authority

Desktop Runtime is the authoritative controller. Windows Provider is a registered and supervised execution subject. Provider startup alone never grants business ownership or device readiness.

## 2. Provider Registration

Provider must be registered through a Runtime-initiated authoritative handshake. Provider must not self-assign ownership and must not self-declare READY.

## 3. Handshake

Handshake must exchange at least:

- Provider identity.
- Provider instance ID.
- Provider version.
- Contract version.
- Supported capabilities.
- Platform information.
- Process information.
- Optional diagnostic metadata.

## 4. Compatibility

- Contract version incompatibility blocks READY.
- Capability insufficiency blocks READY.
- Provider version must satisfy the compatibility matrix.
- Runtime must record rejection reasons and compatibility failure reasons.

## 5. READY Transition

Provider may enter READY only after:

- Runtime accepts Provider identity.
- Runtime accepts Provider instance ID.
- Runtime accepts Contract version.
- Runtime accepts Provider version compatibility.
- Runtime accepts required capabilities.
- Runtime accepts process health.

Handshake success does not imply device availability.

## 6. Stale Ownership Invalidation

- Provider restart requires re-registration.
- Old instance ownership must not automatically carry over.
- Runtime must invalidate old instance ownership.
- Capability changes require re-handshake.

## 7. Restart Behavior

After Provider restart:

- Runtime must treat it as a new instance.
- Provider must complete handshake before receiving business hardware commands.
- In-flight command state must follow approved Command Outcome and Side-Effect Boundary.

## 8. Health Separation

Provider health and device health are separate.

- Provider healthy does not mean a device is READY.
- Device unavailable does not mean Provider handshake failed.
- Both states must be reported distinctly.

## 9. Audit

Runtime must record:

- Accepted Provider identity.
- Accepted instance ID.
- Provider version.
- Contract version.
- Capability list.
- READY decision.
- Rejection reason.
- Compatibility failure reason.
- Restart/re-registration events.

## 10. Closure Record

| Field | Value |
| --- | --- |
| Closure status | CLOSED |
| Decision | Runtime-Initiated Authoritative Handshake |
| Authority | Founder |
| Date | 2026-07-14 |

## 11. Reopening Conditions

Reopen only if:

- Runtime-initiated handshake cannot support real Provider lifecycle.
- Compatibility matrix model fails in real-device acceptance.
- Provider identity/instance model must change incompatibly.
- Founder explicitly orders ADR reopening.
