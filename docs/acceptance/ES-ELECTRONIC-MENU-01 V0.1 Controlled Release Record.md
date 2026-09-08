# ES-ELECTRONIC-MENU-01 V0.1 Controlled Release Acceptance Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

Repository execution requirements also follow AGENTS.md.

## Decision and scope

L3 controlled release of the reviewed L2 electronic-menu feature. Accepted for release after CI, Preview lineage, Scope and independent review PASS. FIELD VERIFIED: NO. Task CLOSED: NO. These remain pending actual acceptance; exception CLOSED only revokes a temporary engineering permission.

Founder authorization in this task: “允许 push 当前候选分支”“允许由 push 自动触发 Preview”“正式 CI、lineage、独立审查全部确认 PASS 后，允许 merge main、push origin/main、触发 Production 部署”“本次 Production 部署仅包含 ES-ELECTRONIC-MENU-01 已审查候选及必要治理内容”。Founder additionally authorized low-risk Production FIELD, original-value capture and restoration, and immediate rollback to the pre-release Production baseline on specified critical failures. No migration, schema change, public-contract change, unrelated data modification or feature expansion is authorized.

Accepted code is exactly `236511f045ff05e5c6541dea05157c6ca2594bc5`: shared existing H5 catalog data and tenant isolation, narrow read-only display adapter, independent renderer and approved OWNER entry. No other feature is included. No Runtime, identity/isolation model, public contract or frozen Printing/Customer Display logic changed; this is not a formal Freeze candidate. The fresh eight-section independent implementation/risk review and separate release-governance review both passed.

## Exact lineage and evidence

- Pre-merge origin/main and freshly read Current/READY Production: `e8ba9368e94a68aa96f7a7488d1412ba25551ffd`.
- Pre-release deployment / rollback target: `dpl_7ormCmSWPqjFznjihpHtpkuzAAVn`, `light-ops-assistant-oou7gqpul-sunxiaojian0910-2556s-projects.vercel.app`.
- Candidate branch: `codex/es-electronic-menu-01`; pushed exact `236511f045ff05e5c6541dea05157c6ca2594bc5`.
- Formal CI: [cloud-ci #73](https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/34227800165), job `102066122419`, exact candidate, all steps SUCCESS, 3m22s. TypeScript, isolated PostgreSQL/activation, signing, QZ, legacy regression and Build all passed. CI database reset affects only its disposable service, not staging/Production.
- [Preview](https://light-ops-assistant-m8jtuugdf-sunxiaojian0910-2556s-projects.vercel.app): `dpl_6MB2f5juqjVwGJ88nwHY7U2kwsNz`, READY; Vercel Git metadata exact candidate and branch; GitHub Vercel status success. Protected Preview is not anonymous FIELD proof.
- Candidate local checks: 13 data/DTO/isolation tests, 23 related Node runner tests, 17 optimized-browser tests, standalone TypeScript, Production Build and existing dashboard dev/StrictMode lifecycle PASS.
- Release supplement: 12 existing OWNER multi-store, discount/recommendation, browser print, kitchen-ticket and Tray contract/config/entry regression files PASS. One launch test initially lacked its required runtime URL; the unchanged test subsequently passed all 20 cases on localhost. No real device credential, print job or business write was created.
- Candidate complete 16-file Scope Guard PASS; sealed file manifest matches; dashboard SHA-256 remains `660f2618303a4fb280c1fd08aab572237c6fb4de4201edb565e906b9ea10f2f6`.
- Feature merge: `b67686bd4645cb29173dd09c8f0da94c0c3f40e4`; parents are pre-merge main and exact candidate. Its full file tree is identical to the candidate. Push and fresh fetch confirmed the merge on origin/main.

## Necessary governance follow-up

After the feature merge entered origin/main, the existing exception receives only status CLOSED, actual closedAt and featureMergeCommitSha. Original authorization, branch/path/hash and approval fields remain intact. No runtime edit accompanies this record. This follows ES_ELECTRONIC_MENU_01_SCOPE_EXCEPTION.md; no Docs-only Exception is used because the JSON affects Guard authorization. Validate the CLOSED schema, all existing Guard tests, default-mode governance Scope/diff and independent review before committing/pushing it. Once trusted main is CLOSED, historical dashboard changes must not be made to pass the old exception again.

## Production FIELD and recovery conditions

At this record checkpoint, Production deployment/actual FIELD results are not yet certified. Re-read deployment SHA/READY, candidate ancestry, runtime tree and main alignment before final closure. This record does not report pending checks as PASS.

Required real acceptance: Telegram OWNER entry, copy and native preview, anonymous ordinary-browser product display, price/discount/recommendation/category/order/ACTIVE behavior, 30-second update using a named low-risk product with before/after/restored values, store isolation, invalid selectors, read-only response privacy, and /menu /dashboard Customer Display/frozen-capability regression. Actual human/device evidence is required; local automation cannot substitute. Original three authentication-dependent smoke items remain NOT VERIFIED until genuine sessions complete them.

Critical deploy/OWNER/menu/isolation/privacy/loading failure stops FIELD and invokes the authorized last-good Vercel deployment rollback. Preserve Git history; no reset/force-push or database rollback. Restore any test field independently and verify it, since code rollback does not restore data. Local UI-only findings stop FIELD and return to a separate reviewed branch; no on-site scope expansion.

Staging schema drift and prior partial alignment remain DEFERRED and are not touched by this release. No migration/schema/Production secret export is performed. Production risk assessed LOW; true FIELD status remains open until actual evidence is recorded. Final deployment/acceptance evidence belongs in the task record and real Obsidian Vault; no FIELD/CLOSED/FINAL FROZEN claim is made here.
