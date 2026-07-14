# ES-MB-DP-001 Milestone B Development Package V1.0-RC1

Status: DRAFT FOR FOUNDER REVIEW / NOT APPROVED / NOT FROZEN

## 1. Document Control

| Field | Value |
| --- | --- |
| Document ID | ES-MB-DP-001 |
| Document name | Milestone B Development Package |
| Version | V1.0-RC1 |
| Status | DRAFT FOR FOUNDER REVIEW / NOT APPROVED / NOT FROZEN |
| Owner | CTO / Milestone B Owner |
| Reviewers | Founder, Verifier, Workstream Owners |
| Approval authority | Founder, one-package approval |
| Source baselines | ES-CONST-001, ES-STRAT-001, ES-HRT-001, ES-LEGACY-REGISTER-001, ES-MB-GATE-001 |
| Gate input | Gate C6 completed with recorded gaps |
| Repository | `/Users/jason/light-ops-assistant` |
| Pinned HEAD | `52b8f944c3f9ae33d2e10340a12e0d9ce280ab87` |
| Pinned HEAD title | `docs: freeze milestone b architecture entry gate` |
| Remote | `git@github.com:jasonmino-ops/light-ops-assistant.git` |

Change control:

- This document may be revised until founder approval.
- After approval, implementation changes must reference the approved package and corresponding gate.
- This RC1 does not authorize business code, Provider code, Contract implementation code, repository initialization, migration, commit, or push.
- Frozen upstream assets are inherited and not reopened by this document.

Freeze rule:

- This document is not final and not frozen.
- It may become a freeze candidate only after founder review, ADR-01 to ADR-03 closure, and explicit approval record.

Local workspace discipline:

- Formal implementation baseline is the pinned HEAD above.
- Existing untracked or ignored local assets must not be mixed into Milestone B commits: `docs/.review-workspace/`, `docs/strategy-whitepaper-v1/`, `runtime/`, `tmp/`, `zz-test-delete.txt`, local ignored Xprinter driver package, disaster recovery packages, `.env`, and other secret files.
- `runtime/print_logs/*` may be used only as historical evidence, not as formal HRT state or acceptance data.
- These local paths must not be cleaned or altered before this package is approved unless a separate founder-approved housekeeping task exists.

## 2. Executive Decision Summary

Milestone B exists to move E-Shop from grandfathered browser and page-local hardware behavior into the frozen Store Operating System hardware boundary:

Store Applications -> Desktop Runtime -> HRT Logic Core -> Provider Contract -> Windows Provider -> Windows / Hardware.

Milestone B is not a traditional POS hardware retrofit. It establishes the operating-system layer that makes hardware controlled, observable, testable, reversible, and distributable without allowing store applications to bypass Runtime.

Milestone B must build formal capability in this order:

1. Provider Contract.
2. HRT Logic Core inside Desktop Runtime.
3. Windows Provider as an independent Provider Host + Executor.
4. Device vertical slices for Printer, Scanner, and Customer Display.
5. Legacy adapter and cutover gates.
6. Packaging, release, signing, diagnostics, and real-device acceptance.

Legacy cannot continue to expand because it lacks the frozen HRT properties: physical identity, assignment runtime, provider ownership, device state/health, formal command outcome, UNKNOWN preservation, side-effect boundary, scanner event lifecycle, display scope, display expiry, and controlled cutover.

Windows Provider must be independent because the frozen architecture assigns it Provider Host + Executor responsibility only. It is not Runtime, not a second entry point, and not a direct API surface for Store Applications.

Contract must precede device Executor implementation because the same Contract governs in-process and cross-process cases. Same-process implementation does not waive Contract.

## 3. Milestone B Objective

Milestone B will establish:

- Formal HRT Logic Core hosted inside Desktop Runtime.
- Formal Provider Contract SoT.
- A new official Windows Provider repository for the E-Shop Windows Hardware Provider.
- Unified logical boundary for the first three device families: Xprinter 80mm USB printer, USB keyboard-wedge scanner, and USB customer display.
- Printer Contract support for cash drawer pulse only as an attached printer action, not as a fourth device.
- Legacy adapters and cutover controls for browser print, keyboard-wedge scanner, and Web Serial customer display.
- Testable, observable, rollback-capable, signed, installable, supportable Windows runtime/provider foundation.

