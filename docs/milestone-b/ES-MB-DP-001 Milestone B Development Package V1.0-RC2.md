# ES-MB-DP-001 Milestone B Development Package V1.0-RC2

Status: DRAFT FOR FINAL FOUNDER REVIEW / NOT APPROVED / NOT FROZEN

## 1. Document Control

| Field | Value |
| --- | --- |
| Document ID | ES-MB-DP-001 |
| Document name | Milestone B Development Package |
| Version | V1.0-RC2 |
| Status | DRAFT FOR FINAL FOUNDER REVIEW / NOT APPROVED / NOT FROZEN |
| Owner | CTO / Milestone B Owner |
| Reviewers | Founder, Verifier, Workstream Owners |
| Approval authority | Founder, one-package approval |
| Source baselines | ES-CONST-001, ES-STRAT-001, ES-HRT-001, ES-LEGACY-REGISTER-001, ES-MB-GATE-001 |
| Gate input | Gate C6 completed with recorded gaps |
| Repository | `/Users/jason/light-ops-assistant` |
| Pinned baseline HEAD | `52b8f944c3f9ae33d2e10340a12e0d9ce280ab87` |
| Pinned baseline title | `docs: freeze milestone b architecture entry gate` |
| Remote | `git@github.com:jasonmino-ops/light-ops-assistant.git` |

Explicit non-authorization statement:

- RC2 does not authorize business code.
- RC2 does not authorize Windows Provider repository initialization.
- RC2 does not authorize Contract directory creation.
- RC2 does not authorize branch creation.
- RC2 does not close ADR-01, ADR-02, or ADR-03.
- RC2 does not mark any document APPROVED or FINAL FROZEN.

## 2. RC1 to RC2 Change Summary

- Locked the Workstream structure to four Workstreams, including independent WS-4 Packaging, Release & Operations.
- Recorded ADR-01 founder principle decision: Windows Named Pipe plus Versioned JSON Schema Frames.
- Recorded ADR-02 founder principle decision: Runtime-Initiated Authoritative Handshake.
- Recorded ADR-03 founder principle decision for Milestone B RC1: Independently Installed Windows User-Session Background Process, to be re-evaluated after real-device acceptance.
- Locked Contract SoT to `jasonmino-ops/light-ops-assistant` at `packages/hrt-contract/`.
- Locked MB-3 Windows Hardware Ready as the hard Hardware Readiness Gate for WS-2 real-device finalization and acceptance.
- Removed RC1 ambiguity around WS-4, Contract SoT location, and ADR recommended directions.
- Added MB-4P, MB-4S, and MB-4D sub-gates.

## 3. Founder Principle Decisions

The following decisions are recorded in RC2 and are no longer open candidate choices:

1. Workstreams are locked as WS-1 Desktop Runtime / HRT Logic Core, WS-2 Windows Provider, WS-3 Legacy Adapter & Cutover, and WS-4 Packaging, Release & Operations.
2. ADR-01 recommended direction is Windows Named Pipe plus Versioned JSON Schema Frames.
3. ADR-02 recommended direction is Runtime-Initiated Authoritative Handshake.
4. ADR-03 recommended direction for Milestone B RC1 is Independently Installed Windows User-Session Background Process, with mandatory re-evaluation after real-device acceptance.
5. Contract SoT is `packages/hrt-contract/` in `jasonmino-ops/light-ops-assistant`.
6. MB-3 Windows Hardware Ready is a hard gate for real-device Executor finalization, WS-2 real-device acceptance, formal Provider release, and production hardware support claims.

## 4. Remaining Approval Items

Only the following remain for final approval:

1. Whether Development Package RC2 is formally approved.
2. Whether ADR-01 is formally closed.
3. Whether ADR-02 is formally closed.
4. Whether ADR-03 is formally closed for the Milestone B RC1 scope.
5. Whether creation of `packages/hrt-contract/` is authorized.
6. Whether Milestone B workstream branches are authorized.
7. Whether initialization of `jasonmino-ops/eshop-windows-hardware-provider` is authorized.
8. Whether Windows Provider repository visibility is finally private.
9. Windows test machine owner.
10. Three real-device acceptance owners.
11. Signing owner.
12. Release owner.

