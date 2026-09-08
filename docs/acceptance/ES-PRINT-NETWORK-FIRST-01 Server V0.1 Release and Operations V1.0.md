# Network Print Server V0.1.0 — Release and Operations

## Governance / readiness / authorization

L3; governed by ES-CONST-001, ES-STRAT-001, ES-ENG-001, ES-GOV-001 and the Founder-Gated Workflow. Founder explicitly authorizes this server release, necessary exact Scope registration, commits, push, main merge and Production deployment. Subsequent Founder authorization also permits a separate commercial Add-on work package, including first-run UI and bounded discovery; this server package does not implement or qualify that installer. Starting main and live Production: `1b05e6cddc5f9dbf8be7bc861cc50de60b1f9061`; real lineage gate PASS on a clean baseline. Release branch: `codex/es-network-server-v01-release`. Final commit/deployment evidence is recorded separately after those events; this document does not invent a future SHA.

The twelve server code/test files are exact bytes from reviewed local source `6a6c784d479255182402f429059537a0059d92a1`. No later main change overlapped them. Extra release controls are the exact-branch Vercel deployment exclusion, its test and this operating record. Required review uses a fresh-context read-only agent and the ES-ENG-001 review headings. Acceptance requires exact source consistency, trusted Scope Guard, relevant legacy regressions, isolated database tests, type/build, independent review and actual deployment SHA/health evidence. No absent CI run counts as PASS.

## Version and supported contract

Server capability: **Network Print V0.1.0**; protocol `network-v2`, schema `2`, compatible Agent client `network-0.1.1`, renderer version `1`. Server release does not install an Agent or modify Desktop 0.4.7. The retained unsigned installer `0.1.0-rc.3` is TEST ONLY, not a commercial merchant installer.

All merchants can use the server capability with existing authenticated cashier/store permissions and a compatible configured Agent; there is no test-store allowlist in server code. Only normal online CASH and manually confirmed KHQR cashier sales are supported. H5, CustomerOrder, offline sales, membership-balance and other payment entry expansion are excluded.

## Explicit configuration and enablement

1. Read the existing approved Computer Binding without overwriting Desktop identity. Confirm tenant/store, compatible server origin and client version.
2. Configure the local Agent once with `FRONT_ONLY` or `SHARED_PRINTER` and one validated private LAN endpoint. IP/port stay local, identity-protected; never put them in a cashier URL or cloud job. Do not hot-switch the mode/configuration.
3. Verify exactly one Network receiver is running for that store across all computers. The Electron instance lock is per-machine, not a cloud-wide Agent assignment system.
4. Only after local configuration and operator confirmation, use the authenticated Chrome cashier URL with `networkPrint=v01&networkMode=FRONT_ONLY` or `networkPrint=v01&networkMode=SHARED_PRINTER`, preserving the normal store/context parameters. Do not distribute enabled links to unconfigured stores. Invalid/omitted mode is not an instruction to guess a printer.
5. Normal cashier URLs without this opt-in send no Network printing request and create zero Network jobs. Installing/configuring an Agent does not silently enable other browsers or merchants. Existing Desktop/Windows/QZ paths remain unchanged; the explicit Network branch skips its legacy automatic print handoff.

This is **operational explicit enablement**, not server-enforced printer inventory. The server verifies actor/store access and the versioned request; it cannot prove local configuration, singleton compliance, online status or paper completion. A copied enabled URL can request printing, so operators must control enabled bookmarks. Agent temporarily offline does not prevent atomic durable queueing for an enabled sale.

## Delivery and observation

`FRONT_ONLY`: one durable FRONT job, no KITCHEN job. `SHARED_PRINTER`: two distinct jobs/receipts to one physical endpoint, FRONT before KITCHEN, serialized and not byte-interleaved. A sale, payment record and role jobs commit in one database transaction; browser refresh/close after successful commit cannot remove the tasks.

`QUEUED` means persisted, not printed. Full TCP submission means `CROSSED`, always `physicalCompletionKnown=false`; it cannot guarantee USB printer paper completion. A terminal `CROSSING_UNKNOWN` blocks automatic replay and subsequent Network processing. Preserve jobId/orderNo/role/resultCode/effectBoundary and journal; there is no self-service UNKNOWN reset in this version.

## Stop / fallback / rollback

