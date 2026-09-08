# ES-ELECTRONIC-MENU-01 Exact Dashboard Entry Authorization

## Status

| Item | Value |
| --- | --- |
| Service task | ES-ELECTRONIC-MENU-01 / Electronic Menu Screen V0.1 |
| Governance branch | `codex/es-electronic-menu-01-scope-exception` |
| Feature branch | `codex/es-electronic-menu-01` |
| Starting HEAD | `a354624726ffac2600bdb7d18224a09bdf815c65` |
| Governance task level | L3: task-scoped exception record |
| Feature task level | L2 as reaffirmed by Founder; any new higher-risk work requires reassessment |
| Approval | Founder explicitly approved the existing sealed dashboard patch |
| Record lifecycle state | ACTIVE |
| Effective authorization | NOT EFFECTIVE until the byte-identical record enters trusted `origin/main` |
| Merge / deployment | NOT AUTHORIZED; not performed |

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Readiness and authorization

The OWNER navigation label “概览” resolves to `/dashboard`; `/home` is “首页”. The existing default Scope Guard correctly blocks `app/dashboard/page.tsx` through the `app/dashboard` forbidden rule.

Founder approved a task-level exception for this one file and the already-sealed patch in the current task conversation. The approval explicitly requires the ACTIVE record to enter `origin/main` before business implementation resumes. It explicitly excludes main merge, migration, Preview/Production deployment and release authorization. Registration and local validation are authorized; activation through a merge requires a separate decision.

On 2026-09-08, `git fetch origin` succeeded, the worktree was clean, and the live Vercel Production project overview showed deployment `CcirFVFgYprfQRtGFu69KoM8ZPgQ` READY with Git source `a354624726ffac2600bdb7d18224a09bdf815c65`. Fetched `origin/main` had the same SHA. The current Release Lineage Gate returned PASS, with Production ancestor YES and Safe Development Base YES, before this governance branch was created.

The Docs-only Exception is **not used**: a machine-readable Scope Exception changes authorization behavior even though it lives under `docs/`. No application runtime, public contract, schema, dependency, platform setting, Guard implementation or Guard configuration changes are included.

## Exact sealed content

The record is `docs/change-gates/exceptions/ES-ELECTRONIC-MENU-01.json`.

- Task: `ES-ELECTRONIC-MENU-01`
- Feature branch: `codex/es-electronic-menu-01`
- Authorized path: `app/dashboard/page.tsx`
- Base: `a354624726ffac2600bdb7d18224a09bdf815c65`
- Complete resulting file SHA-256: `660f2618303a4fb280c1fd08aab572237c6fb4de4201edb565e906b9ea10f2f6`
- Original sealed patch SHA-256: `b011b5f169e0f6427974f17bfcd33ae064c3b34cdf6d20393accd639a57a9d7c`

The approved change is exactly these two insertions into the base file:

```diff
@@ -8,6 +8,7 @@
 import { formatMoney } from '@/lib/currency'
+import ElectronicMenuEntry from '@/app/components/ElectronicMenuEntry'
@@ -345,6 +346,7 @@
       <div style={s.body}>
+        {realRole === 'OWNER' && <ElectronicMenuEntry />}
         {/* Loading skeleton */}
```

The component itself remains future implementation within the original feature scope. This registration does not implement the menu or declare the feature tested. No existing dashboard calculation, printing setting, layout structure or behavior is changed by this governance package. Any deviation from the sealed resulting file requires a new Founder Gate, including conflict resolution that changes its bytes.

## Guard contract and activation

The existing `PRE_COMMIT_CONTENT_SHA256` mode avoids requiring an unauthorized protected-file commit before registration. It does not skip provenance or content checks. Activation still requires all of the following:

- The record and `gate-config.json` exist in trusted `origin/main`, and their working copies match those blobs byte for byte.
- Explicit `--task-id ES-ELECTRONIC-MENU-01`, matching feature branch, ACTIVE lifecycle state and Founder approval.
- The recorded base is an ancestor of trusted `origin/main` and the feature HEAD.
- The exact authorized path and complete current file SHA-256 match the record.