The following are not remaining decisions: whether to keep WS-4, whether Contract SoT is `desktop/src/shared/hrt-contract/` or `packages/hrt-contract/`, ADR-01 main direction, ADR-02 main direction, ADR-03 RC1 main direction, and whether to establish the Hardware Readiness Gate.

## 5. Executive Decision Summary

Milestone B establishes the formal Hardware Runtime path for E-Shop Store Operating System. It is not a traditional POS hardware retrofit and it does not widen Store Application access to hardware.

Architecture path:

```text
Store Applications
        |
        v
Desktop Runtime
        |
        v
HRT Logic Core
        |
        v
Provider Contract
        |
        v
Windows Provider
        |
        v
Windows / Hardware
```

Desktop Runtime remains the authoritative local controller. HRT Logic Core lives in the Desktop Runtime process domain. Windows Provider is Provider Host + Executor only. Provider is not Runtime, not a second entry point, and not directly callable by Store Applications.

Contract comes before device Executors. Same-process implementation still obeys Contract. Legacy remains contained, cannot expand, and migrates only by controlled adapter and cutover.

## 6. Scope

In scope:

- Desktop Runtime host enhancement.
- Contract-facing Runtime adapter.
- HRT Logic Core.
- Slot resolution.
- Physical identity model.
- Assignment.
- State.
- Health.
- Provider ownership.
- Command lifecycle.
- Scanner event lifecycle.
- Display snapshot lifecycle.
- Provider supervision.
- Simulator integration.
- Runtime-facing API and Store Application-facing API.
- Windows Provider Host.
- Contract client.
- Handshake.
- Printer Executor.
- Scanner Event Source.
- Customer Display Executor.
- Windows device discovery.
- Physical identity mapping.
- Driver interaction.
- Process health.
- Logging and diagnostics.
- Browser print adapter, USB scanner Legacy adapter, Web Serial display adapter.
- Cutover switches, command ownership, unique scanner consumer, no-double-send enforcement, rollback, and Legacy freeze enforcement.
- Installer, signing, compatibility matrix, release manifest, Runtime/Provider version binding, update, rollback, uninstall, clean-machine test, support bundle, diagnostics export, artifact checksum, SmartScreen handling, and release acceptance.

Out of scope:

- Camera scanning.
- Cloud printing.
- Electronic scale.
- Independent cash drawer device model.
- macOS Provider, Linux Provider, Android Provider, iOS Provider.
- New HMF capabilities.
- ERP or inventory-management expansion.
- Payment rewrite.
- POS UI redesign.
- Member system rewrite.
- Large Cloud data model rewrite.
- Store Application direct Provider calls.
- Automatic device control bypassing Runtime.
- Dual-sending Legacy and Provider commands.

## 7. Workstream Map

### WS-1 — Desktop Runtime / HRT Logic Core

Responsibilities:

- Contract-facing Runtime adapter.
- HRT Logic Core.
- Slot resolution.
- Physical identity model.
- Assignment.
- State, health, provider ownership.
- Command lifecycle.
- Scanner event lifecycle.
- Display snapshot lifecycle.
- Provider supervision.
- Simulator integration.
- Runtime-facing API.
- Store Application-facing API.

Deliverables:

- HRT core skeleton.
- Runtime adapter to `packages/hrt-contract/`.
- Provider simulator integration.
- State/health/ownership models.
- Contract tests and simulator tests.
- Runtime architecture record.

Acceptance:

- MB-1 and MB-2 gates pass.
- No direct Store Application to Provider dependency.
- UNKNOWN and side-effect boundary are test-covered.

### WS-2 — Windows Provider

Responsibilities:

- Provider Host.
- Contract client.
- Runtime-initiated handshake.
- Printer Executor.
- Scanner Event Source.
- Customer Display Executor.
- Windows device discovery.
- Physical identity mapping.
- Driver interaction.
- Process health.
- Logging.
- Diagnostics.
- Real-device acceptance.

Deliverables:

- Independent Provider repository after approval.
- Provider Host skeleton.
- Contract transport implementation.
- Device vertical slices.
- Provider architecture record.
- Device acceptance records.

