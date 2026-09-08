# Network Print Server V0.1.0 — Exact Exception Review

## Governance / authority

L3 under ES-CONST-001 / ES-STRAT-001 / ES-ENG-001 / ES-GOV-001 and current Founder workflow. Founder explicitly authorizes exact governance, server commits/push/main merge/Production once gates pass. Subsequent commercial Add-on authorization is separate implementation scope; this governance diff contains no Add-on source or package.

Baseline main and live Production were both `1b05e6cddc5f9dbf8be7bc861cc50de60b1f9061`, READY; actual Release Lineage Gate PASS from clean baseline. Governance branch `codex/es-network-server-v01-governance`; target release branch `codex/es-network-server-v01-release`. No guessed commit/tag/attestation. Actual commits and deployment receipts are recorded after events.

## Exact authorization

Append only `NETWORK-SERVER-V01-RELEASE-15` to the existing task exception. Keep all previous grant contents unchanged. `PRE_COMMIT_CONTENT_SHA256` binds fifteen final paths and full file bytes, source base above and exact release branch. Mapping checksum uses UTF-8 compact JSON of the path-sorted authorizedPathSha256 object, no newline:

`8732a0a54dab611c472981b77db33b36796ea46144cf6b4211bede56c7fa2648`

Twelve files are exactly the reviewed `6a6c784d479255182402f429059537a0059d92a1` server/test bytes; the remaining three are an exact-branch Preview exclusion, its static assertion, and the operating/release record. Authorized filenames/hashes are entirely listed in the exception, no directory or wildcard authorization. No old 50-file or full rc3 packaging grant is reused.

## Readiness / evidence

Source consistency12/12 PASS; build PASS; independent noEmit typecheck PASS. Existing Guard suite70/70 PASS. Network database20 cases, legacy Relay19, device print28 and Desktop launch20 PASS on the actual release checkout. Other27 selected printing/field regressions and deployment-policy assertions PASS (the initial launch run lacked a base URL and was superseded by the complete20-case localhost run). Initial real-DB attempt used an old local schema and failed; corrected by reusing an existing main-compatible local-only test snapshot, without executing a migration or schema modification. Original test instance and all physical evidence restored/preserved.

Fresh-context source review PASS, no code blocker; previously missing DB/browser evidence now available. Default task CLI remains expected BLOCKED until trusted main contains this exact grant. Dedicated current-content positive, negative and tamper checks PASS (71 assertions, isolated no-remote simulation); actual governance default Scope/diff PASS. Independent governance review must pass before governance commit; actual trusted CLI must pass before feature commit. No absent CI, automatic deployment or docs-only deployment is taken as feature acceptance.

## Preview and merge safety

Project metadata still shows shared Production/Preview database and session-secret records. No secrets were printed and no remote database was connected. Governance branch is never pushed; its accepted main merge may automatically deploy the unchanged runtime, as authorized. The release branch contains `vercel.json` disabling automatic deployment for exactly its own name; never manually deploy it to Preview. Verify the branch's actual no-Preview status before main feature merge. Main and unrelated branch deployment settings are unchanged. This is scoped suppression, not project-wide database isolation.

## Boundaries / lifecycle

Governance commit is exactly this record and the task exception JSON. No server/runtime/schema/installer/environment file is in that commit. No change to Guard, gate-config, approved Cashier bytes, Desktop0.4.7, identity, QZ/USB/old Windows transport, templates, Renderer or Encoder. Physical completion remains unknown after TCP submission; no automatic reprint. Existing partial-paper FIELD is CROSSED, not a new terminal UNKNOWN test; abnormal whole-machine power loss remains NOT VERIFIED.

Close the new grant after the actual server feature merge, recording its real merge SHA. Retain historical approval data. No authorization for unknown future Add-on source bytes is granted by this record; formal Add-on must get its own exact reviewed-content registration. This record is a release gate artifact, not overall task FINAL FROZEN / CLOSED.
