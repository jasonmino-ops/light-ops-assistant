# ES-PRINT-RC10 Cold Start Recovery Final Freeze Record

## Frozen object

This freeze applies to the accepted RC10 Candidate and its bounded cold-start recovery behavior:

- Task: `ES-PRINT-RC9-COLD-START-RECOVERY-01`
- Source: `b1439ceeb95c4b895940123904d64f42fa80103b`
- Implementation: `67c5fc5ecb880d674cd9b1a2cd3c3c5636308fa4`
- Version: `0.1.0-commercial-rc.10`
- Installer SHA-256: `5d1bc3ec16863ff2a42e8a72ab124502b0fdbcb7e241c8f30fb63f4ae075dc80`
- FIELD device: V727 / `PC-20260119FZUI`
- FIELD result: Founder-confirmed PASS

`FINAL FROZEN = YES` means the above Candidate and behavior are frozen as accepted evidence. The Candidate remains `TEST ONLY / unsigned`; this record is not a signing or formal release record.

## Accepted behavior

At RC10 cold start, unreachable printer validation remains fail-closed: `printingReady=false`, no poller start, and WAITING until the existing complete startup safety validation passes again. Recovery is restricted to `NETWORK_PRINTER_UNREACHABLE`, uses one bounded low-frequency timer, preserves FRONT/KITCHEN role atomicity, cancels on lifecycle/config changes, and starts the poller at most once after complete validation passes. Other error codes remain blocked.

## Explicitly not frozen as implemented

- No continuous active printer liveness probe while RUNNING.
- No independent Pause user entry in the RC10 FIELD UI; Pause Cancellation is `NOT APPLICABLE / DEFERRED`.
- No automatic rebind, endpoint mutation, Transport change, Routing change, Binding change, Network Discovery expansion, Print Job semantic change, Desktop change, or Local-First Printing integration.

## Governance result

- Release Lineage Gate: PASS using Production SHA `4bb3cbcea90f7e29e22d4b1f71c03f948056773a`, release SHA `b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4`, and trusted `origin/main` `b1439ceeb95c4b895940123904d64f42fa80103b`.
- Exact RC10 Candidate authorization: CLOSED after the retained Candidate and Founder FIELD acceptance.
- Production deployment: unchanged; no deployment performed in this closure.
- Runtime code changes in this closure: none.
- Remaining Action: NONE for this task.

The printing line is paused. Further printing integration must begin as a separate authorized task: `ES-PRINT-LOCAL-FIRST-SHARED-CORE-01`, after Desktop main shell completion.
