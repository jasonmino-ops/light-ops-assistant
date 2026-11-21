# ES-DIAMOND-WHOLE-ORDER-RECOVERY-01 — isolated one-click candidate

Status: IMPLEMENTED CANDIDATE; Production Gate BLOCKED. No deployment, permission change, permit activation, real transaction or physical print is authorized or performed.

## Fixed case and operator flow

Only ST883DC00C original hold b9a1663d-1ddf-405e-b2ac-6c4430186287, canonical cart SHA 3c4ea08373c73238c85a483aa16c87ff3d0a8fdcb46e3c2736b05c01434942f2. Its three aliases remain evidence only. Staff select the original hold, click 恢复入账并打印 once, then confirm one complete front paper receipt. No terminal, SQL, credentials, date selection or second cash collection is required of staff.

Locked original/aliases deliberately remain read-only evidence in the list; no automatic deletion or archive is introduced. Their list count is not sales or cash revenue. Technical custodian is Codex; any later archive/removal is a separate authorized evidence-retention action after real FIELD acceptance. The original hold remains byte-for-byte in its existing storage. The dedicated component creates an additional checksum-protected local snapshot without overwriting it. The server ships the original immutable backup and frozen manifest. The special row has no ordinary Restore/Delete actions; other rows and the ordinary restore handlers are unchanged. Server case/fence/audit records associate the hold and aliases with the original idempotency identity and committed order. UI obtains the order number from server proof, never from a client success flag.

## Server safeguards

- Case-only Node route, same-origin JSON POST, exact payload allowlist. No client prices, actor, date, approval or transaction key are accepted. POST Origin is the verified canonical https://elifekh.com, independent of proxy/NextURL normalization.
- Existing real terminal credential and lifecycle; current ACCOUNT selection, if present, must independently authenticate. An exact signed permit binds both permitted trigger users and terminal token hash. Original real device executor WB remains the financial actor. Trigger and executor are separately audited. No token issuance or reauthorization.
- Default OFF: no signed OperationLog Gate means no recovery. Domain-separated HMAC under the existing AUTH_SECRET binds the complete approval envelope, evidence, deployment/release SHA, frozen-core package SHA and unchanged runtime configuration. There is no permit-writing endpoint or activation performed in this candidate. Founder decision, independent PASS review, STRICT PASS lineage, ACTIVE/PASS exact scope, and source-parity PASS documents are also embedded by hash and validated for actual result and release binding; a reference to BLOCKED logs cannot pass.
- Immutable signed-original bytes and human confirmations travel as SHA-bound base64 documents. The original tested admission semantic functions are copied verbatim by the deterministic packager; only filesystem transport is replaced with hash-verified embedded bytes. The baseline query fingerprint is fixed at packaging time, so production minification cannot change it.
- Exact durable OperationLog primary key `diamond:13543:accepted:v1` is inserted and committed before the sole original financial POST. Unique-key collisions read status only. No code deletes, expires or resets the fence. A rollback, crash or uncertain acceptance cannot lead to another transaction invocation. A separate immutable UNKNOWN marker takes precedence over all subsequent results.
- The frozen recovery adapter uses the original business transaction and cashier idempotency ledger. Its 54 product lookups remain sequential only within this case. All 54 lines, 92 selling units, 110 base units and USD135.43 are asserted before commit. Manual inventory epoch/items/movements remain guarded. No direct SQL constructs sales/payments.
- Frozen Production dependencies are compiled into per-request module factories at development time. Read-only --check-tree verifies the actual release tree against all 21 frozen dependencies before activation; the Gate binds that machine-readable proof. Clock-domain/call-site maps are generated. Auth modules expose only explicit verifier/authorizer exports, run against a read-only database capability, and external modules are restricted to five named dependencies. No runtime TypeScript compiler, /private/tmp, external worktree, generated secret or global Prisma/Date monkey patch. The existing application Prisma runtime is injected; the original sale module alone receives the tested business clock.
- One original FRONT V3 task is enqueued inside that same transaction by the original producer. Max attempts remains one. No QZ/browser print, reprint, KITCHEN or transaction replay is added. Transport success is not physical evidence.
- After commit, verify Nov20 recorded sales and cash sales each +13543 cents and one order; recovery-day sales/cash/order aggregates must be unchanged. Persist that verification under a second deterministic audit ID. Proved pre-acceptance refusals return BLOCKED_NOT_ACCEPTED only after confirming absent FENCE/STOP. Only that explicit response can clear the local attempt latch, after technical admission is corrected; no UNKNOWN/FENCE/STOP can be reset. Failed/unknown verification freezes the case; financial records are never undone or replayed. The designated receiver must explicitly acknowledge their displayed identity and one complete copy. Missing/incomplete/duplicate paper has an audit-only failure action which writes a FAILED/UNKNOWN stop, never a reprint or a transport ACK. Stop cannot retroactively recall an already queued/spooled physical effect; the field coordinator must halt further operations and use the existing print incident procedure. Paper witnessing creates one separate operator-attestation audit record and does not fabricate native transport ACK or `physicalCompletionKnown`.

## Reused and incremental validation

Original 17-test sealed bundle: `14a4f36f7847b73b37bbaf46b7fb6e5d8fce0d920f122766205b7d6d66234a4e`. All 44 sealed files and 93 external dependency files verified intact, zero mismatch. Original 17 tests are not rerun. Their raw results and original final log are retained alongside this document.

New commands:

```
node --test tests/diamond-recovery/entry.test.cjs
node --test tests/diamond-recovery/integration.test.cjs
node --test tests/diamond-recovery/ui.test.cjs
npm run build
node --test tests/diamond-recovery/artifact.test.cjs
```