Acceptance:

- ADR-01 to ADR-03 closed.
- MB-3 passes before real Executor finalization.
- MB-4P, MB-4S, MB-4D pass independently.

### WS-3 — Legacy Adapter & Cutover

Responsibilities:

- Browser print adapter.
- USB scanner Legacy adapter.
- Web Serial display adapter.
- Cutover switches.
- Command ownership.
- Unique scanner consumer.
- No-double-send enforcement.
- Rollback.
- Legacy freeze enforcement.

Deliverables:

- Legacy Execution Record content.
- Cutover records.
- Rollback evidence.
- No double-send and no double-consumption tests.

Acceptance:

- MB-5 passes.
- Legacy remains contained.
- Rollback does not duplicate print or scanner consumption.

### WS-4 — Packaging, Release & Operations

WS-4 is independent. Install, signing, upgrade, rollback, version compatibility, diagnostics, release, and clean-machine acceptance are not WS-2 miscellaneous tasks; they are release responsibilities with separate owners, gates, and acceptance evidence.

Responsibilities:

- Installer.
- Signing.
- Compatibility matrix.
- Release manifest.
- Runtime/Provider version binding.
- Update.
- Rollback.
- Uninstall.
- Clean-machine test.
- Support bundle.
- Diagnostics export.
- Artifact checksum.
- SmartScreen handling.
- Release acceptance.

Acceptance:

- MB-6 passes.
- Signed installer and checksum exist.
- Clean-machine install, upgrade, rollback, and uninstall are verified.

## 8. Contract SoT

Final RC2 Contract SoT decision:

| Field | Value |
| --- | --- |
| Repository | `jasonmino-ops/light-ops-assistant` |
| Path | `packages/hrt-contract/` |
| Status | Milestone B initial formal SoT after approval |

`desktop/src/shared/hrt-contract/` is not the formal SoT because Contract is not a Desktop Runtime internal implementation detail. Contract must be consumed by Desktop Runtime, Windows Provider, Simulator, Contract Tests, and future Platform Providers. Provider repositories must not copy/paste Contract and evolve independently.

Candidate structure, documented only in RC2 and not created in this turn:

```text
packages/hrt-contract/
├── schemas/
├── src/
├── fixtures/
├── compatibility/
├── tests/
└── README.md
```

Contract families:

- Provider lifecycle.
- Provider registration.
- Handshake.
- Compatibility.
- Health.
- Capability.
- Physical device identity.
- Assignment.
- Printer command.
- Scanner event.
- Customer display snapshot.
- Command outcome.
- Side-effect boundary.
- Error.
- Diagnostics.
- Version metadata.

Consumption principles:

- Main repository is the initial Contract SoT.
- Windows Provider consumes a fixed version package, schema artifact, or explicit release mechanism.
- Runtime and Provider must not directly reference each other's implementation.
- Contract versions must be traceable.
- Provider repository must not use unpublished main repository source paths as runtime dependencies.
- Contract package release mechanism must be defined before formal development.
- Without new ADR and founder approval, the SoT must not migrate.

## 9. ADR Relationship

- Development Package defines Workstreams, Gates, deliverables, and sequence.
- ADR-01 defines IPC, security, and serialization.
- ADR-02 defines registration, handshake, and version compatibility.
- ADR-03 defines installation, upgrade, rollback, and process supervision.
- ADR-01 to ADR-03 must be closed before formal Provider implementation.
- Contract documentation and schema definition may continue before ADR closure, but cannot enter implementation freeze until MB-0 and MB-1 conditions are satisfied.
- MB-0 approval must confirm both Development Package and ADR-01 to ADR-03.

## 10. Branch Strategy

Baseline remains `52b8f944c3f9ae33d2e10340a12e0d9ce280ab87` until final approval records a new implementation baseline.

Rules:

- Before RC2 approval, no development branch may be created.
- After approval, branches start from the specified formal baseline or the latest approved document baseline recorded at approval time.
- If RC2 document commit changes HEAD, the formal development baseline must be re-recorded.
- No Milestone B business development directly on `main`.
- Contract changes precede Provider implementation.
- WS-2 cannot precede formal Contract development.
- Each Workstream is independently accepted, merged, and rolled back.