## 4. In Scope

- Desktop Runtime host enhancement.
- HRT Logic Core.
- Provider Contract.
- Windows Provider.
- Xprinter 80mm USB printer.
- USB keyboard-wedge scanner.
- USB customer display.
- Printer Contract attached cash drawer action.
- HRT health, state, ownership, assignment, physical identity.
- Legacy adapter and cutover.
- Contract tests, simulator tests, Windows CI, and real-device acceptance.
- Installer, signing plan, diagnostics, release artifact, checksum, support bundle.

## 5. Out of Scope

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

## 6. Architecture Placement

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

Facts and ownership:

- E-Shop Cloud is the SoT for Device Slot Definition.
- Runtime/HRT owns Physical Device Identity, Assignment Runtime, Device State, Device Health, and Provider Ownership.
- Provider executes Contract messages. It does not make business decisions.
- Provider cannot become a second entry point.
- Store Applications cannot connect to Provider directly.
- Same-process execution still obeys Contract.
- `/desktop/pos` is a browser page that reuses `CashierPage`; it is not the Desktop Runtime itself.

## 7. Workstream Map

### WS-1 — Desktop Runtime / HRT Logic Core

Responsibilities:

- HRT Logic Core.
- Device model and slot resolution.
- Assignment runtime.
- Device state, health, ownership.
- Command lifecycle.
- Scanner event lifecycle.
- Customer display snapshot lifecycle.
- Provider supervision.
- Runtime-facing API.
- Store Application-facing API.

Inputs:

- Frozen HRT baseline.
- Gate C6 facts.
- Existing Electron Desktop shell in `desktop/`.
- Existing `hardwareManager.ts` only as a placeholder fact, not as Contract SoT.

Outputs:

- HRT Logic Core skeleton.
- Runtime HRT API facade.
- Provider supervision abstraction.
- Simulator/mock Provider.
- State/health/audit models.
- Contract test harness.

Suggested code area:

- `desktop/src/main/hrt/`
- `desktop/src/shared/hrt-contract/` only if Contract SoT remains in main repository.

Acceptance:

- No real hardware required for MB-2.
- Unit and simulator tests pass on macOS and Windows runner.
- UNKNOWN is preserved.
- Six-value command outcome and side-effect tri-state are test-covered using upstream frozen definitions.
- No Store Application direct Provider dependency.

Forbidden:

- Expanding HMF as control plane.
- Treating `hardwareManager.ts` placeholder as final Contract.
- Adding device-specific Windows execution in WS-1.

Dependencies:

- Contract SoT decision.
- ADR-05 before durable persistence implementation.

### WS-2 — Windows Provider

Responsibilities:

- Provider Host.
- Printer Executor.
- Scanner Event Source.
- Customer Display Executor.
- Windows device discovery.
- Windows identity mapping.
- Driver interaction.
- Process health.
- Installer-facing logs and diagnostics.

Repository:

- Candidate: `jasonmino-ops/eshop-windows-hardware-provider`.
- Must be initialized as a formal independent repository before WS-2 coding starts.

Outputs:

- Windows Provider implementation.
- Contract server/transport implementation.
- Device executors and scanner event source.
- Diagnostics CLI or support endpoint.
- Provider logs.
- Installer artifact input.

Acceptance:

- ADR-01 to ADR-03 closed.
- Windows Hardware Readiness Gate satisfied.
- Windows-only CI passes.
- Provider Contract tests pass against Runtime and Provider.
- Real-device acceptance passes for each device vertical slice.

Forbidden:

- Store Applications directly calling Provider.
- Provider owning business decisions.
- Reusing old EHA repository as formal repository.
- Starting Executor implementation before Contract approval.

### WS-3 — Legacy Adapter & Cutover

Responsibilities:

- Browser print Legacy Adapter.
- Keyboard scanner Legacy Adapter.
- Web Serial customer display Legacy Adapter.
- Runtime feature/cutover gates.
- Single business consumption source during scanner double-listen.
- No dual-send for command devices.
- Rollback and audit records.
- Legacy freeze enforcement.

