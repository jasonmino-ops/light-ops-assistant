# Network Print rc.8 V727 FIELD Closure

## Governance status

- Gate: `RC8 FIELD CLOSE`
- Task level: L3 Candidate/FIELD governance closure
- Candidate: `0.1.0-commercial-rc.8`
- Source: `70c61bf46855350aae478a96f05ab4608b0695fe`
- FIELD VERIFIED: **YES**
- RC8 V727 FIELD Gate: **ACCEPTED / CLOSED**
- Exact build authorization `NETWORK-COMMERCIAL-CANDIDATE-RC8-BUILD-18`: **CONSUMED; proposed CLOSED in this Closure Candidate**
- Signed publication / Production deployment / whole-product closure: **NO**

This record accepts the bounded Endpoint Continuity FIELD result. It does not declare the unsigned TEST installer a formal release and does not claim that Production contains the Endpoint Continuity change. The authorization status becomes trusted repository policy only after a separately authorized integration of this Closure Candidate into `origin/main`.

## Candidate identity and lineage

The one retained rc.8 Candidate was built with zero source delta from trusted `origin/main` at `70c61bf46855350aae478a96f05ab4608b0695fe`. Endpoint Continuity source Candidate `0a4f9a5d82f73b4a2ff5124589d70f0d68b7efa3` is an ancestor of that source. The rc.8 PREPARE commit `70c61bf46855350aae478a96f05ab4608b0695fe` itself entered `origin/main` by fast-forward first-parent lineage; no distinct merge commit exists.

At closure preparation, fetched `origin/main` remains `70c61bf46855350aae478a96f05ab4608b0695fe`. `origin/release` and READY Production remain `a33b44c1c51223009326c4869526f7de6bd4a89d`. Release Lineage PASS confirms that Production is an ancestor of the trusted main. This Gate performs no push, merge, build, release update or deployment.

## Artifact registration

| Field | Value |
| --- | --- |
| Version | `0.1.0-commercial-rc.8` |
| Build class | unsigned TEST-only Candidate |
| Installer | `E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.8-x64.exe` |
| Installer bytes | `114340855` |
| Installer SHA-256 | `e31ecd572b9f82bd6a0d1022a856493e20973d05177d5eb3c9d3c2fd3a60f306` |
| Source snapshot SHA-256 | `e90b22e77a2951c2553505d85f9524c1c645f24b1d83745029dcb8deb7ff69c9` |
| Exact authorization | `NETWORK-COMMERCIAL-CANDIDATE-RC8-BUILD-18` |
| Authorized mapping SHA-256 | `4474325133f9ca21583ada6d0af00878c96b5f3a96c8914281bdc0114664c2ff` |

Build PASS covered source/authorization checks, ASAR and executable identity, NSIS structure, 78/78 checksums, Tray typecheck/compile and 16/16 test files with 568 PASS / 1 existing SKIP. The build used Node 24.14.0, npm 11.9.0, TypeScript 5.9.3, esbuild 0.27.4, electron-builder 25.1.8 and packaged Electron 44.3.0 on Mac16,11 / Apple M4 Pro, macOS 26.3.1. The Build Gate received a separate fresh-context independent review: PASS.

## V727 FIELD acceptance

The FIELD target was V727 / `PC-20260119FZUI`, using the locked confirmed endpoint `192.168.18.53:9100`.

- Full Windows shutdown and later boot completed. Boot time was `2026-09-13T03:08:20.5000000Z`; the Agent automatically started at `2026-09-13T03:09:27.8165670Z` in interactive Session 1.
- No settings, discovery, rebind, configuration repair or manual Add-on restart was used.
- The rc.7 false `NETWORK_CHANGED` did not recur. rc.8 restored `RUNNING` against the same confirmed endpoint.
- A real CASH order produced two physical tickets; the Founder confirmed both contents normal.
- Execution journal advanced from 46 to 48 and ended 48/48 terminal/reported, with zero claimed, executing, unreported, unknown, quarantined or abandoned entries.
- The confirmed endpoint remained reachable. The secondary observed address `192.168.18.49:9100` remained unreachable by timeout; this is evidence only and is not a binding or FRONT/KITCHEN implementation decision.

Result: the Endpoint Continuity change resolves the rc.7 cold-start false-positive observed on this V727 FIELD path. `FIELD VERIFIED = YES` is bounded to this Candidate, device, confirmed endpoint and protocol.

## Evidence integrity and disposition

Durable external evidence is retained under `/Users/jason/Desktop/es-rc8-candidate`; repository facts needed to audit the decision are reproduced in this tracked record so worktree pruning does not erase the acceptance baseline.

| Evidence | SHA-256 |
| --- | --- |
| `BUILD-RECORD.txt` | `1b150260226cfa169691db6d6934d425ad57f915caf0401c4287cbe8e79f01f6` |
| `candidate-build-manifest.json` | `32a444e5dfc648552a16fe0475c0697cfd5cc8fff1e127500c67bd7f665a3007` |
| `SHA256SUMS.txt` | `3ddc8e1b9e701ce3788eaf1ad27d64098e29a5ceb6ab90dcadcc800335aeb20e` |
| `builder.log` | `dd72418d070848d79a363c35e8c38c588a6855ff13cb5a2942e10653a95851b3` |
| `field-evidence/FIELD-RESULT.md` | `bb5d8e8054ee41c6358d0e83a8891e20e287f3e58d3b47a4ce179b5d8d4c14ce` |

The installer worker and pre-upgrade safe-exit helper each missed their scheduled-worker receipt. Independent read-only state evidence established the completed one-time upgrade and natural prior-process exit; neither operation was retried or forced. This is retained as an evidence-harness limitation, not classified as an observed rc.8 product failure.

## Closure boundary and next gate

This closure changes no product, config schema, Renderer, Transport, poller, claim/lease, PrintJob or UI behavior. It performs no rebuild, device mutation, database operation, `release` update or Production deployment. The consumed exact build authorization is retired so it cannot authorize another rc.8 build.

The bounded Endpoint Continuity baseline is technically eligible for a separately scoped FRONT/KITCHEN dual-endpoint Gate. Governance readiness is conditional on this Closure Candidate first being independently reviewed and integrated into trusted `origin/main` under its own Founder Gate. Such a later Gate must supply its own exact scope and must not infer build, FIELD, release or Production authority from this record.
