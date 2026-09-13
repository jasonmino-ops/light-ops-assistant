# Network Print rc.9 FRONT/KITCHEN Dual Endpoint FIELD Closure

## Governance status

- Gate: `FRONT/KITCHEN DUAL-ENDPOINT FIELD CLOSURE`
- Task level: L3 Candidate/FIELD governance closure
- Candidate: `0.1.0-commercial-rc.9`
- Source: `a7bee16c9bbdc4f32360afa331a3b66fd80c1fe2`
- FIELD VERIFIED: **YES**
- FRONT/KITCHEN Dual Endpoint V0.1 V727 FIELD Gate: **ACCEPTED / CLOSED**
- Exact build authorization `NETWORK-COMMERCIAL-CANDIDATE-RC9-BUILD-19`: **CONSUMED; proposed CLOSED in this Closure Candidate**
- Signed publication / Production deployment / whole-product closure: **NO**

This record accepts the bounded dual-endpoint FIELD result. It does not declare the unsigned TEST installer a formal release and does not claim that Production contains the FRONT/KITCHEN change. The authorization status becomes trusted repository policy only after a separately authorized integration of this Closure Candidate into `origin/main`.

## Candidate identity and lineage

The one retained rc.9 Candidate was built with zero source delta from trusted `origin/main` at `a7bee16c9bbdc4f32360afa331a3b66fd80c1fe2`. The reviewed dual-endpoint product Candidate `266c968733382d77ebd7dd08f2ab992ae7b71fdd` is a first-parent ancestor of that source. The rc.9 PREPARE commit `a7bee16c9bbdc4f32360afa331a3b66fd80c1fe2` itself entered `origin/main` by direct first-parent fast-forward lineage; no distinct merge commit exists.

At closure preparation, fetched `origin/main` is `c98a897cdb7ed66ae2f420a7818f36e19aa2a636`. The only first-parent change after rc.9 PREPARE is an unrelated accepted scope-exception record and does not modify the Network Print product or authorization paths. `origin/release` and READY Production remain `a33b44c1c51223009326c4869526f7de6bd4a89d`. Release Lineage PASS confirms that Production is an ancestor of the trusted main. This Gate performs no push, merge, build, release update or deployment.

## Artifact registration

| Field | Value |
| --- | --- |
| Version | `0.1.0-commercial-rc.9` |
| Build class | unsigned TEST-only Candidate |
| Installer | `E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.9-x64.exe` |
| Installer bytes | `114343227` |
| Installer SHA-256 | `b9391daa68922e0693678d5c80b23b8fbe541d9f516f89bb5ca0165ad80365df` |
| Source snapshot SHA-256 | `4bdc3503526323c2bb3c539bb861d7632f513495b03a4092aeb8933585b05dfb` |
| Exact authorization | `NETWORK-COMMERCIAL-CANDIDATE-RC9-BUILD-19` |
| Authorized mapping SHA-256 | `6d5bcb10fe87b354de77bbd9723447f067be4d6a8b05408d3fa0deeab9d2d48a` |

Build PASS covered the exact source/authorization boundary, ASAR and executable identity, NSIS structure, 78/78 checksum entries, Tray typecheck/compile with 579 PASS / 1 existing opt-in SKIP, Network Print E2E with 55 PASS / 1 existing opt-in SKIP, cashier network database integration 25/25 PASS, and scope/deployment policy tests 71/71 PASS. The build used Node 24.14.0, npm 11.9.0, TypeScript 5.9.3, esbuild 0.27.4, electron-builder/app-builder-lib 25.1.8, `@electron/asar` 3.4.1, 7zip-bin 5.2.0 and packaged Electron 44.3.0 on Mac16,11 / Apple M4 Pro, macOS 26.3.1 build 25D2128. The Build Gate received a separate fresh-context independent review: PASS. Independent Electron-runtime PE resource attestation was not performed; the retained manifest truthfully records that limitation.

## V727 FRONT/KITCHEN FIELD acceptance

The FIELD target was V727 / `PC-20260119FZUI`. The locked confirmed endpoints and identities were:

