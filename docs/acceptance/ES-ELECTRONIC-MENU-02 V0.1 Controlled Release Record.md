# ES-ELECTRONIC-MENU-02 V0.1 Controlled Release

Task: ES-ELECTRONIC-MENU-02 / Dedicated Promotion Media V0.1. Feature L2; database execution and release L3-controlled. This record supersedes the local-only authorization/status checkpoint in the Candidate Record; the reviewed implementation is unchanged.

## Governance

This document is governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Authorization and lineage

Founder explicitly approved candidate `8b30f6e80881429429b9f056c3c27193d88ba524` branch push, automatic Preview/formal CI, safety-gated exact Production migration, then main merge/push/Production and reversible dedicated-media FIELD. No other migration, schema extension, feature or unrelated Production data write is authorized.

- Pre-release origin/main and READY Production: `29fc52b0f7e22eea0aada2b19453c82c0b7718ae`, deployment `dpl_kaRSy381o6JwLzdeHvyQFAu988eB`.
- Candidate branch `codex/es-electronic-menu-02` pushed at the exact SHA.
- Formal cloud-ci run [34252653469](https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/34252653469): SUCCESS, exact candidate SHA.
- Automatic Preview `dpl_ESsw7me4n6js9KoQ7CVJhj4c6A4i`: READY, gitSource SHA and GitHub metadata match the exact candidate.
- Reviewed candidate merge: `b7429b4fb6468390f76ad3043b6f78267d3d8630`; entire merged tree is byte-identical to the candidate before this necessary governance closure.
- Scope Exception closes with that feature merge; its historical exact paths/hashes/authorization remain retained and cannot authorize future changes.

## Production migration

Migration `20260908155736_add_electronic_menu_media`, SHA-256 `3ac9b3f7aa00e14a84633df80151dc7012e5ccef1618f7e2cd0bb95376fc1ba5`: executed SUCCESS through repository `npm run migrate:prod` against the positively identified existing Production database on 2026-09-08, 16:50:24–16:50:25 UTC. Only two nullable TEXT columns were added: `Store.electronicMenuMediaData` and `Store.electronicMenuMediaUrl`. No defaults, backfill, drop, rename or old migration edits.

Before execution, all 23 existing Store column names/types/nullability matched the Production code baseline. Prisma found exactly this one pending migration and no unresolved failures. Execution rechecked the exact clean candidate, SQL hash and single pending migration. An additional pg-client precheck failed TLS certificate validation before any DDL; no TLS policy was weakened. The existing Prisma status/deploy connection path was then used consistently.

After execution, Prisma status is up to date: no pending or failed migration. The new applied history checksum exactly matches the committed file. All 29 existing Store records retain identical hashes of every old column; banner hashes, old schema columns, constraints, indexes and old migration records are unchanged. Both new fields are NULL on every store. Existing anon/authenticated roles have no Store SELECT/UPDATE grants; no access-policy changes were made.

Seven historical migration checksum placeholders remain unchanged; they were already recorded as applied and were not replayed or repaired. This task does not claim historical migration-history cleanup or staging full-schema alignment. Staging drift remains DEFERRED.

## Verification and FIELD boundary

Existing local candidate tests, TypeScript, Build, Scope and fresh-context independent review remain PASS. Release supplements: OWNER multi-store hub plus eight Tray suites PASS (9/9), including existing isolated real-PostgreSQL device/relay tests and local browser launch tests. These supplements used a new localhost-only temporary database and mocked browser APIs; no staging/Production test data was involved.

At this pre-deployment checkpoint: Production feature deployment and real FIELD are PENDING. FIELD VERIFIED = NO; CLOSED = NO. Do not infer real media acceptance from local fixtures or Preview.

Required FIELD: existing banner A fallback; OWNER upload B image/GIF, replace C, clear back to A; H5 and Customer Display retain A throughout; verify fullscreen, pagination, QR, 30-second refresh, menu/dashboard and isolation. Clear temporary dedicated media after tests to restore the original NULL state unless Founder explicitly retains it.

Recovery baseline: the pre-release READY application deployment above remains compatible with the additive columns. Never drop the columns as a rollback. If data/security/legacy regression appears, stop FIELD and follow the authorized safe-release process; no onsite scope expansion.