Outputs:

- Legacy Execution Record content for browser print.
- Device cutover records.
- Per-terminal rollback controls.
- Acceptance evidence that Legacy remains contained and does not expand.

Acceptance:

- No duplicate print command.
- No duplicate scanner consumption.
- Customer display Last-Snapshot-Wins, Scope, Expiry honored after migration.
- Rollback demonstrated.

Dependencies:

- ADR-06 before first Legacy switch.
- Corresponding device vertical slice acceptance.

### WS-4 — Packaging, Release & Operations

This package defines WS-4 separately because Gate C6 found unsigned installer, no release version binding, no signing chain, and no formal clean-machine release flow.

Responsibilities:

- Installer.
- Code signing.
- Runtime and Provider independent versions.
- Compatibility matrix.
- Release manifest.
- Checksum.
- Update ownership.
- Rollback.
- Clean-machine install.
- Uninstall.
- Support bundle.
- Diagnostics export and log redaction.

Acceptance:

- Signed Windows installer.
- Clean-machine install and uninstall pass.
- Upgrade and rollback pass.
- Artifact, manifest, checksum, and support bundle archived.

## 8. Contract SoT

Recommended Contract SoT for approval:

- Place the initial Contract SoT in the main repository under `desktop/src/shared/hrt-contract/` or `packages/hrt-contract/` until the Provider repository is initialized.
- Publish or vendor it into `eshop-windows-hardware-provider` as a versioned package/schema after repository creation.
- Contract ownership remains with Desktop Runtime / HRT governance, not Provider implementation.

Decision door:

- If founder wants independent Contract release cadence before WS-2 starts, create a separate package or repository.
- If speed and traceability are preferred for RC1, keep SoT in main repository and export generated fixtures to Provider.

Contract families to define later:

- Provider lifecycle.
- Health.
- Capability.
- Device identity.
- Assignment.
- Printer command.
- Scanner event.
- Customer display snapshot.
- Outcome.
- Side-effect.
- Error.
- Diagnostics.

Required properties:

- Versioning and compatibility rules.
- Schema generation.
- Test fixtures.
- Runtime and Provider contract tests.
- No implementation dependency between Runtime and Provider.
- Store Applications must not reference Provider implementation.

This RC1 does not implement the Contract.

## 9. Repository Map

| Repository | Role | Status |
| --- | --- | --- |
| `jasonmino-ops/light-ops-assistant` | Cloud app, Desktop Runtime, HRT Logic Core host, initial Contract SoT candidate | Existing, pinned at `52b8f944c3f9ae33d2e10340a12e0d9ce280ab87` |
| `jasonmino-ops/eshop-windows-hardware-provider` | Windows Provider Host + Executor | Candidate only; not initialized in this RC |

The main repository must not directly import Provider implementation. Provider must consume Contract, not internal Runtime code.

## 10. Branch Strategy

No implementation branch may be created before this Development Package is approved.

Recommended after approval:

- Keep `main` traceable to frozen baseline.
- Prefer short-lived workstream branches over one long-lived Milestone B branch.
- Candidate names:
  - `mb/ws1-hrt-logic-core`
  - `mb/ws2-windows-provider`
  - `mb/ws3-legacy-cutover`
  - `mb/ws4-packaging-release`
- Contract changes go first and must pass Contract Ready gate before Provider implementation.
- Each Workstream merges only after its gate and acceptance record are complete.

## 11. Development Sequence

Strict order:

1. Contract Definition.
2. HRT Core Skeleton.
3. Provider Simulator / Mock.
4. Runtime-Provider Integration.
5. Printer Vertical Slice.
6. Scanner Vertical Slice.
7. Customer Display Vertical Slice.
8. Legacy Cutover.
9. Installer / Signing.
10. Windows Real-Device Acceptance.
11. Final Freeze.

Vertical slice rule:

- Do not develop all devices at once.
- Each device slice must include Contract fixture, Runtime handling, Provider simulation, Windows Provider execution, tests, diagnostics, real-device acceptance, cutover, and rollback evidence.

## 12. Milestone Gates