| Role | Endpoint | Physical device | Confirmed MAC |
| --- | --- | --- | --- |
| FRONT | `192.168.18.53:9100` | NP330 Wi-Fi printer | `00:9d:85:8e:7c:92` |
| KITCHEN | `192.168.18.229:9100` | Native Ethernet receipt printer | `00:61:95:68:43:39` |

Both roles were configured through the normal rc.9 product flow, independently locked, and first verified with one clearly marked TEST-only physical ticket per endpoint. Each test ticket reached the correct printer with normal content, paper feed and cut, with no extra ticket or role crossing.

Real order `S-20260913-ST169E7000-0010` then exercised the existing Cloud PrintJob, local Runtime, Renderer, Transport and claim/lease path:

| Role | Job | Command bytes | Bytes written | Terminal/result |
| --- | --- | ---: | ---: | --- |
| FRONT | `cmu07j3xw000904ifcpn55b1e` | `64171` | `64171` | `SUCCEEDED` / `SUBMITTED_TO_NETWORK_SOCKET`, reported |
| KITCHEN | `cmu07j4a5000a04ifpsgzck7m` | `58969` | `58969` | `SUCCEEDED` / `SUBMITTED_TO_NETWORK_SOCKET`, reported |

The Founder confirmed exactly one real FRONT ticket from the NP330 and exactly one real KITCHEN ticket from the Ethernet printer. Content, feed and cut were normal. Observed outcome: zero lost tickets, zero duplicate tickets and zero cross-role delivery. The execution journal ended 56/56 terminal/reported, with zero unreported, `CROSSING_UNKNOWN`, quarantined or abandoned entries. `FIELD VERIFIED = YES` is bounded to this Candidate, V727, these confirmed endpoints and this real-order path.

The earlier accidental discovery-button click created no persistent binding, confirmation, test-print or journal change. The displayed `192.168.1.81` was an unpersisted UI placeholder; no scan result was selected or auto-bound. This observation is retained as safety evidence and is not a product change in this closure.

## Evidence integrity and disposition

Durable build evidence is retained under `/Users/jason/Desktop/es-rc9-candidate`; repository facts required to audit FIELD acceptance are reproduced in this tracked record so worktree pruning does not erase the baseline.

| Evidence | SHA-256 |
| --- | --- |
| `BUILD-RECORD.txt` | `1972e953c0dc553ea4393fb4ca216747500a27f92ac10a775bc4f1ba7992163a` |
| `candidate-build-manifest.json` | `9218e614fd65c85df36ed110215d17e571054d175328d5e8b17a2f2bb3f719d0` |
| `SHA256SUMS.txt` | `cd063eed36c7541729a7028f520f32b6a2b4abcc808cbf00f5004ffd55eb9eb2` |
| `builder.log` | `02bc6a34df9e3fe9a7f15cc8d7715fde1eb7cc2d1f4a50a229933c30f1e44d0f` |
| V727 profile after FIELD | `878d49fe7cc37cf3bd7224907d3dab217f8642887b2ca6b3655b31927f6fc76b` |
| V727 nodes revision 8 after FIELD | `2c66426aedc21dc54081e09e0ce98e7b79b6efc790657892e92722f08485516b` |
| V727 execution journal after FIELD | `a064e3dc556167b529dd0e646c5f42c20073479035f9caf3ba534e2c766392a3` |
| V727 result log after the real order | `95d254d954b00d710a96dc54a8133d990e35e8c7747160352753ab74728c02d9` |

## Closure boundary and next gate

This closure changes no product, profile/config schema, Network Runtime behavior, Renderer, Transport, poller, claim/lease, PrintJob or UI behavior. It performs no rebuild, device mutation, database operation, `release` update or Production deployment. The consumed exact build authorization is retired so it cannot authorize another rc.9 build.

The bounded FRONT/KITCHEN dual-endpoint infrastructure is technically eligible to support a separately scoped kitchen item-routing Gate or G1 Gate. Governance readiness is conditional on this Closure Candidate first receiving fresh-context independent review and being integrated into trusted `origin/main` under its own Founder Gate. Any later Gate must carry its own scope and authority; no build, FIELD, release or Production authority is inherited from this record.
