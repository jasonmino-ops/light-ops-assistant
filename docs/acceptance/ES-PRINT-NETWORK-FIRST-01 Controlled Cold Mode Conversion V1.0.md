# Network Print — controlled cold mode conversion

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Authority, baseline and boundaries

L3 under ES-GOV-001, ES-ENG-001 and the Founder-Gated workflow. Founder explicitly approves minimal controlled FRONT_ONLY ↔ SHARED_PRINTER conversion, scoped fixes/tests/independent review/exact governance/new candidate and subsequent V727 SHARED acceptance. Standing commercial task integration/Production authority continues, subject to actual guards. No purchase, schema/migration, Desktop0.4.7 identity change or security reduction is authorized.

Clean source and real READY Production baseline:3015d0c1a322a96cd8b499ae64ad625145e73889, freshly read2026-09-09T15:31Z, fetch/lineage PASS. Worktree `/private/tmp/es-network-commercial-cold-conversion-v01`, branch `codex/es-network-commercial-cold-conversion-v01`. Predecessor candidates, sealed drafts and history remain unchanged. This source record is not a self-referential commit/hash or FIELD claim.

The existing Relay, job ledger, Binding, poller, journal, transport, templates, bitmap renderer and encoder remain reused. No cashier/sales behavior or schema change; no QZ/USB/Windows transport, Desktop, dual physical printer, hot switching, authentication or update platform change.

## Exact cold workflow

1. Close all Network cashier pages for this store; no new sales during conversion. Confirm exactly one Network Agent. Pause and safely exit the Agent, retaining all existing history.
2. Reopen already paused. This process must have opened with a configured printer and must never have started its poller or changed its boot configuration/TEST. Normal mode radios remain locked; only the dedicated cold action accepts the other single-printer mode.
3. Revalidate original Binding, physical LAN, MAC, endpoint and original confirmed TEST. Check the complete local journal and authenticated current-store cloud counts. Reject pending/claimed/executing, unknown, unACKed or quarantined work. Reported ABANDONED is acceptable only with consistent NOT_CROSSED evidence; terminal record/result boundaries must agree.
4. Preserve original encrypted profile, node and journal bytes; write new same-endpoint node revision plus anchored mode-conversion provenance. Recheck identity/device/cloud/local state before committing. Conversion sends no TEST or business bytes. Original TEST id/mode/content hash is not rewritten or relabeled.
5. Successful conversion remains disabled and safely exits. Reopen, check again and explicitly enable. Then use the fresh Chrome Network cashier entry for the new mode. A successful explicit enable permits normal later Windows-login automatic startup; this is not permanent manual startup.

Unfinished work is refused, not erased or artificially marked complete. If a late old-mode task prevents enabling or receiving, close old cashier pages and retain task/configuration evidence for support; do not repeat a sale, change its payload, reset journal or clear a queue to proceed. Known CROSSED means bytes submitted, physicalCompletionKnown=false, not guaranteed complete paper.

## Configuration durability and recovery

Schema1 profiles remain strictly parsed. Converted schema2 profiles carry a chain of hashes referencing immutable original encrypted backups, node revisions, journal snapshots and actual TEST evidence. Same-device address recovery may later create a new genuine TEST; it does not mutate historical backups.

Cold configuration writes and all later profile writes use retained transaction directories with sealed intent and original bytes. Target profile uses temp-file fsync, atomic rename and final writable-handle fsync; new node files receive final sync too. A sealed decision selector is published last, after staged bytes are synchronized. On restart its selector and selected profile/node are revalidated and synchronized before use. No fabricated proof that a user saw the last response is recorded.

Missing decision restores original configuration; invalid/unreadable/unsynchronizable history stops startup with backups retained. A failed restore never permits a new active configuration. Failed first enable is covered by the same transaction/recovery protections. No required fsync is swallowed. The journal's existing execution/ACK/UNKNOWN persistence is unchanged and is never restored from a configuration backup.

Windows directory metadata durability under non-normal whole-machine power loss remains NOT VERIFIED/deferred. This is not a new power-loss guarantee or a reason to weaken necessary content synchronization.

## Server compatibility and race boundary