Candidate branch names:

- `mb/ws1-hrt-logic-core`
- `mb/ws2-windows-provider`
- `mb/ws3-legacy-cutover`
- `mb/ws4-packaging-release`

This RC2 does not create these branches.

## 11. Development Sequence

Required sequence:

1. Package Final Approval.
2. ADR-01 to ADR-03 Closure.
3. Contract SoT Establishment.
4. Contract Definition.
5. Contract Fixtures / Contract Tests.
6. HRT Logic Core Skeleton.
7. Provider Simulator.
8. Runtime-Simulator Integration.
9. Windows Provider Repository Initialization.
10. Provider Host Skeleton.
11. Runtime-Provider Handshake.
12. Printer Vertical Slice.
13. Scanner Vertical Slice.
14. Customer Display Vertical Slice.
15. Legacy Cutover.
16. Packaging / Signing / Release.
17. Windows Real-Device Acceptance.
18. Final Freeze.

Rules:

- Do not simultaneously develop three real device Executors.
- Printer vertical slice comes first.
- Each vertical slice must pass independently before the next real device slice proceeds.
- MB-3 must pass before real Executor behavior is finalized.

## 12. Milestone Gates

| Gate | Name | Required evidence |
| --- | --- | --- |
| MB-0 | Package Approval | Development Package final approval, ADR-01 to ADR-03 closure, Contract SoT approval, Workstream approval, repository strategy approval, branch strategy approval, founder development authorization |
| MB-1 | Contract Ready | `packages/hrt-contract/` established, schema versioning, compatibility policy, fixtures, validator, Contract tests, Runtime and Provider consumption mechanism, no implementation dependency |
| MB-2 | Runtime Core Ready | HRT skeleton, health, ownership, command lifecycle, simulator integration, no direct hardware requirement |
| MB-3 | Windows Hardware Ready | Test machine and device facts verified; see Section 13 |
| MB-4P | Printer Vertical Slice Accepted | Printer Contract, Runtime path, Provider path, side-effect/UNKNOWN tests, real printer acceptance |
| MB-4S | Scanner Vertical Slice Accepted | Scanner event source, identity, sequence, unique consumer, continuous scan acceptance |
| MB-4D | Customer Display Vertical Slice Accepted | Snapshot Contract, Scope, Expiry, Last-Snapshot-Wins, reconnect acceptance |
| MB-5 | Legacy Cutover Accepted | No dual-send, unique scanner source, rollback effective, Legacy not expanded |
| MB-6 | Packaging & Release Accepted | Signed installer, clean-machine install, upgrade, uninstall, rollback, artifact, checksum, release manifest |
| MB-7 | Final Freeze | Acceptance records, known limitations, production boundary, freeze record |

## 13. MB-3 Windows Hardware Ready

MB-3 does not block:

- Contract documents and schema definition.
- HRT Logic Core skeleton.
- Provider repository initialization after final package approval.
- Provider Host skeleton.
- Contract client.
- Handshake.
- Health.
- Logging.
- Diagnostics skeleton.
- Simulator.
- Fake adapters.
- Process lifecycle.
- Installer skeleton.
- Tests that do not depend on concrete hardware parameters.

MB-3 blocks:

- Claiming support for a specific Xprinter model.
- Claiming support for a specific scanner.
- Claiming support for a specific USB customer display.
- Hard-coding unknown VID/PID.
- Hard-coding unknown COM port.
- Guessing customer display serial parameters.
- Guessing printer queue.
- Freezing unverified driver behavior.
- Finalizing real Printer Executor.
- Finalizing real Scanner Event Source.
- Finalizing real Customer Display Executor.
- Completing WS-2 real-device acceptance.
- Releasing formal Provider.
- Claiming Windows Hardware Runtime is production-ready.

## 14. Legacy Cutover

Printer:

- Browser print Legacy can remain as rollback path.
- After Provider print is enabled, a single command must not be sent to both Legacy and Provider.
- Command owner must be explicit.
- If print side effect is uncertain, do not automatically retry.
- UNKNOWN must not be rewritten.
- Rollback must not duplicate receipt printing for the same order.

