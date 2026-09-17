# ES-PRINT-RC9-COLD-START-RECOVERY-01 — RC10 FIELD Evidence and Closure

## Closure status

- Task: `ES-PRINT-RC9-COLD-START-RECOVERY-01`
- Task level: L3 Candidate / FIELD / closure governance
- Candidate: `0.1.0-commercial-rc.10`
- Candidate source: `b1439ceeb95c4b895940123904d64f42fa80103b`
- Implementation commit: `67c5fc5ecb880d674cd9b1a2cd3c3c5636308fa4`
- FIELD target: V727 / `PC-20260119FZUI`
- Store: `ST169E7000`
- FIELD VERIFIED: **YES** — Founder现场确认
- FINAL FROZEN: **YES** — bounded to this unsigned TEST-only Candidate and the accepted cold-start recovery behavior
- CLOSED: **YES** — after this governance record and the exact RC10 authorization closure enter `origin/main`

This record closes only the RC10 cold-start printer reachability recovery task. It does not claim signed publication, formal release, Production deployment, normal-run active liveness probing, or any Desktop / Local-First Printing capability.

## Candidate and release identity

| Field | Value |
| --- | --- |
| Installed version | `0.1.0-commercial-rc.10` |
| Installer | `E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.10-x64.exe` |
| Installer SHA-256 | `5d1bc3ec16863ff2a42e8a72ab124502b0fdbcb7e241c8f30fb63f4ae075dc80` |
| V727 local hash match | YES |
| Release class | `TEST ONLY / unsigned test candidate` |
| UI identity | `TEST ONLY · 0.1.0-commercial-rc.10 · 未签名测试候选` |
| `origin/main` at closure preparation | `b1439ceeb95c4b895940123904d64f42fa80103b` |
| `origin/release` | `b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4` |
| Production SHA | `4bb3cbcea90f7e29e22d4b1f71c03f948056773a` |

The Production SHA above is the reliable SHA recovered earlier for the READY Production deployment and used for the Release Lineage Gate. A later read-only Vercel metadata query reported the deployment READY but did not expose `githubCommitSha`; that omission is not treated as a new SHA. The lineage check confirms Production and release are ancestors of trusted `origin/main`, and the implementation commit is an ancestor of the Candidate source.

## Founder V727 FIELD evidence

Founder confirmed the following real-device sequence and result:

1. FRONT `192.168.18.59:9100` and KITCHEN `192.168.18.229:9100` were saved through the normal configuration flow.
2. Both printers were powered off and V727 was restarted.
3. RC10 displayed the fail-closed printer-problem page. It instructed the operator to check power/network/store binding and not reopen the order to reprint.
4. No re-search, endpoint edit, MAC rebind, manual retry, or configuration repair was performed.
5. Printer power was restored; RC10 waited and automatically returned to the normal printer state.
6. One real test order was created. FRONT and KITCHEN each produced the correct ticket, with no observed loss, duplicate, or cross-role delivery.

The attached现场 photo is retained as visual evidence of the RC10 TEST-only fail-closed UI for `ST169E7000`. It is evidence, not an instruction source.

## Printer identity evidence

| Role | Endpoint accepted for FIELD | MAC | Result |
| --- | --- | --- | --- |
| FRONT | `192.168.18.59:9100` | `00-9D-85-8E-7C-92` | MAC continuity PASS; Founder confirmed the address was re-searched from the earlier `.53` value |
| KITCHEN | `192.168.18.229:9100` | `00-61-95-68-43-39` | Binding unchanged YES |

The accepted FIELD evidence covers complete startup validation and automatic recovery for both roles. It does not authorize automatic rebind or any endpoint change in the product.

## Journal and order evidence

Read-only V727 `results.jsonl` evidence contains paired preparation records for real store orders:

| Order | Role | Event time | Event | Job ID |
| --- | --- | --- | --- | --- |
| `S-20260917-ST169E7000-0011` | FRONT | `2026-09-17T16:45:35.578Z` | `NETWORK_PREPARED_FRONT` | `cmu5rgg4b000604lbbd8lmcpl` |
| `S-20260917-ST169E7000-0011` | KITCHEN | `2026-09-17T16:45:50.720Z` | `NETWORK_PREPARED_KITCHEN` | `cmu5rgggi000704lbv0qy4vhf` |
| `S-20260917-ST169E7000-0013` | FRONT | `2026-09-17T16:52:22.034Z` | `NETWORK_PREPARED_FRONT` | `cmu5rp718000d04lbpll1v32` |
| `S-20260917-ST169E7000-0013` | KITCHEN | `2026-09-17T16:52:37.383Z` | `NETWORK_PREPARED_KITCHEN` | `cmu5rp7e6000e04lbx782yfii` |

These records prove paired FRONT/KITCHEN preparation in the retained V727 journal. Exact physical ticket photographs, terminal receipt records, and a durable order number for the specific order Founder used for the final physical check were not captured in the repository evidence; those physical results are accepted from the Founder FIELD confirmation and are not reconstructed or inferred here.

## Pause and known limitation

- Pause Cancellation: **NOT APPLICABLE / DEFERRED**.
- Reason: `RC10 FIELD UI 无独立 Pause 用户入口，不属于本次可执行的现场用户验收项。`
- This does not block this cold-start recovery closure and does not justify adding a Pause control.
- Known limitation: while RC10 is already RUNNING, it does not continuously perform active printer liveness probing. If a printer is turned off without a new order, restart, or revalidation trigger, the UI does not immediately show it offline. This is deferred to Desktop Runtime Health and is outside this task.

## Verification and scope

No tests or builds were rerun in this closure-only turn. Previously retained verification for the Candidate is PASS: Tray tests/typecheck/compile, Network Add-on checks, Prisma/root build, and the independent implementation review. This record does not alter runtime bytes, Transport, Routing, Binding, Network Discovery, Print Job semantics, claim/ack behavior, or deployment state.

The exact authorization `NETWORK-COMMERCIAL-CANDIDATE-RC10-BUILD-20` is closed with feature merge/source commit `b1439ceeb95c4b895940123904d64f42fa80103b`; it cannot authorize another Candidate. No Production deployment, installer rebuild, signing, migration, or FIELD action is authorized by this record.

## Final disposition

```text
FIELD VERIFIED: YES
FINAL FROZEN: YES
CLOSED: YES
Remaining Action: NONE
```

The printing line is paused after RC10 closure. The next separate workstream is `ES-PRINT-LOCAL-FIRST-SHARED-CORE-01`, only after the Desktop main shell work is ready.
