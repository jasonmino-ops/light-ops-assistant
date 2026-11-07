# ES-DIAMOND-V3-FINALIZE-HELD-UPDATE-OPTIMIZATION-01 — Frozen Successor DRAFT

Status: SEALED DRAFT / NOT ACTIVE / no previous authorization inherited. Governed by ES-GOV-001, ES-ENG-001, Workflow V1 §§3.4,5,6.2, current printing freeze and FINALIZE timeout successor. Founder current task explicitly authorizes implementation/tests/Claude L3 and preparation only. Exact-content Founder acceptance and trusted-main registration still required before merge/release/recovery.

## Exact scope
Only materializeHeldV3PrintIntents V3_ACTIVE branch changes: validate entire held snapshot, then batch exact snapshot row ids in chunks1000. Keep original schema3/PENDING/completedAtnull/HELD predicates, add explicit tenant/store on UPDATE, require each affected count equals chunk size. Same thrown errors. Update resultMessage/nextAttemptAt only (plus Prisma automatic updatedAt as before). No SQL by raw connection or migrations. All batches remain inside caller transaction. FINALIZE service, transaction boundary, 10000ms budget, auth/Owner/Lease/Fence/modeCAS/audit/recovery logic byte-identical. V2 payload conversion and rest of adapter byte-identical except chunk-size constant. This helper is also called by existing HOLD_LOCAL materialization in active mode, so optimization applies there with identical scoped selection/write contract; no new runtime route or scan.

## Test successor
Existing service tests' FINALIZE fixture injection moves from11th per-row UPDATE to1st bulk UPDATE; call-count expectations11/21 become1. Safety assertions remain: stale CAS/replay/concurrent sole success, exact mode/stateVersion/Owner/Lease/epoch/audit, immutable expired3/ACK/otherstore/TTL/roles/identities, audit/mode/held failures and timeout rollback. New1001-row tests force failure/disconnection/timeout after first1000 real updates and prove complete rollback plus safe known-rollback retry. Other REVIEW/EXPIRE/compensation test bytes unchanged. Adapter tests add exact chunk predicates,2001 rows/no count cap, validate-before-write, short/excess counts, late arrivals excluded and later existing rescan idempotence, terminal/unknown/other tenant/store exclusion. No cashier frozen assertions, KTF or manifest changed.

## Boundaries and limitations
No transaction splitting, no automatic retry/replay, no timeout increase, no TTL extension/role reroute/task reset/Owner creation. Arbitrarily large queues or prolonged real DB locks can still exceed bounded10s; local injected tests are not Production performance guarantee. Existing concurrent late HOLD_LOCAL/producer semantics are retained, not redesigned: snapshot excludes unvalidated arrivals; normal active HOLD_LOCAL calls this same helper for subsequent scan. No new autonomous scanner claimed. Current historicaljobs stay terminal; future authorized recovery must re-read jobs/Owner/current batch and all roles/TTL/execution risk. No physical truth asserted.

## Binding
```json
{
  "taskId": "ES-DIAMOND-V3-FINALIZE-HELD-UPDATE-OPTIMIZATION-01",
  "status": "CANDIDATE_ONLY_NOT_AUTHORIZED_FOR_RELEASE",
  "candidateSha": "83d7b829096348d339b8b0e3fef9d9a0dc029b32",
  "trustedMain": "ffa3ba4e0bb327fb7bfe5f91d29d167700d772a2",
  "productionSha": "dcda3b473c06b1f2fde3a99dad915df667096e30",
  "productionDeployment": "dpl_ASTXeyXUwnmKJbrsRbyWXzsW22sf",
  "productPaths": {
    "lib/v3-print-job-adapter.ts": "992900c79a0d422e6d7c5359ebc15b628ceee31cbc84e19d5fbbb65076b2fb63",
    "tests/v3-print-control-plane-service.test.ts": "f01ef9f83d58b89244f4a5036b2ddd5649ecdcddafa3a0e04978531585823cb3",
    "tests/v3-print-job-adapter.test.ts": "690fda278339b1046a042a4dcf2dceb2da8e154ce995b9b493274b683db7bc55"
  },
  "releaseDraft": {
    "sha": "4337c61d7ad0eab564e5591229d70074652869d8",
    "tree": "94631f093a87b363f165960c89ebba3a8649c30f",
    "parent": "dcda3b473c06b1f2fde3a99dad915df667096e30",
    "sourceCommit": "83d7b829096348d339b8b0e3fef9d9a0dc029b32",
    "sourceHashesEqual": true,
    "remotePush": false,
    "requiredAppCheck": "NOT_REQUESTED",
    "deployment": "NOT_AUTHORIZED"
  },
  "lineage": "CONTENT_SUBSET PASS / STRICT NO; preparation only",
  "priorApprovalsInherited": false,
  "remainingApprovals": [
    "new exact frozen successor and CORE disposition under Workflow V1 6.2",
    "main merge and candidate-bound App validator",
    "Production deployment and actual FINALIZE/queue execution",
    "physical output confirmation"
  ]
}
```

## Proposed activation
Fresh actual-code Claude L3PASS, complete exact-candidate tests/TS/Build/Scope, rawCORE plus separately signed task-specific disposition if needed; genuine external Founder Acceptance under WorkflowV1§6.2; normal main integration with hashes/ancestry; fresh candidate-bound selective validator/App SUCCESS; separately authorized Production and actualFINALIZE. Old App status58305885445 is for parent only and cannot be reused. No inherited acceptance deadline extended.
