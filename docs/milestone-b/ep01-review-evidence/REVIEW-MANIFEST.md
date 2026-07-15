# EP-MB2-01 Review Manifest

## Metadata

| Item | Value |
| --- | --- |
| Milestone | Milestone B |
| Engineering Package | EP-MB2-01 Provider Runtime |
| Gate | MB-2A Provider Session / Lifecycle Ready |
| Reviewed Branch | `mb2/ep01-provider-runtime` |
| Reviewed HEAD | `57e8d21a11a1cc517b9989c4107c01cea1c94a16` |
| Formal Starting HEAD | `89873f5c1b2c5b20c981033eb45a3bfe977cd456` |
| Finalized At | `2026-07-15T17:10:00+07:00` |
| Windows CI run | `29359436757` |
| Windows CI | PASS |
| Desktop | PASS |
| Vercel Preview | READY |
| Production | READY |
| Risk | LOW |
| Acceptance Record | `docs/milestone-b/ES-MB2-ACCEPTANCE-001 Provider Runtime Acceptance Record V1.0.md` |
| Implementation Record | `docs/milestone-b/ES-MB2-EP01-IMPLEMENTATION-001 Provider Runtime Implementation Record.md` |
| Evidence Zip | `docs/milestone-b/EP-MB2-01-Provider-Runtime-Review-Evidence-Pack-57e8d21-final.zip` |
| Evidence file count in zip | 69 |
| Checksum file | `docs/milestone-b/ep01-review-evidence/CHECKSUMS.md` |
| Metadata status | FINAL |

## Scope Boundary

This evidence pack supports EP-MB2-01 acceptance only.

It does not start EP-02 and does not initialize, extend, or modify:

- Windows Provider
- Assignment Runtime
- Command Runtime
- Scanner Runtime
- Display Runtime
- Real hardware executors
- Database schema
- Production feature flags
- Cashier / POS / Telegram Mini App / customer H5 flows

## Evidence Files

The final zip contains the following archival files. `CHECKSUMS.md` is intentionally kept outside the zip so it can record the zip digest without self-reference.

- `BUILD-CI-EVIDENCE.md`
- `COMMIT-SCOPE-AUDIT.md`
- `CONFORMANCE-VECTORS.md`
- `CONTRACT-TREE.txt`
- `DEPENDENCY-DIRECTION.md`
- `DISCONNECT-INFLIGHT.md`
- `KNOWN-RISKS.md`
- `MODULE-RESPONSIBILITY.md`
- `PROVIDER-HEALTH-SEPARATION.md`
- `PROVIDER-LIFECYCLE.md`
- `PROVIDER-OWNERSHIP.md`
- `PROVIDER-REGISTRY.md`
- `PROVIDER-RUNTIME-TREE.txt`
- `PROVIDER-SESSION-IDENTITY.md`
- `PROVIDER-SUPERVISION.md`
- `REPOSITORY-OVERVIEW.md`
- `REVIEW-MANIFEST.md`
- `RUNTIME-DIAGNOSTICS.md`
- `SCOPE-BOUNDARY-AUDIT.md`
- `SIMULATOR-BOUNDARY.md`
- `SIMULATOR-TREE.txt`
- `TEST-COVERAGE-MATRIX.md`
- `source/.github/workflows/desktop-windows-build.yml`
- `source/desktop/package-lock.json`
- `source/desktop/package.json`
- `source/desktop/src/main/hrt/auditEmitter.ts`
- `source/desktop/src/main/hrt/commandRouter.ts`
- `source/desktop/src/main/hrt/deviceRegistry.ts`
- `source/desktop/src/main/hrt/healthEngine.ts`
- `source/desktop/src/main/hrt/hrtLogicCore.ts`
- `source/desktop/src/main/hrt/index.ts`
- `source/desktop/src/main/hrt/providerClient.ts`
- `source/desktop/src/main/hrt/providerHealth.ts`
- `source/desktop/src/main/hrt/providerLifecycle.ts`
- `source/desktop/src/main/hrt/providerOwnership.ts`
- `source/desktop/src/main/hrt/providerRegistry.ts`
- `source/desktop/src/main/hrt/providerSession.ts`
- `source/desktop/src/main/hrt/providerSupervision.ts`
- `source/desktop/src/main/hrt/runtimeDiagnostics.ts`
- `source/desktop/tests/hrt-logic-core.test.ts`
- `source/desktop/tests/provider-runtime.test.ts`
- `source/desktop/tsconfig.build.json`
- `source/desktop/tsconfig.json`
- `source/docs/milestone-b/ES-MB2-EP01-IMPLEMENTATION-001 Provider Runtime Implementation Record.md`
- `source/package.json`
- `source/packages/hrt-contract/package-lock.json`
- `source/packages/hrt-contract/package.json`
- `source/packages/hrt-contract/src/fixtures/frames.ts`
- `source/packages/hrt-contract/src/index.ts`
- `source/packages/hrt-contract/src/schemas/command-request.schema.json`
- `source/packages/hrt-contract/src/schemas/command-result.schema.json`
- `source/packages/hrt-contract/src/schemas/compatibility.schema.json`
- `source/packages/hrt-contract/src/schemas/customer-display-snapshot.schema.json`
- `source/packages/hrt-contract/src/schemas/diagnostics.schema.json`
- `source/packages/hrt-contract/src/schemas/frame.schema.json`
- `source/packages/hrt-contract/src/schemas/handshake.schema.json`
- `source/packages/hrt-contract/src/schemas/health-snapshot.schema.json`
- `source/packages/hrt-contract/src/schemas/provider-registration.schema.json`
- `source/packages/hrt-contract/src/schemas/scanner-event.schema.json`
- `source/packages/hrt-contract/src/types.ts`
- `source/packages/hrt-contract/src/validators/frameValidator.ts`
- `source/packages/hrt-contract/tsconfig.json`
- `source/packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json`
- `source/packages/hrt-provider-simulator/package-lock.json`
- `source/packages/hrt-provider-simulator/package.json`
- `source/packages/hrt-provider-simulator/src/index.ts`
- `source/packages/hrt-provider-simulator/tsconfig.json`
- `source/tests/hrt-contract.test.ts`
- `source/tsconfig.json`

## Result

Evidence metadata is FINAL for EP-MB2-01 acceptance and merge.
