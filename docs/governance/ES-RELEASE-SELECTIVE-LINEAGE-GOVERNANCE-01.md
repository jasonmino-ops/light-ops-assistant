# ES-RELEASE-SELECTIVE-LINEAGE-GOVERNANCE-01

## Status

- Version: V1
- Task level: L3 governance
- Scope: development baseline provenance and Founder-authorized selective release validation
- Adoption point: the merge commit that first merges this V1 governance implementation into `origin/main`
- Production / `origin/release`: unchanged by this task
- Selective release enabled: `NO` until the `release` branch protection requirement is independently confirmed complete

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline
- E-Shop Founder-Gated Agent Development Workflow V1.0

This document is additive. It does not modify or supersede the FINAL/FROZEN Level 0 assets, historical P5 closure evidence, or historical commits.

## 1. Fundamental separation

Two independent questions must not be collapsed into one manifest:

1. Development baseline safety: whether current Production is a safe base for new development.
2. Release authorization: whether one release candidate exactly equals the Founder-approved content set.

The development gate does not depend on a historical selective-release record. The selective-release validator does not make a divergent Production line safe merely because a release record exists.

## 2. Development baseline gate

`scripts/check-release-lineage.sh <production_sha>` remains the first and default gate.

### STRICT

If `Production` is an ancestor of `origin/main`, the gate reports:

```text
Lineage Mode: STRICT
Safe Development Base: YES
```

This behavior is unchanged. A dirty worktree, missing object, missing ref, or unknown Git state remains blocked.

### CONTENT_SUBSET

Only when STRICT fails because Production is not an ancestor of `origin/main`, and the worktree is clean, the gate may attempt `CONTENT_SUBSET`.

CONTENT_SUBSET proves only a restricted Git/content provenance relation:

```text
production-only content
  -> one-to-one mapped source commits
  -> source commits are ancestors of trusted origin/main
  -> path-aware byte fingerprints match
```

It is not a semantic-equivalence proof. A fingerprint match must never be described as semantic equivalence or as release authorization.

The proof fails closed for merge commits (except a zero-content/tree-equal reconciliation merge), conflict-resolved or unmapped changes, non-text blobs, non-UTF-8 paths, mode changes, submodules, schema, migrations, path mismatch, fingerprint mismatch, non-ancestor source commits, unsupported diff states, and unknown Git objects.

Git rename/copy classification is a similarity heuristic, not stored commit metadata, so provenance validation disables it with an explicit no-rename/no-copy interpretation. Every commit is fingerprinted as exact `ADD`, `MODIFY`, `DELETE`, or type-change path entries. A path move therefore appears as an exact delete plus add and passes only when source and release match both paths, modes, byte lengths, and byte hashes; similarity never establishes equivalence. Paths must decode as strict UTF-8, and their original byte identity is retained in the fingerprint so distinct raw path bytes cannot collapse after decoding.

Binary/non-text rejection is determined directly from immutable blob bytes, independent of `.gitattributes`, diff drivers, and text-conversion configuration. V1 accepts only blobs that contain no NUL byte and decode as strict UTF-8; all other blobs fail closed as `BINARY_FILE`.

The implementation uses `scripts/lib/release-provenance.mjs` to compute a path-aware fingerprint containing the destination path, status, modes, old/new byte lengths, and old/new SHA-256 values. It does not use `git patch-id --stable`, does not normalize whitespace, and retains both sides of the change.

The gate reports `Lineage Mode`, `Safe Development Base`, `Production SHA`, `origin/main`, `RESULT`, and an explicit reason. A CONTENT_SUBSET PASS is development safety evidence only.

## 3. Authorized selective release

Selective release authorization is a separate operation:

```text
scripts/check-selective-release.sh \
  --record <record.json> \
  --production <authoritative_production_sha> \
  --trusted-ref origin/main \
  --release-ref <protected_release_ref>
```

The validator is not part of the development lineage decision. It validates one Founder-approved candidate and fails closed on any uncertainty.

Before the first real use, the `release` branch must be protected so a direct write cannot trigger Production without this validator and the Founder Gate. Until that protection is confirmed, `SELECTIVE RELEASE ENABLED = NO`.

## 4. Minimum V1 release record

The record is machine-readable JSON with these nine required fields:

```json
{
  "releaseId": "...",
  "taskIds": ["..."],
  "baseProductionSha": "<full sha>",
  "sourceMainSha": "<full sha>",
  "includedSourceCommits": ["<full sha>"],
  "founderAuthorization": {
    "authorizationId": "...",
    "approvedBy": "Founder",
    "status": "APPROVED",
    "approvedAt": "<timestamp>",
    "includedSourceCommits": ["<same ordered list>"]
  },
  "releaseSha": "<full sha>",
  "deploymentId": "PENDING",
  "productionSha": "PENDING"
}
```