For new sales, remove the Network opt-in from the active cashier entry/bookmark before switching to an existing printing workflow. Close stale Network-enabled tabs. Do not run both paths for the same order. If stopping delivery, stop the Network Agent normally and its login autostart; queued/claimed/unknown jobs and journal must be retained unchanged. Existing submitted output may still emerge from the printer buffer; record it separately from any Agent submission.

Do not delete/recreate identities, profiles, journal files or jobs; do not reset task states to force printing. Removing URL opt-in does not cancel historical tasks. UNKNOWN needs incident review before controlled restoration; this release has no automatic unblock or reroute facility.

If application rollback becomes necessary, first stop Network consumers and new opt-in sales, preserve evidence, and use the known previous server deployment through the repository's approved rollback process. Do not downgrade and leave Network consumers running against an incompatible server. No database rollback/migration is required or permitted by this package. Default legacy sales remain available; existing v2 tasks must not be consumed by v1 Windows clients.

## Incomplete ticket manual handling

1. Confirm the original order, payment, role and exact physical paper count. Treat ambiguous completion conservatively; never submit the sale again to obtain paper.
2. Stop Network processing for the incident; preserve `CROSSED` or `CROSSING_UNKNOWN` exactly as observed. Restarting an Agent is not a retry command.
3. Use the existing authenticated `/records?from=desktop&storeCode=<storeCode>` SaleRecord receipt action when an original customer receipt is needed. It reads the existing sale through `GET /api/cashier/sale-records/[id]/receipt` and opens browser printing; it does not create a sale or Relay job. A supervisor must select an already available browser print destination or save a PDF and record the manual replacement against the original order.
4. That existing action is **not Network RAW NP330 reprint and not a kitchen-ticket reprint**. If only the Network printer is available, or a kitchen ticket is incomplete, verify items/quantities from the original order and communicate them manually to the kitchen; record the incident. Do not introduce a Windows Queue/QZ/USB workaround or promise a missing Network reprint feature.

## Preview isolation and deployment sequence

Preflight found shared Production/Preview `DATABASE_URL`, `DIRECT_URL` and `AUTH_SECRET` records. This release must not deploy Preview against them. `vercel.json` sets `git.deploymentEnabled` to false for exactly `codex/es-network-server-v01-release`; unspecified branches, including main, retain Vercel defaults. Reference: https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled . This is scoped automatic-Preview suppression, **not a claim that the project's Preview database is isolated**. Do not manually deploy this branch to Preview. Unrelated branches still require their own isolation decision.

Run all release checks locally with synthetic secrets and only the isolated local test database. Merge the reviewed exact governance registration to main without pushing its temporary branch. Refresh/validate the feature's exact bytes and Guard against trusted main, commit and review, then push only the release branch containing the exclusion. Verify no Preview deployment before merging the accepted feature to main. Observe the automatic Production deployment, verify actual SHA, health/auth rejection and existing-page smoke. Close the exact authorization after the real feature merge, retaining merge SHA and audit history. Do not conflate docs-only automatic deployment with feature validation.

## Accepted physical evidence / remaining gates

Retained local V727/NP330 evidence: FRONT_ONLY 5 orders/5 slips; SHARED_PRINTER 5 orders/10 separate ordered slips, user-confirmed. Printer-only partial-paper test: one partial first slip, no continuation with Agent stopped, no new submission/paper after Agent restart. Both tasks actually reported CROSSED/physicalCompletionKnown=false. This is accepted bounded no-auto-reprint evidence, **not terminal CROSSING_UNKNOWN FIELD verification**. Whole-V727 abnormal power loss remains NOT VERIFIED. Dual physical nodes and hot switching are deferred.

After server deployment, coordinate online V727 validation using an explicitly approved test store/identity and normal HTTPS; no real business orders without separate coordination. Production code availability is not proof that an ordinary merchant has a compatible commercial Add-on. Formal delivery is now authorized as a separate work package but still needs reviewed clean source/build provenance, existing Desktop Binding and ordinary HTTPS wiring, bounded discovery and explicit test/confirmation UI, clean Windows install/upgrade/uninstall validation, and truthful signing/distribution evidence. Paid signing, extra external resources, schema changes or weakened security require a specific decision. Preserve rc.3 and all historical hashes; do not relabel it.

## Implementation status

Release candidate prepared; source/Guard/test/review and actual deployment receipts live in the task evidence record. This document is not FINAL FROZEN or CLOSED. No schema/migration, Desktop, QZ, USB, old Transport, Renderer/Encoder/template, new authentication, updater or cloud assignment code is included.
