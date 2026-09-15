# EP-MB3-07A Release Foundation Successor Alignment Record — ES-DESKTOP-P1A

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-P1A-RELEASE-FOUNDATION-ALIGNMENT-01` |
| Parent program | `ES-DESKTOP-UX-01 / P1A — Fullscreen Foundation` |
| Risk | `L2 / MEDIUM RISK GOVERNANCE TASK` |
| Approved by | Founder |
| Authorized action | Minimal Release Foundation Alignment / Re-freeze only |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| Immutable P1A Candidate | `9753a3ab76be072bbd6582608048268bfec66aeb` |
| Successor boundary snapshot | `cc9aca6f36518a83c4f3de12b3f7645105a5e3c8` |
| Production change | `NO` |
| P1A FIELD | `NOT STARTED / NOT VERIFIED` |
| P1B | `NOT STARTED` |

This record is a narrow successor review of the executable Release Foundation boundary. It does not revise the frozen ES-DESKTOP-UX-01 Blueprint or Roadmap, overwrite the historical EP-MB3-07A Final Freeze Record, claim a Production merge, or authorize FIELD, P1B, release publication, or deployment.

## Governing Records

- `AGENTS.md`
- `docs/desktop/README.md`
- `docs/desktop/es-desktop-ux-01-governance-freeze-record.md`
- `docs/desktop/es-desktop-ux-01-blueprint-v1-final.md`
- `docs/desktop/es-desktop-ux-01-roadmap-v1-final.md`
- `docs/governance/ES-GOV-001 Level 0 Governance Baseline V1.0 FINAL.md`
- `docs/governance/ES-ENG-001 Engineering Workflow Baseline V1.0 FINAL.md`
- `docs/milestone-b/EP-MB3-07A Phase 1 Release Foundation Final Freeze Record.md`
- `docs/workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md`

Scope Guard and Release Foundation remain separate controls. This alignment touches no Scope Guard forbidden path and uses no Scope exception.

## Actual Gate Failure Classification

The pre-alignment policy was run against the existing frozen comparison ref `ep-mb3-06b-desktop-activation-runtime-v1.0-final`.

| Classification | Actual failed groups | Disposition |
| --- | --- | --- |
| Main-only baseline drift at `origin/main@822cbef0...` | `Prisma`; `Payment`; `cashier/customer/mobile business` | Previously audited successor changes; the four remaining evidence gaps are now formally CLOSED |
| P1A-only delta | `WindowManager` | `AUTHORIZED P1A SUCCESSOR CHANGE` |
| New frozen-path drift after the prior audit anchor | NONE | `6f223a0432c50f8483c6dad9ede258f0599894b6..822cbef0eda7ad73192537d35648d24067d77ef9` has zero diff across the three failed main groups and `WindowManager` |

The pre-alignment failure was not treated as a known failure and was not ignored. It remained blocking until the evidence gaps below were closed and the Founder separately authorized this alignment.

## Main Successor Evidence

The read-only audit `2026-09-15 ES-DESKTOP-P1A-RELEASE-FOUNDATION-ALIGNMENT-01 审计记录.md` (real Vault SHA-256 `5167e7351562ab38bd528730566270afa251a205ef665c828e75f37896616d94`) found legitimate implementation, acceptance, merge, release, Production, FIELD, or closure evidence for the actual drift, including EP-BR-SEC-01, EP-BR-CD-01, ES-SALES-LEAD-01, Subscription Expiry Reminder, ES-ELECTRONIC-MENU-02, Network Print RC9, Kitchen Routing, and the sales transaction timeout successor changes. It identified exactly four remaining lifecycle/evidence gaps and stopped alignment.

Those four gaps now have dedicated, current governance closure records in the real Vault:

| Historical gap | Closure evidence | SHA-256 | Status |
| --- | --- | --- | --- |
| Product Discount Restore | `05-开发记录/验收记录/2026-09-15 Product Discount Restore Final Governance Closure.md` | `4fa783cdea27f8c5047c5c8de0e807edb8b688b980a285fe267340a47cf5e9be` | `CLOSED` |
| OWNER Multi-Store Hub | `05-开发记录/验收记录/2026-09-15 OWNER Multi-Store Hub Final Governance Closure.md` | `a78563d74b7b2d1ffcff4dc2441823bfb591a65d1dadc50e929cb18b887ef185` | `CLOSED` |
| Customer H5 Telegram Binding | `05-开发记录/验收记录/2026-09-15 Customer H5 Telegram Binding Final Governance Closure.md` | `1758ac6dc744727b0e56c1d89d232ef1861c3620e4cd0ab15ed1fa6539b28846` | `CLOSED` |
| ES-CASHIER-COST-01 | `05-开发记录/验收记录/2026-09-15 ES-CASHIER-COST-01 Final Governance Closure.md` | `4040b2182ed49fc52ec55dc2e1d9247d165ac1272a8ef4fc104744002d48052c` | `CLOSED` |

These records preserve the actual historical lifecycle instead of inventing retrospective Acceptance or Freeze events. They link the real implementation/merge history to current Production lineage and the missing FIELD or post-fix observation facts. No ungoverned main-only drift remains in the previously audited frozen paths.

## P1A WindowManager Successor Review

The immutable P1A Candidate is a two-commit descendant of the prior audit anchor and was integrated without conflict into current main solely to form the local successor snapshot. Its P1A files are byte-exact unchanged:

| File | Candidate SHA-256 | Successor snapshot result |
| --- | --- | --- |
| `desktop/src/main/config.ts` | `ee77070297c3cc35a251ed658ccf1f4518a618c0b3b5063c46b6330733ab006a` | exact match |
| `desktop/src/main/windowManager.ts` | `bce8c03ea97ec3537815e18ec7339145528bce264da190e72b55146c3c9f698e` | exact match |
| `desktop/tests/fullscreen-foundation.test.ts` | `29967d7c865eedf49776c19764992b173b9a75b6bc60a937927c0a2fbace0fc9` | exact match |

The accepted `WindowManager` delta is limited to:

- Electron-main-owned automatic native fullscreen after authorization;
- protection of normal window bounds during fullscreen and fullscreen transitions;
- prevention of fullscreen physical bounds being persisted as ordinary window preferences.

It does not implement display assignment, display swap, Customer Display business behavior, Printing, Provider/HRT, API, database, or Cloud business semantics. `ESHOP_DESKTOP_DISABLE_AUTO_FULLSCREEN=1` remains the accepted P1A per-launch limitation; no P7 UI is added.

Future P1B work is not accepted by this snapshot. Any future change to `desktop/src/main/windowManager.ts`, including P1B display assignment bytes, will fail the unchanged Release Foundation comparison and requires its own successor-change review.

## Minimal Baseline Alignment

The executable policy retains the same twelve frozen boundary groups and the same exact comparison operation:

```text
git diff --name-only <frozen baseline ref> -- <exact group paths>
```

Only the frozen comparison ref changes, from `ep-mb3-06b-desktop-activation-runtime-v1.0-final` to the immutable Git object `cc9aca6f36518a83c4f3de12b3f7645105a5e3c8`. That snapshot combines current `origin/main@822cbef0...` with the byte-exact authorized P1A Candidate. The existing legacy field name `baselineFreezeTag` remains unchanged for provenance-schema compatibility; its value resolves to this immutable commit ref.

No frozen group, path, invariant, failure condition, release asset allowlist, provenance check, security check, known-failure entry, exception, or bypass is removed or weakened. The alignment does not pre-accept unknown future bytes.

## Validation Evidence

Validation was executed on the local successor line after the ref alignment:

| Validation | Result |
| --- | --- |
| Release Foundation policy | `PASS` — all 12 frozen groups |
| Desktop full suite | `PASS` — 20 files / 151 tests |
| TypeScript | `PASS` |
| Static security | `PASS` — 16/16 |
| Compile and activation dist assets | `PASS` |
| Windows x64 NSIS package | `PASS` — unsigned internal pilot artifact only |
| Packaged activation assets | `PASS` |
| Packaged Provider resource | `PASS` |
| Six-file pilot release bundle manifest/provenance verify | `PASS` |
| Electron safeStorage smoke | `PASS` |
| Provider supervision pipe integration | `PASS` |
| Electron Provider smoke with spaces | `PASS` |
| Surviving Provider process check | `PASS` — none found |

The raw local cross-build output contained electron-builder's diagnostic `builder-debug.yml`; direct release-directory verification correctly rejected it. The current controlled pilot workflow's explicit six-file staging step was then used, and the resulting publishable bundle verified `PASS`. The diagnostic file was not added to the manifest, provenance, baseline, or allowlist. This is evidence that the strict release-asset gate remains active, not a waived failure.

## Independent Review Gate

The exact committed alignment candidate must receive a fresh-context, read-only independent review before this task may report governance cleared. The reviewer must verify evidence sufficiency, exact successor scope, unchanged gate strength, byte-exact P1A files, absence of P1B pre-acceptance, Scope Guard/Release Foundation separation, and the real full-suite results. The authoritative review result is recorded in the task state and final task report; this record does not pre-claim that result.

## Boundary and Stop State

- Alignment changes are limited to the Release Foundation comparison ref and this successor evidence record.
- P1A implementation content is not edited.
- Web/API/DB/Printing/Provider-HRT/Cloud business code is not edited by this task.
- Production code/data is not changed and no deploy or release publication occurs.
- Browser fallback on the target Windows machine remains unverified for P1A FIELD start.
- `P1A FIELD VERIFIED = NO`.
- `P1B Started = NO`.
- Successful local alignment and independent review can produce only `P1A GOVERNANCE CLEARED / CANDIDATE READY FOR FIELD PREREQUISITE`.

## Known Governance Correction

P1A and future P1B do not touch a Scope Guard forbidden path, but both can touch the separate Release Foundation frozen `WindowManager` boundary. Future P1B authorization must therefore include a Release Foundation successor-change review. The frozen Roadmap is not modified by this task; any Roadmap addendum remains a separate Founder decision.
