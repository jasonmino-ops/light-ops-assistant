# Test coverage matrix

| Safety claim | Actual coverage |
| --- | --- |
| EXPIRE10s + CAS preserved | byte comparisons to ca7; old5s reproduction,5.7s commit,10.3s rollback; old and compensation EXPIRE |
| Dedicated exact contract | parser rejects extra grant/admission/approval/expiry fields, false confirmation and missing installation; old actions do not consume new grant |
| Single-use + replay | one successful append-only REVIEW, exact replay returns same ID without writes, changed request digest conflicts, new IDs cannot renew even after expiry |
| Concurrent REVIEW/EXPIRE | actual PostgreSQL concurrent distinct and identical REVIEW IDs, concurrent EXPIRE; at most one durable grant/terminal audit |
| Original audit binding | missing/wrong request/time/reviewer/fence/job bindings rejected; original successful EXPIRE blocks compensation; original audit remains unchanged |
| Identity/isolation | exact pinned active SUPER_ADMIN, tenant/store/device/jobset/stateVersion; wrong role/actor, disabled admin/revoked device, changed original/current installation rejected |
| Fence/execution | owner, ownerEpoch, release time, active batch, claim or CROSSING_UNKNOWN rejected; existing claim/REPORT races still pass |
| Freshness/window | old capture and reused ID rejected, original30s receipt/5min expiry retained, finite absolute deadline, crossing deadline after audit/writes rolls back |
| Atomic rollback | REVIEW audit failure/5s timeout creates no grant; EXPIRE audit failure/10s timeout leaves all3 PENDING and keeps original single-use grant spent |
| Business invariants | REVIEW has no task mutations; EXPIRE only3 approved rows; held sentinel remains pending; mode696/ownerNONE unchanged; receipt count and immutable payload/key/hash retained |
| Existing contracts | unchanged Chinese/UI eligibility/handlers/readout, V3 adapter/reprint, V2 frozen invariants; full CORE truthful103/101/2/BLOCKED |

142 tests PASS with no skips, real isolated socket PostgreSQL. No actual Windows capture, Production recovery or paper print is exercised by these tests; later FIELD must inspect fresh trusted local evidence and actual output.