| Gate | Name | Required evidence |
| --- | --- | --- |
| MB-0 | Package Approval | Development Package approved, ADR-01 to ADR-03 closed, repository strategy approved, branch strategy approved |
| MB-1 | Contract Ready | Contract SoT established, versioning defined, schema and fixtures ready, Runtime and Provider contract tests executable |
| MB-2 | Runtime Core Ready | HRT skeleton, health, ownership, command lifecycle, simulator, no direct hardware requirement |
| MB-3 | Windows Hardware Ready | Windows test machine, device models, VID/PID, drivers, COM, printer queue, permissions, installer conditions, owner confirmed |
| MB-4 | Device Vertical Slice Accepted | Per-device Contract, Runtime, Provider, tests, diagnostics, real-device evidence |
| MB-5 | Legacy Cutover Accepted | No dual-send, unique scanner source, rollback effective, Legacy not expanded |
| MB-6 | Packaging & Release Accepted | Signed installer, clean-machine install, upgrade, uninstall, rollback, artifact, checksum |
| MB-7 | Final Freeze | All acceptance records, known limitations, production boundary, freeze record |

## 13. Deliverables

| Deliverable | Repository | Owner | Dependency | Acceptance | Freeze requirement |
| --- | --- | --- | --- | --- | --- |
| Development Package | `light-ops-assistant` | CTO | Gate C6 | Founder approval | Freeze after approval |
| ADR-01 to ADR-03 | `light-ops-assistant` | CTO | Gate C3 | Closed by founder/CTO authority | Required before WS-2 |
| Contract specification | Contract SoT location | WS-1 | MB-0 | Contract tests executable | MB-1 |
| Runtime architecture record | `light-ops-assistant` | WS-1 | MB-1 | Runtime Core Ready | MB-2 |
| Provider architecture record | Provider repo | WS-2 | ADR-01 to ADR-03 | Provider tests pass | MB-4 |
| Hardware Readiness Record | `light-ops-assistant` | WS-2 / Verifier | Windows machine | All NOT VERIFIED closed or accepted as blocker | MB-3 |
| Device acceptance records | Both repos | Device owners | Device slice | Real-device evidence | MB-4 |
| Legacy Cutover Record | `light-ops-assistant` | WS-3 | Device accepted | Rollback and no double-consume proven | MB-5 |
| Installer acceptance | Provider repo / release docs | WS-4 | ADR-03 | Signed clean-machine install | MB-6 |
| Release record | Both repos | Release owner | MB-6 | Artifact, checksum, manifest | MB-7 |
| Final freeze record | `light-ops-assistant` | CTO | All gates | Founder approval | Final freeze |

## 14. Test Strategy

Test layers:

- Unit tests.
- Contract tests.
- Simulator tests.
- Process crash tests.
- Timeout tests.
- UNKNOWN tests.
- Side-effect uncertainty tests.
- Reconnect tests.
- Device unplug tests.
- Driver unavailable tests.
- Permission tests.
- Real-device tests.
- Installer tests.
- Clean-machine tests.
- Upgrade/uninstall tests.

Execution placement:

| Test type | macOS dev | GitHub Windows runner | Self-hosted Windows runner | Real device |
| --- | --- | --- | --- | --- |
| Contract schema/fixture tests | Yes | Yes | Yes | No |
| HRT unit tests | Yes | Yes | Yes | No |
| Provider process contract tests | No, except simulator | Yes | Yes | No |
| Windows API integration | No | Partial | Yes | Maybe |
| Printer physical output | No | No | Yes | Yes |
| Scanner event source | No | No | Yes | Yes |
| Customer display serial output | No | No | Yes | Yes |
| Installer clean-machine | No | Partial | Yes | No/Maybe |
| Upgrade/uninstall | No | Partial | Yes | No |

Rules:

- Real devices must not be accessed in ordinary PR CI.
- No mock can be recorded as real-device acceptance.
- UNKNOWN and side-effect uncertainty tests are required before Printer slice acceptance.
- Device unplug and driver unavailable tests require Windows hardware setup.

## 15. Legacy Migration & Cutover

Printer:

- From: `window.print` / browser print.
- To: Store Application -> Runtime -> HRT -> Provider -> Windows print path.
- Browser print remains controlled rollback until retirement criteria are met.
- Browser print Legacy Execution Record must remain separate from formal HRT Command Outcome.