GET on the existing receive resource authenticates the same bound Agent and returns only server-derived binding/store and schema2 pending/claimed/executing/unknown counts. It performs no claim, expiry, recovery, assignment or database write. Input cannot select another tenant/store or inject host/port.

Commercial guarded receives use client version network-0.1.2 and an exact expected-mode header. An older server rejects this new version before claiming. New server requires the mode, checks every unsettled same-store Network job under the existing binding/store/tenant lock before recovery or claim, verifies the selected row again, and returns exact modeGuard. Client refuses missing/mismatched guard; no fallback to legacy receive. Old network-0.1.1 and Windows schema1 paths remain unchanged, including ACK endpoints.

Empty queue is a timestamped observation, not a global sales freeze. The operational closed-page/single-Agent requirement remains necessary. A delayed old-mode task is retained without claim, expiry or terminal mutation rather than printed under another mode or hidden as preparation failure. Tests use an actual simultaneous sale and guarded store-lock transaction, observing pg_blocking_pids with an independent read-only connection; after lock release the late old-mode task stays unclaimed.

## Verification and review

Independent fresh-context design review, implementation review and test-only incremental review PASS. Reviewer independently ran123 tests for profile fs faults, cold lifecycle, old lifecycle and client. Review corrected the shared settled-history predicate; root then added real concurrent database evidence and precise old-test error updates for the new failed-open latch. Incremental reviewer verified those actual diffs and retained results. The concurrency test has an outer runner timeout; its inner lock-barrier wait could provide faster diagnostics, a nonblocking test-harness limitation.

- Cold profile/fault57, cold lifecycle33, existing profile lifecycle16 and client17 tests PASS.
- Network/Cashier isolated-database25 actual cases PASS, including transaction persistence and real concurrent old-mode sale. Legacy Relay19 actual cases PASS. Earlier runner passLines counts included the summary line; those are not case counts.
- Selected18 existing stable-capability/old-print regression commands PASS; Desktop/Cashier exact historical contract tests remain unchanged.
- Root TypeScript and full Next production build PASS with sanitized localhost-only test settings; no migration.
- Full Tray initial run had421PASS,11 loopback-listen EPERM environment failures and one preexisting conditional renderer smoke skipped. Only the affected Network suite was rerun with local-socket permission; old failed-open expected errors were updated to exact fault-latch errors while preserving all zero-TCP, no-result-write and byte-preservation assertions. Its final result is53PASS/one preexisting conditional skip. The final per-file aggregate is432PASS/one not run, not a claim that the first full invocation passed. No skip or weaker match was added.
- JavaScript-only Network input/output hash check PASS with actual in-worktree dependencies. Initial external dependency links were correctly refused by the builder and replaced by a local dependency clone, not a guard bypass.

Initial isolated DB tests encountered an older local test schema missing existing main columns. Reused an already existing main-compatible local snapshot, without schema DDL/migration, then restored the original local service. Concurrent-test observation initially queued behind the same two-connection pool; corrected only the observer to a separate local connection. No Production DB data used.

## Candidate and deployment prerequisites

Next candidate: `0.1.0-commercial-rc.3`, unsigned TEST-only, Electron44.3.0 win32-x64. It is distinct from the older experimental rc.3 line and preserves commercial-rc.2 evidence. Actual source commit, complete source/input/output snapshot and installer SHA must be recorded after real exact authorization and build; none is invented here. Formal release signer/manifest guards remain unchanged.

The exact new source branch is Preview-disabled; main and unrelated branches are unchanged. The project-wide shared Preview/Production database problem is not declared globally solved: do not manually deploy Preview. Any required main integration must use standing task authority, real Scope/lineage and post-deployment read-only checks.

Source is still a local draft when this record is written. Trusted exact exception, actual Scope PASS, source commit/candidate build, V727 safe upgrade/cold conversion and new Production SHARED paper acceptance remain next gates. Previous Production FRONT_ONLY one-receipt PASS remains valid only for its actual source/candidate/order.

Commercial delivery additionally requires legitimate signing, clean supported native Windows x64 two-installer first run, a different actual LAN and accurate HTTPS distribution. Existing V727 and ARM64 snapshot are not a clean supported x64 substitute. No new printer paper or whole-machine restart was performed for this source record.
