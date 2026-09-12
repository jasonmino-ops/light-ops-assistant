# ES-PRINT-NETWORK-RC7 Endpoint Continuity Precheck V1.0

## 1. Status and boundary

- Gate: `D2-ENDPOINT-CONTINUITY-PRECHECK`
- Task level: L3, because a later implementation would change the Network Print Add-on's cold-start safety decision. This precheck itself is evidence and design only.
- Audited source: `cabba4d138553585062d8b7ceb005921d887c69a`
- Product-code changes in this gate: none.
- Endpoint Continuity implementation authorization: paused pending a new Founder confirmation.
- Persistent field evidence: `docs/acceptance/ES-PRINT-NETWORK-RC7-V727-ENDPOINT-MAC-STABILITY-EVIDENCE-V1.0.json`.

## 2. V727 MAC stability result

The Founder/onsite operator completed five full power-off/power-on cycles of the print server/NP330. The read-only monitor observed the endpoint become unavailable and recover in every round before reading its neighbor identity.

| Round | Endpoint | TCP 9100 after recovery | Observed MAC | Confirmed `hardwareAddress` | Match |
| --- | --- | --- | --- | --- | --- |
| 1 | `192.168.18.53:9100` | reachable, zero bytes | `08-00-27-5c-ca-57` | `08-00-27-5c-ca-57` | PASS |
| 2 | `192.168.18.53:9100` | reachable, zero bytes | `08-00-27-5c-ca-57` | `08-00-27-5c-ca-57` | PASS |
| 3 | `192.168.18.53:9100` | reachable, zero bytes | `08-00-27-5c-ca-57` | `08-00-27-5c-ca-57` | PASS |
| 4 | `192.168.18.53:9100` | reachable, zero bytes | `08-00-27-5c-ca-57` | `08-00-27-5c-ca-57` | PASS |
| 5 | `192.168.18.53:9100` | reachable, zero bytes | `08-00-27-5c-ca-57` | `08-00-27-5c-ca-57` | PASS |

Result: 5/5 MAC observations match the confirmed identity; no MAC change occurred. This field result supports using the confirmed MAC as a V1 change-detection anchor for this deployed device. It is not cryptographic identity and does not prove that all future printer-server models will have stable MACs.

The post-cycle read-only check also found `.53:9100` reachable, `.49:9100` timed out, the original Add-on main PID remained `1180`, and the top-level protected profile, journal, and result-log byte counts and SHA-256 values were unchanged from the pre-cycle snapshot.

Procedural disclosure: one earlier read-only runtime-version probe invoked the packaged executable as a secondary instance because its run-as-Node fuse is disabled. It did not replace PID `1180`, open a settings action, or change the three state files above; it did leave one additional child process in the post-check process list. No further executable invocation was used to collect the MAC evidence.

## 3. Current gates in the audited code

The same `validateEndpoint` dependency currently enforces full fingerprint equality and confirmed-device validation at three runtime points:

| Gate | Current location | Current behavior |
| --- | --- | --- |
| Receive / before cloud claim | `e-shop-tray/src/networkRuntime.ts:50-64`, wired by `e-shop-tray/network-addon/main.ts:161-165` | Identity, persisted endpoint, fingerprint and MAC validation happen before `client.receive()`; a failure means no claim. |
| Prepare / after claim | `e-shop-tray/src/networkRuntime.ts:87-96` | The job/store/mode/endpoint are checked, then the same fingerprint/MAC validation runs before rendering. |
| Send-before / effect boundary | `e-shop-tray/src/networkRuntime.ts:108-119` | Identity and exact config are re-read, then the same validation runs immediately before TCP delivery. A validation failure remains `NOT_CROSSED`. |

Cold startup has an additional gate at `e-shop-tray/network-addon/coldModeLifecycle.ts:68-75`, using `validateColdContext` from `e-shop-tray/network-addon/main.ts:118-125`. `initialize()` catches its error at `main.ts:169-173`; the poller is not started.

The full fingerprint is composed of physical-network records, complete route topology (`interfaceIndex`, `destinationPrefix`, `nextHop`) and all local addresses (`e-shop-tray/src/networkDiscovery.ts:186-200`). `assertConfirmedPrinter` hard-blocks a stored/current mismatch and a read-to-read mismatch (`networkDiscovery.ts:124-133`). Discovery separately keeps strict snapshot continuity before and after scan waves (`networkDiscovery.ts:473-533`).

## 4. Completed Endpoint Continuity design

### 4.1 Cold-start ordering

The minimum safe order is:

1. Load the settled confirmed test and persisted node; require the exact configured `host:port` to equal the confirmed endpoint and retain store/device binding checks.
2. Read one fresh Windows network snapshot and validate the exact endpoint as RFC1918, on exactly one direct physical LAN, not a gateway, with no equal/more-specific route escape and no ambiguous physical interface.
3. Run a zero-byte TCP connect to the exact endpoint, explicitly bound to the validated local address. Timeout, refusal or close maps to a printer offline/unreachable result and the poller remains stopped.
4. Only after TCP success, use Windows `SendARP` for that exact destination and validated source address. This gives Windows an actual successful direct-LAN path before identity is evaluated and avoids treating an empty neighbor cache as evidence of another device.
5. If ARP returns a valid unicast MAC, compare it with the stored confirmed `hardwareAddress`. Only a valid unequal MAC maps to `NETWORK_DEVICE_CHANGED`.
6. Re-read endpoint-specific route/address metadata once before authorization. Re-run the direct-LAN, gateway, route-escape and ambiguity checks. A path change fails with its specific safety code. Full-topology fingerprint differences are recorded as diagnostics, not used as the authorization decision.
7. Start the poller and report `RUNNING` only after all steps pass.