The DB tests use ONLY 127.0.0.1:56431 and clones of the previously validated `native_inventory_test_whole_order` template. Synthetic human evidence and credentials are explicitly marked ISOLATED. Local test-only runtime role setup is removed afterwards; no production role is touched. Browser requests are intercepted; actual optimized Next artifact tests use a private test clone with no connected physical printer/worker. New tests also assert real timestamps for PaymentIntent/idempotency/print/audits, unchanged full Desktop/BrowserPosDevice rows, absent Set-Cookie, blocked non-PASS governance evidence, safe pre-acceptance refusal, browser capability handling, bounded two-minute polling and negative paper reporting. No migrations, production env pull or seed command is run. Evidence logs are archived in `evidence/`.

## Accounting and historical handover

Business day: Phnom Penh 2026-11-20 00:00–24:00, UTC [2026-11-19T17:00Z, 2026-11-20T17:00Z). Attribution anchor is the first known original hold event, not an asserted exact cash collection time. Actual paidAt/recovery/audit times remain real. Cash was received Nov20 and already included in signed handover: new physical cash is zero; recovery-day sales/cash increment is zero; no -135.43 adjustment is applied. Original signed handover must be preserved and an append-only supplement countersigned. The app never edits the original handover or pre-fills a future signature.

## Still-open field evidence

1. Signed Nov20 original: record ID/storage/custodian/immutable copy and authorized supplement signer with pre-confirmed append-only plan are not supplied. User confirmed only “已签”.
2. Field contact/coordinator, actual quiet execution window, receiver, paper/empty USB002 queue readiness are not supplied. No claim of contacting the store or physical printing is made.

## Technical admission and authority

Current Production base b0aa38a1d1bf4d1aa0f375f1c42da6e4436dc481 / dpl_4XgChWR2sf8Lf7cHfsdk98fS5nBM. Latest main at inspection e9dd39dc376c06ec013467c9ad2418fe81c33b36. Existing deployed DB role is postgres, non-superuser, BYPASSRLS=true; no new privilege is requested. Original source checks and scoped auth/runtime/ACL proof are retained from the earlier blocker review and must be refreshed for a deployable candidate before any activation.

The trusted main lineage check returns BLOCKED/SOURCE_MAPPING_UNKNOWN (50d47a1e9555e1919f7b0017a860132e8ba66930 has no unique -x mapping). Trusted Scope Guard returns BLOCKED: no task-specific trusted main exception. Neither gate was modified, bypassed, represented as PASS or covered using another task’s exception. Current user explicitly authorized isolated implementation/tests/commit; this Production-based branch is a non-release candidate only. This records the tension with repository pre-implementation rules and does not turn the branch into a safe release base. Technical lineage mapping, exact-path formal scope evidence and release review must be resolved before merge/deploy admission.

## Controlled future production action (NOT authorized now)

After field blockers, lineage/scope and independent review are closed: refresh read-only dedup of all original/historical keys, aliases, sale/payment/offline/print records; verify original backup digests, exact Desktop identity and live V3 owner epoch/lease; refresh role/ACL and deployment/config binding; bind preserved handover, responsible signer and fresh quiet-window evidence into the final signed Gate. Obtain Founder’s explicit final production authorization covering the exact release/activation and one original recovery+FRONT task. Technical agents prepare/perform authorized technical steps; clerk only selects/clicks/witnesses paper.

Original print TTL is 2026-11-21T16:13:36.233Z (Phnom Penh 23:13:36.233), with 65-second execution budget. Expiry is a hard stop requiring a newly reviewed Gate/plan, never a silent extension. All recovery callers, offline synchronization, deployments/migrations and original hold resubmission remain paused during the attested window. Any unknown result, expired window, changed owner/config, ambiguous payment, reconciliation drift, failed/unknown print, missing output or duplicate paper stops execution; no retry/resubmit/reprint/automatic ACK. Committed transaction remains preserved for read-only investigation. Actual paper and later handover countersign evidence are required for final FIELD closure.

## Review iteration

First fresh-context Claude reviews returned PASS WITH BLOCKERS with code/proof findings, not production approval. Findings, evidence gaps, dispositions and final re-review are recorded in REVIEW-DISPOSITION.md and evidence/CLAUDE-*.md. Frozen financial adapter, accounting clock, original 17 evidence and all 21 dependency bytes remain unchanged. The original print TTL is an intentional fail-closed constraint; this task does not silently extend it or redesign the tested clock. If the window expires, the Gate remains disabled and a separately authorized reviewed plan is required. No prediction that missing real-world evidence will arrive before the deadline is made.

## Final authorization disclosures and operational cutoff

Governance HMAC and existing POS credentials share AUTH_SECRET; these are not cryptographically independent signatures from Founder/reviewer. A trusted technical operator holding that secret can fabricate JSON assertions; no code claims otherwise. No secret is exposed to the clerk and no issuance/activation endpoint is added. Founder final decision must explicitly acknowledge this procedural trust limit and the existing postgres BYPASSRLS role, and bind exact dossier, executor, receiver, execution window, release/deployment/package/key/actions. Final human approval must separately exist in the controlling Founder channel. A signed JSON is not a substitute for it.

Case Gate expiry and planned field-window end must be no later than **2026-11-21T15:43:36.233Z (Phnom Penh22:43:36.233)**, a conservative30-minute operational margin before the unchanged original print TTL. Actual window remains unconfirmed. Do not rush or silently extend either boundary. Authenticated paper attestation/failure reports must also match the exact credential recorded in the durable acceptance fence; a replacement/forged legacy credential mapping to the same owner cannot witness the case. Missing/weak runtime AUTH_SECRET is rejected before auth, including after financial commit.