Scanner:

- During Legacy page listener and HRT event source double-listen, business consumption source must be exactly one.
- Source arbitration is mandatory.
- No duplicate product lookup.
- No duplicate cart insertion.
- No event replay consumption.
- Scanner event must include source, device identity, sequence, and timestamp.

Customer Display:

- Web Serial is grandfathered fallback only.
- Provider enablement must not double-write.
- Last-Snapshot-Wins, Scope, and Expiry are required.
- Expired snapshots must not replay.
- Provider reconnect must not blindly replay historical amount; current valid scope must be confirmed first.

## 15. Security and Trust

Security requirements inherited from ADR-01 and ADR-02:

- Named Pipe ACL.
- Runtime identity.
- Provider identity.
- Instance identity.
- Contract version.
- Runtime-initiated handshake.
- Capability negotiation.
- Message validation.
- Maximum frame size.
- Command authorization.
- Replay protection.
- Malformed frame rejection.
- Log redaction.
- Secret storage.
- Diagnostics export controls.
- Store Applications must be rejected if they try to connect to Provider.
- Arbitrary local processes must not be able to call Provider.
- localhost is not automatically trusted.

## 16. Packaging, Release, and Operations

Requirements inherited from ADR-03:

- Provider is independently installed.
- Milestone B RC1 process model is user-session background process.
- One formal Provider instance per Windows user session.
- Crash restart backoff.
- Maximum restart limit.
- Installer owns installation.
- Release mechanism owns update.
- Runtime/Provider compatibility matrix.
- Provider does not self-upgrade.
- Signed installer.
- SmartScreen handling.
- Checksum.
- Release manifest.
- Rollback.
- Uninstall.
- Clean-machine acceptance.
- Logs.
- Support bundle.
- Process model must be re-evaluated after real-device acceptance.

## 17. Risks

| Risk | Impact | Mitigation | Owner | Gate |
| --- | --- | --- | --- | --- |
| Contract not established | Runtime and Provider diverge | Establish `packages/hrt-contract/` first | WS-1 | MB-1 |
| Named Pipe ACL weak | Local process abuse | ADR-01 closure and security tests | WS-2 | MB-1/MB-4 |
| Provider handshake too permissive | Untrusted Provider accepted | ADR-02 closure and rejection tests | WS-1/2 | MB-1 |
| User-session process fails with device permissions | Hardware unavailable | MB-3 and ADR-03 re-evaluation trigger | WS-2 | MB-3/MB-4 |
| Scanner double consumption | Duplicate sales item | Source arbitration and MB-5 | WS-3 | MB-5 |
| Printer side-effect uncertain | Duplicate or missed receipts | UNKNOWN and side-effect tri-state | WS-1/2 | MB-4P |
| Display stale replay | Wrong customer amount | Scope, Expiry, Last-Snapshot-Wins | WS-1/2 | MB-4D |
| Unsigned installer | SmartScreen and trust failures | Signing owner and MB-6 | WS-4 | MB-6 |

## 18. Explicit Prohibitions

- Do not expand HMF.
- Do not expand Web Serial.
- Do not expand browser hardware direct access.
- Do not allow Store Applications to call Provider.
- Do not let Provider make business decisions.
- Do not turn Windows Provider into a second Runtime.
- Do not restore old EHA repository as the formal repository.
- Do not develop device implementation before Contract approval.
- Do not dual-send print commands.
- Do not double-consume scanner input.
- Do not rewrite UNKNOWN as failure or success.
- Do not include camera scanning in Milestone B.
- Do not include cloud printing in HRT.
- Do not model cash drawer as a fourth device.
- Do not claim formal production support before signing and real-device acceptance.

## 19. Final Review Checklist

- [ ] Founder approves or rejects RC2.
- [ ] ADR-01 closed.
- [ ] ADR-02 closed.
- [ ] ADR-03 closed for Milestone B RC1.
- [ ] `packages/hrt-contract/` creation authorized.
- [ ] Workstream branches authorized.
- [ ] Windows Provider repository initialization authorized.
- [ ] MB-3 owner assigned.
- [ ] Signing and release owners assigned.
