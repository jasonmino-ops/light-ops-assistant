# ES-DIAMOND-V3-FINALIZE-TIMEOUT-RECOVERY-01 — bounded successor DRAFT

Status: **SEALED DRAFT — NOT ACTIVE**. Preparation only; no main merge, release, Production, FINALIZE, held release or printing authorization. ES-ENG-001 Founder Approval “Exception to a frozen baseline”, Workflow V1 §§5–6.2 apply. No historical freeze, KTF, test assertion, registry, manifest or exception record is rewritten. The previous EXPIRE/compensation approval is not inherited for these new bytes.

## Exact proposed change
Only authenticated existing `FINALIZE_V3_ACTIVE` mode service gets a 10000ms bounded interactive transaction lifetime. Other four mode actions preserve default options; REVIEW/EXPIRE/compensation stay byte-identical. Authenticated route, CAS, state/queue/Owner/Lease/Fence/handoff checks, audit fields/order/atomicity, per-held-row CAS, payload validation, TTL, role, idempotency, identity and delivery/report rules remain unchanged. No automatic retry, ACK, task reset, transaction splitting, schema/migration, new API, hardware or Desktop change. The optional timeout TypeScript annotation is widened and erased at compilation; explanatory comments are added. The budget applies to this existing action for all stores; it is NOT a Diamond-only runtime policy. This global action budget is the explicit minimal service fix, not cross-store data access. Store authorization/tenant scoping remains unchanged.

Atomic checks/audit/mode-CAS/held materialization cannot be hoisted outside the transaction without changing safety; no external IO in callback was found to remove. Sequential held updates exceed default5s in two real incidents, at6154/6009ms. Log identifies lifetime expiry at updateMany, NOT individual SQL duration, lock source or failing loop index. 10s is a bounded budget (also used by approved EXPIRE), verified with5.7s injected delay and10.3s rollback; it is not a guarantee for arbitrary queue size, future DB latency or Production success. No backlog cap added.

## Immutable bindings
```json
{
  "candidateSha": "b86ac6a953a3e98b602f820b016fe9c59e444eeb",
  "trustedMain": "14dbe9783ae64966af316a33261b3fee7281dc1f",
  "productionSha": "1427131e94aba6a19c52dee61f531fec2c9213b3",
  "productPaths": {
    "app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts": "97ab7b428ea560e032a16228f9befc00ea7387c2e5383d06665d404692d92339",
    "tests/v3-print-control-plane-service.test.ts": "4d3e108567da12a38d0e62c5fef5a982332134f6df11db22e306e9f1e9ab69b4"
  },
  "releaseDraft": {
    "sha": "dcda3b473c06b1f2fde3a99dad915df667096e30",
    "tree": "9765fcbb0586fa36aecfd0bd8b587ff4b21a29cb",
    "parent": "1427131e94aba6a19c52dee61f531fec2c9213b3",
    "sourceCommit": "b86ac6a953a3e98b602f820b016fe9c59e444eeb",
    "productHashesEqual": true,
    "authorized": false,
    "requiredAppCheck": "NOT_REQUESTED",
    "sourceInMain": false
  }
}
```

## Scope and safety
Product paths exactly service.ts and its existing service test above; governance paths in manifest. Three historical jobs remain EXPIRED/NOT_CROSSED. Never repeat REVIEW/EXPIRE, renew consumed compensation, reactivate jobs, fabricate audits or infer physical output. Timeout/HTTP500 outcomes require read-only state/audit verification before any separately authorized retry.

## Proposed acceptance conditions (not satisfied by this draft)
Fresh independent Claude L3 PASS; actual TypeScript/Build/targeted release-tree test/Scope proof; new CORE results preserved without relabeling PASS; exact task-specific limited disposition separately approved. Exact bytes signed by Founder, recorded and integrated into trusted origin/main before release. New release/source SHA or parent/tree drift requires validation and candidate-bound required check; old App status58273115680 is inapplicable. Proposed limited admission deadline **2026-11-08T00:00:00Z exclusive**, never auto-extended. Any extra failure, repaired baseline, code/hash/scope drift or expiry invalidates proposal. This deadline is a proposed admission bound, not a new runtime compensation window.

## FIELD
Pending; current task expressly prohibits Production deployment/FINALIZE/printing. After fresh explicit release and execution authority: verify current terminal jobs, control state/version, owner/lease/batches, all valid held roles/TTL/unknown execution; formal SUPER_ADMIN FINALIZE only; Desktop single-owner acquisition; safe original-queue execution; physical FRONT confirmation. No guarantee or FIELD/CLOSED claim from local tests.