There is no scan, address substitution, or automatic rebind in this sequence.

### 4.2 ARP unresolved versus MAC mismatch

- `ARP unresolved`: `SendARP` fails, returns a non-six-byte value, all zeros, multicast, or malformed output. Map this to `NETWORK_DEVICE_IDENTITY_UNAVAILABLE`; do not infer that another device exists.
- `MAC mismatch`: `SendARP` returns a syntactically valid unicast six-byte MAC and it differs from the stored confirmed value. Map only this case to `NETWORK_DEVICE_CHANGED`.

The current helper already makes this distinction: failures and invalid output become `NETWORK_DEVICE_IDENTITY_UNAVAILABLE`, while `assertConfirmedPrinter` emits `NETWORK_DEVICE_CHANGED` only after comparing a valid returned MAC (`e-shop-tray/src/networkDiscovery.ts:92-133`). The implementation must preserve that separation and reorder TCP before ARP for cold startup.

### 4.3 Responsibilities of the runtime gates under the new model

| Gate | New responsibility |
| --- | --- |
| Cold startup | Perform the complete endpoint-continuity decision once: exact binding/config, direct-LAN/routing safety, zero-byte TCP reachability, valid confirmed MAC, final endpoint-path recheck. Offline means no poller and therefore zero claim. |
| Receive / pre-claim | Recheck binding/config and fresh endpoint-specific routing safety before cloud receive. Do not use full fingerprint equality as a hard block and do not scan. This preserves route-escape/gateway/ambiguity fail-closed behavior before a claim. |
| Prepare / after claim | Check job schema, store, mode, exact endpoint, renderer input/output and effect-boundary bookkeeping. Do not repeat a full TCP + ARP continuity transaction already established before polling. |
| Send-before | Re-read binding/config, fresh endpoint-specific route safety and the confirmed MAC immediately before bytes can cross. The existing transport's real TCP connect is the reachability action; do not add another zero-byte TCP connection immediately in front of it. A pre-delivery safety/identity failure remains `NOT_CROSSED`. |
| Discovery / confirmation | Retain the existing strict snapshot/fingerprint consistency checks. Discovery remains provisional and cannot replace a confirmed endpoint. |

Implementing the distinct prepare/send responsibilities requires a narrow direct edit at the existing validation call sites in `networkRuntime.ts`; removing the redundant prepare-time continuity call or supplying purpose-specific validators is not a `networkRuntime` architecture redesign. It must remain within the current strategy, claim/lease and effect-boundary contracts.

### 4.4 Latency control

The complete zero-byte TCP + ARP transaction runs once at cold start or explicit enable, not at all three per-job gates. For a ticket:

- pre-claim uses local endpoint-path metadata only;
- prepare performs no network continuity I/O;
- send-before performs one MAC check, followed by the one real transport TCP connection that sends the already-rendered bytes.

This avoids three full probes and avoids a redundant zero-byte connection immediately before the real connection. It does not cache authorization across a route/config change, and it keeps the final MAC check before the physical effect boundary.

The zero-claim guarantee for TCP timeout/refusal/close is a cold-start guarantee because the poller never starts. Detecting a printer that goes offline after an already successful startup without either a periodic health loop or a pre-claim TCP probe is C4 behavior and is outside this gate; it must not be silently claimed as solved by this design.

### 4.5 Fingerprint diagnostics

The fingerprint becomes a non-authoritative diagnostic signal. On a mismatch, record:

- saved and current fingerprint hashes;
- current canonical physical networks, local addresses and routes;
- the selected endpoint path (`host`, `port`, `localAddress`, `interfaceIndex`);
- exact added/removed address, network and route entries when two real snapshots from the same evaluation are available;
- the endpoint-specific safety result and any blocking code.

The existing rc.7 profile stores only the confirmation-time hash, not the raw confirmation-time snapshot. Therefore an exact historical confirmation-versus-current route/address diff cannot be reconstructed for existing installations. The implementation must not fabricate such a diff. Same-evaluation read-to-read differences can be preserved exactly; for cross-boot evidence, the minimum non-schema option is a bounded non-authoritative diagnostic event containing the current canonical topology and both hashes. Reading diagnostics must never grant permission to print.

### 4.6 Printer starts later than the computer

Current rc.7 does not automatically recover from a cold-start validation failure after the printer later becomes reachable. `ColdModeLifecycle.resumeAtStartup()` validates before starting the poller; `initialize()` catches the failure only to retain the code, and no timer calls `resumeAtStartup()` again. The Add-on remains protected until a later process restart or an operator action causes another startup/enable path.

If the poller was already running, its loop catches a pre-claim failure and schedules another poll after the normal interval (`e-shop-tray/src/relayPoller.ts:80-103`). That is distinct from the cold-start failure where the poller never starts. Adding cold-start automatic recovery is C4 and is explicitly not part of this precheck or the paused implementation.

## 5. Impact and recommendation

The design does not alter store/device binding, the exact persisted endpoint, discovery confirmation, claim/lease, PrintJob, Renderer, Transport abstraction, or automatic binding behavior. Its security trade-off remains explicit: MAC is a local change detector rather than cryptographic printer identity. A same-IP/same-port/same-MAC impersonation is possible on a hostile LAN; the current product has no stronger printer-provided immutable identity. Direct physical-LAN/routing checks, exact endpoint locking, confirmed MAC, and the real TCP connection preserve the practical V1 boundary without allowing unrelated topology changes to block a reachable confirmed printer.

Recommendation: the MAC-stability precondition passes and the Endpoint Continuity direction remains suitable for a minimal implementation. Do not resume implementation until Founder issues a new confirmation after this precheck.