No directory or wildcard grant, additional authorization, or authorized commit is included. Default forbidden-path behavior is unchanged. A local ACTIVE record is insufficient and must continue to fail closed before its governance merge.

This registration does not require the ES-ENG-001 architecture-sensitive Claude Review: it introduces no runtime, provider, public-contract upgrade, permission/security/isolation model change, production-critical API or Freeze candidate. It records an exact Founder-approved grant using the unchanged existing authorization mechanism. A fresh-context independent read-only review is required for this registration; review requirements for the feature implementation remain separately applicable.

After separately approved governance integration and a fresh fetch, integrate the trusted record into the feature branch, verify that the sealed patch still applies exactly, then run:

```bash
node scripts/guards/check-change-scope.js \
  --task-id ES-ELECTRONIC-MENU-01 \
  --files "<complete feature file list>"
```

The original feature requirements remain in force: existing catalog and business semantics, strict read-only display and isolation, no database migration or frozen-capability changes, related regression checks, TypeScript, necessary Production Build and fresh-context independent review.

## Required registration evidence

Registration validation covers the existing Guard regression suite, strict record validation, reconstruction of the two-line candidate from the approved base, candidate and patch SHA-256 verification, allow/deny checks for exact content and mismatched task/branch/path/content/status, the real pre-merge trusted-record rejection, default Scope Guard on the two governance files, and `git diff --check`.

Application TypeScript, Production Build and browser feature acceptance are not applicable to this registration-only diff; they remain mandatory for the subsequent feature implementation. CI is not triggered without an authorized push. Local checks do not mean the exception is active in `origin/main` or the feature is ready.

### Local validation results (2026-09-08)

- `node --test scripts/guards/check-change-scope.test.js`: **70/70 PASS**, zero failed or skipped.
- `.task-state/ES-ELECTRONIC-MENU-01-sealed/validate-registration.cjs`: **19/19 PASS**, covering strict record validation, exact reconstruction/hash checks, unit allow/deny boundaries, unchanged Guard/config and the real CLI checks below. Unit allow checks are simulated inputs and do not establish trusted activation.
- Default Scope Guard with the complete two-file governance list: **PASS**.
- Real Scope Guard with `--task-id ES-ELECTRONIC-MENU-01 --files app/dashboard/page.tsx`: **BLOCKED as required**, because no trusted `origin/main` exception is registered. No feature authorization is claimed.
- Protected `app/dashboard/page.tsx`: byte-identical to the approved base; no business diff.
- Logs: `.task-state/ES-ELECTRONIC-MENU-01-sealed/guard-tests.log` and `registration-validation.log` (local evidence, not committed).
- Independent registration review: **PASS**, fresh-context read-only reviewer `exception_review`, no remaining blocking/non-blocking findings or boundary violations. The reviewer independently recomputed sealed file/patch/record hashes and verified 19 read-only registration checks; the 70-test result and historical platform/lineage observations were reviewed as primary-captured evidence, not rerun platform verification. The initial documentation omission of the Claude Review applicability rationale was fixed and re-reviewed. Feature implementation and its independent review remain unstarted.

## Closure and recovery

After the feature merges, a separately authorized governance change must set the exception to CLOSED with `closedAt` and `featureMergeCommitSha`; retain the record for audit. CLOSED cannot authorize future changes. If the draft is rejected before integration, retain the local branch without applying it. No runtime or database rollback is required because this package contains no such changes.

## Explicit non-scope

- No application source changes, including the protected dashboard file.
- No schema, migration, dependency, CI, deployment or platform changes.
- No Guard implementation/configuration changes and no relaxation of existing checks.
- No push, PR, main merge, Preview/Production deployment, or release.
- No FIELD VERIFIED, CLOSED or feature-completion claim.