Scanner:

- From: page keyboard listeners and hidden scanner input.
- To: HRT active scanner event model.
- During double-listen validation, business consumption source must be unique.
- No duplicate cart additions and no duplicate product lookup.

Customer Display:

- From: Web Serial in `UsbCustomerDisplayBridge`.
- To: HRT Customer Display Snapshot Contract through Provider.
- Must preserve Last-Snapshot-Wins, Scope, Expiry, disconnect recovery, and no stale replay.

Cloud printing:

- Remains out of HRT and out of Provider scope.

## 16. Security & Trust

Security boundaries to decide and implement:

- Runtime identity.
- Provider identity.
- Local transport authentication.
- Message integrity.
- Command authorization.
- Store Application boundary.
- Secret storage.
- Installer trust.
- Code signing.
- Log redaction.
- Diagnostics export.
- Prevention of arbitrary local process calls to Provider.

No real secret value is included in this document.

## 17. Packaging & Release

Candidate packaging direction:

- Windows installer.
- Signed artifact.
- Runtime and Provider independent versions.
- Compatibility matrix.
- Release manifest.
- Checksum.
- Update ownership.
- Rollback path.
- Clean-machine install.
- Uninstall.
- Support bundle.

ADR-03 owns final process and lifecycle decision.

## 18. Risks

| Risk | Impact | Mitigation | Owner | Gate |
| --- | --- | --- | --- | --- |
| Contract does not exist | Provider and Runtime diverge | Define Contract SoT first | WS-1 | MB-1 |
| Provider technology stack open | WS-2 blocked | Close ADR-01 to ADR-03 | CTO | MB-0 |
| Windows hardware parameters missing | Cannot claim support | Hardware Readiness Gate | WS-2 / Verifier | MB-3 |
| USB customer display compatibility | Failed display output | Real-device matrix and fallback | WS-2 | MB-4 |
| Browser Legacy and Provider double channel | Duplicate side effects | Cutover gate and no dual-send rule | WS-3 | MB-5 |
| Scanner duplicate consumption | Duplicate cart item | Single business source gate | WS-3 | MB-5 |
| Printer side-effect uncertainty | False success/failure | UNKNOWN and side-effect tri-state tests | WS-1/2 | MB-4 |
| UNKNOWN collapsed to failure/success | Incorrect operations | Contract tests | WS-1 | MB-1 |
| Unsigned installer / SmartScreen | Store install friction | Signing and release gate | WS-4 | MB-6 |
| Driver license unknown | Cannot redistribute driver | Readiness record and legal decision | Founder/WS-4 | MB-3 |
| Device model variance | Field failures | Device compatibility matrix | WS-2 | MB-4 |
| Windows session/service permission | Provider cannot access devices | ADR-03 and real machine tests | WS-2 | MB-3 |
| Version drift | Runtime/Provider mismatch | Compatibility handshake | WS-1/2 | MB-1 |
| Cloud and Runtime config mismatch | Wrong store/device assignment | Slot SoT and assignment tests | WS-1 | MB-2 |

## 19. Explicit Prohibitions

- Do not expand HMF.
- Do not expand Web Serial.
- Do not expand browser hardware direct access.
- Do not let Store Applications directly call Provider.
- Do not let Provider make business decisions.
- Do not turn Windows Provider into a second Runtime.
- Do not restore old EHA repository as formal repository.
- Do not develop device implementation before Contract approval.
- Do not dual-send print commands.
- Do not double-consume scanner input.
- Do not rewrite UNKNOWN as failure or success.
- Do not include camera scanning in Milestone B.
- Do not include cloud printing in HRT.
- Do not model cash drawer as a fourth device.
- Do not claim formal production support before signing and real-device acceptance.

## 20. Founder Review Decisions Still Required

- Approve or revise this Development Package.
- Close ADR-01, ADR-02, and ADR-03.
- Confirm Contract SoT location.
- Authorize Windows Provider repository initialization.
- Confirm WS-4 as separate Workstream.
- Confirm signing path and code-signing owner.
- Confirm Windows test machine and real-device owner.
- Confirm whether all C6 gaps are sufficiently represented in this package.