`deploymentId` and `productionSha` may be `PENDING` before deployment. Both must be resolved after deployment and before closure; the resolved Production SHA must equal `releaseSha`.

V1 intentionally does not require excluded-commit manifests, dependency graphs, patch-id caches, signing infrastructure, attestation services, or retrospective records for historical releases.

## 5. Pre-release validation rules

The validator must prove all of the following:

- `baseProductionSha` equals authoritative Production at release start.
- The release ref points to `releaseSha` and its first parent/base is the current Production line.
- `sourceMainSha` belongs to trusted `origin/main` lineage.
- Every included source commit is an ancestor of `sourceMainSha`.
- Every included source commit is a single-parent, non-merge commit.
- The release delta contains exactly the same number and ordered set of mapped commits.
- Each release commit contains one exact `cherry-pick -x` source mapping.
- Mapping order is identical to `includedSourceCommits` order.
- Release and source fingerprints match path-by-path and byte-for-byte.
- Git heuristic rename/copy equivalence is disabled; exact add/modify/delete paths must match source and release byte-for-byte.
- Non-text blobs, non-UTF-8 paths, mode, submodule, schema, migration, conflict/unmapped, unsupported diff and unknown states are rejected.
- Founder authorization exists and exactly covers the ordered included source set.

The release candidate tree must pass the relevant build/tests and a fresh-context independent review before a Founder release decision.

The validator may emit an `INFORMATIONAL OVERLAP REPORT` for trusted-main commits touching the same paths as the selected set. V1 uses this for reviewer dependency-risk judgment; it is not an automatic PASS/FAIL condition.

## 6. Normal release after a selective release

After a selective release, `release` is not assumed to fast-forward to `main`.

A normal release may merge an approved main SHA into the release line. `scripts/check-selective-release.sh --mode normal` requires:

- a two-parent merge of the release base and approved main;
- both parents present in the result ancestry;
- result tree exactly equal to the approved main tree.

Any conflict-produced content difference, unexpected parent shape, or tree mismatch is `BLOCKED`. There is no automatic conflict resolution.

## 7. Reconciliation policy

Selective release does not require a reconciliation merge after every release. Reconciliation remains an explicit Founder/governance action for history normalization, a milestone, or a repair. New development must use the development gate, not an assumption that every selective release was reconciled.

## 8. Hotfix policy

Production-release-first emergency hotfix governance is out of scope for V1. A main-first focused fix may be included as one authorized selective source commit. A release-first emergency hotfix remains `HOLD` until a separate Founder-approved hotfix governance task defines it.

## 9. Status vocabulary

- `STRICT`: default development ancestry proof.
- `CONTENT_SUBSET`: restricted development content-provenance proof after STRICT divergence.
- `AUTHORIZED_SELECTIVE_RELEASE`: the separate candidate validator passed; this is not a development-gate result.
- `PENDING`: required post-deploy evidence is not yet available.
- `HOLD`: a required safety proof or independent decision is unavailable.
- `BLOCKED`: a required invariant failed or Git state is unknown.
- `CLOSED`: only after the existing acceptance, merge, Production, lineage and regression requirements are all met.

## 10. Historical P5 handling

Historical P5 selective-release evidence remains valid as legacy evidence and motivating precedent. It does not require a retrospective V1 record, and this task does not modify its closure record, commits, or Production evidence.

## 11. Branch protection and enablement

The current implementation does not modify GitHub settings. At implementation time, unauthenticated GitHub API inspection could not read `release` branch protection (`401 Requires authentication`); therefore protection status is `UNKNOWN` and selective release remains disabled:

```text
SELECTIVE RELEASE ENABLED: NO
```

A separately authorized owner must confirm effective protection before the first real `AUTHORIZED_SELECTIVE_RELEASE` operation. The protection must prevent direct release writes that bypass the validator and Founder Gate.

## 12. Adoption and precedence

The rules apply only from the V1 governance adoption merge commit forward. No history is rewritten, and neither `origin/main`, `origin/release`, nor Production is reset.

Precedence remains:

```text
Founder / system instruction
> Level 0 FINAL/FROZEN assets
> Founder-Gated Workflow and AGENTS.md
> this V1 governance document
> implementation and release records
```

This document does not authorize feature-to-main merge, release mutation, Production deployment, or the first selective release.
