# Network Print commercial Add-on — implementation and release gates

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Authority and scope

L3. Founder authorizes independent commercial Network Add-on, bounded relevant LAN discovery, first-run GUI, explicit selected-device TEST, manual fallback/address recovery, necessary server integration, tests/review/exact grants/commits/main/Production and commercial delivery. Fees/new paid resources, schema changes or security weakening require a separate decision. This record does not assert those unresolved decisions have been made.

Base: `40f60c9af3c6c6bd80f4b94e88ad70eeadaf2764`, clean current main and READY Production at branch creation, Release Lineage PASS. Worktree `/private/tmp/es-network-commercial-addon-v01`, branch `codex/es-network-commercial-addon-v01`. Existing sealed drafts and rc.3 remain unchanged. Current work is uncommitted and not a released installer.

## Reuse and minimal new responsibility

The existing Tray project retains its original Windows main, package version and Windows build commands. The independent `network-addon/main.ts` reuses the CloudRelayClient, RelayPoller, ExecutionJournal, Desktop read-only Binding adapter and result logger. Network preparation and sandboxed rendering are extracted into one shared module, rather than copied into another Agent project. Original templates, bitmap rendering and ESC/POS encoding are unchanged. No schema/migration, QZ, USB, Windows Queue, driver, Desktop or credential-file writes.

New responsibility: bounded physical-LAN discovery; GUI selection/TEST/confirmation/status; durable first-run profile and same-device endpoint revisions; a separate bundled-runtime installer profile/build manifest. FRONT_ONLY and SHARED_PRINTER remain the only modes. No hot mode change, dual physical routing, updater/authentication platform or general network scanner.

`app/cashier/launch/page.tsx` receives a minimal explicit Network option branch. It uses the existing one-time launch ticket exchange and server-returned store/device session. Valid Network options redirect to `/cashier` with the exact opt-in; malformed Network options reject without ticket consumption or legacy fallback. The unchanged default still redirects Desktop to `/desktop/pos`. No auth API or cashier core changes. The Add-on requests the existing ticket without sending agentVersion, so it does not overwrite Desktop Binding version metadata. Long-lived device credentials never enter the UI or URL. The server handoff refinement is local only until a later gated deployment; current Production contains the previously released V0.1 task capability.

## Device discovery and address safety

Windows physical Ethernet/Wi-Fi interfaces must match local IPv4 metadata and an on-link route. Only direct RFC1918 literal addresses are accepted; self, subnet/network/broadcast, gateways, virtual/VPN interfaces and competing same/more-specific routes are rejected. Discovery checks only RAW TCP port 9100 with zero application payload, at most 1024 targets, 16 simultaneous connections, 600ms per connection and a 45s scan deadline. Bigger subnets use explicit manual fallback rather than silently scanning a partial range. Manual ports 1–65535 still require the same physical-LAN checks. There is no NP330/model/port hard dependency in delivery.

Open ports remain unverified candidates. Only the selected device receives one user-requested TEST. Paper confirmation is required before enabling. The selected adapter's MAC is acquired using Windows SendARP on the verified source interface; it is stored with the confirmed network fingerprint in the encrypted profile. Startup, enable, receive, preparation and pre-delivery check continuity. After waiting for ARP the route snapshot is refreshed and revalidated; TCP binds the verified local source address. A different fingerprint/device stays blocked until explicit rediscovery/TEST/confirmation. This is change detection, not cryptographic identity: MAC spoofing, topology changing in the final OS scheduling interval and replacement of a USB printer behind the same adapter cannot be ruled out. Human verification remains essential.

Address recovery pauses and waits for the existing poller/ACK to settle. It requires confirmation that the TEST came from the SAME original physical printer, retains the mode, binding and original journal, and publishes a new immutable endpoint revision. Unknown historical business effects cannot be cleared through setup. A TEST whose bytes were submitted but no paper was observed remains a support incident; deleting profile/journal or repeating sales is not a remedy. Pre-transport TEST validation failure is NOT_CROSSED and may be followed by another explicit user TEST; uncertain transport output remains UNKNOWN and is never automatically repeated.

## Durability, isolation and lifecycle

First setup completes the existing journal's atomic write/fsync before publishing the encrypted profile. Missing/corrupt historical state or interrupted first initialization is fail-closed; no empty journal is fabricated. Profile writes use exclusive temp files, fsync, atomic rename and required final writable-handle sync. Existing Windows `load()` behavior remains unchanged. Repeated Enable is rejected before journal reload; valid activation waits for poller idle. Ordinary diagnostics are best-effort, required journal persistence is not.

Product identity: `com.elife.eshop.networkprint.addon`; state under per-user `AppData/Roaming/E-Shop-Network-Print-Addon/state`, separate from Desktop. Installer scaffolding preserves state on upgrade/uninstall, refuses running-process upgrade/uninstall and destructive command switches. Runtime defaults login autostart on explicit enable, supplies a separate safe-exit tray action, and waits for active delivery/ACK before quitting. These new installer controls still require actual Windows lifecycle validation.

## Current verification evidence

- Full Tray tests: 243 PASS, one existing conditional real-Electron renderer smoke NOT RUN. TypeScript PASS.
- Targeted changed-LAN/MAC, delayed-ARP route mutation, idle activation and TEST effect-boundary regressions PASS.
- Existing and new browser launch route tests: 26 PASS with mocked local API responses; zero print jobs. No-ticket local page is visible with no browser errors.
- Next.js production build PASS (173 generated static pages), using a sanitized local-only test configuration. Prisma Client generation only; no migration.
- JavaScript-only bundle and exact input/output hash checking PASS. Uncommitted source honestly yields sourceCommit=null plus baseline and source snapshot hashes. No executable or signing operation is claimed.
- Independent read-only review found lifecycle/continuity issues, corrected within scope; final incremental code review PASS. It does not establish FIELD or commercial release approval.
- V727 actual read-only Windows metadata and selected-device SendARP succeeded. OS Version `10.0.18363`; current NP330 endpoint `192.168.18.53:9100`. No TCP application bytes/paper. This does not validate the complete new Windows Node cross-check, native GUI, installer or discovery on a different LAN.

Prior accepted rc.3/modes evidence remains limited to its recorded source: FRONT_ONLY five sales/five slips, SHARED_PRINTER five sales/ten slips; prior bounded failure/lifecycle evidence retained. It is not automatically inherited as FIELD PASS by this new package. Partial-paper evidence remains CROSSED with physicalCompletionKnown=false, not CROSSING_UNKNOWN FIELD. Abnormal whole-V727 power loss remains NOT VERIFIED/deferred.

## Formal release and remaining gates

### September9 unsigned TEST candidate increment

Explicit renewed Founder authority permits signed-release-independent candidate generation and existing-V727 installation verification, not an unsigned commercial release. Candidate version is `0.1.0-commercial-rc.1`, with TEST filename/product/UI banner, the same independent commercial appId/install/state for lifecycle validation, and `published=false` / `releaseReady=false`. Original rc.3 and Desktop files remain untouched.

Before compilation, `--candidate` requires the real current-branch ACTIVE PRE_COMMIT_CONTENT_SHA256 grant from `origin/main`, byte-identical local Guard/config/exception, exact candidate metadata and actual Scope Guard PASS. All approved/currently changed sources are hashed; unchanged repository inputs must match trusted main. Reject Git environment/context overrides before Git reads and compiler/signing/runtime replacement variables by name without exposing values. No arbitrary approval environment or proof path. Source/input/staging/output hashes are checked before and after packaging; dirty source retains sourceCommit=null.

Candidate packaging uses the existing electron-builder/NSIS profile and fresh private staging. Formal profile still requires signing and formal `--release` still refuses. Candidate verifies unsigned x64 application PE, exact packaged ASAR contents, NSIS installer and embedded uninstaller structure/CRC, and the installer-embedded 7z ASAR/application executable against those verified sibling files. These are explicit subset checks, not a claim that every runtime member or actual Windows execution was verified. Runtime binary version verification and native lifecycle remain pending. No NSIS binary repair or CRC bypass.

Increment tests:17 PASS including Git/environment rejection, immutable candidate authorization, TEST metadata, malformed NSIS/CRC and actual 7zip streaming roundtrip. Tray TypeScript PASS, actual electron-builder configuration schema PASS, root-directory `--check` PASS. No new source/package dependency. Compiler configuration now resolves its explicit tsconfig path independent of invocation cwd. Existing full Tray243PASS/one conditional smoke and Next/browser evidence above predate this build-only increment; they are not newly executed full-suite claims.

The final candidate scope is31 exact paths: the previously reviewed29 plus the exact commercial branch Preview exclusion and its regression. Candidate builder/profile/test and this evidence record received the bounded increment; original Window/main, cashier core and shared print core are unchanged. Dedicated source/grant hashes are recorded outside this self-referential source record once bytes stabilize. Independent incremental review must close all findings before governance commit or executable build; native installation and paper evidence are separate gates.

Planned product version 0.1.0, independent Electron runtime 44.3.0 (not a modification of Desktop's runtime). Current `--release` deliberately refuses because the real signer and trusted final release manifest integration are not configured; this is NOT READY, not a completed commercial build. Do not weaken that guard or distribute an unsigned JS bundle as an installer. Published artifact must have legitimate Authenticode verification, exact final source/manifest/SHA-256, and accurate distribution links.

Original Desktop0.4.7 artifact matching historical SHA `491183f2c65852af808107c1439b72591112aa14df6e24852977db6912abefa5` is AVAILABLE. The September9 follow-up corrected the earlier incomplete search: `/Users/jason/Desktop/E-Shop-DianXiaoEr-Setup-0.4.7-x64.exe`, `/Users/jason/Desktop/E-shop安装包/E-Shop-DianXiaoEr-Setup-0.4.7-x64.exe` and `/Users/jason/Desktop/x新的/E-Shop-DianXiaoEr-Setup-0.4.7-x64.exe` each measure82,577,944bytes and match the full SHA and each other's bytes. The Desktop `E-Shop-V1-Setup-MVP-064266f.zip` also contains matching original bytes. None was rebuilt, renamed or modified. The August6 audit names an old missing temporary build directory, overwritten canonical dist and the matching Desktop copy; the September7 Phase0 audit confirms three originals but does not name all three paths. Do not invent that historical path mapping. Phase0 also records matching original ASAR/source24files at Desktop runtime commit `aef8309e91808ac85c51b207a0f1b7a382ee890f`; absent historical release manifest/CI attestation remains a distinct documented limitation, not a missing-artifact claim.

Existing signing metadata inventory found no immediately usable signer: V727 CurrentUser/My and LocalMachine/My code-signing certificates0; relevant signing tools/environment names absent; Mac valid code-signing identities0. This does not prove that no other account/offline device has a signer. No private keys/passwords were read. Publisher legal identity/registered jurisdiction and a legitimate signing route remain required; no purchase, new resource or certificate is authorized implicitly.

Continue signed-release-independent TEST candidate validation under the explicit renewed Founder authority. Formal `--release` remains closed. The commercial branch now adds only its exact name to `vercel.json` deployment exclusions, with an exact-object regression test; main and unrelated branches are unchanged. Before any push this must be included in trusted exact authorization and verified. Project-wide Preview/Production database isolation is NOT established; no manual Preview is permitted. Finish final signed-release wiring only after the actual signer route is known, review and authorize those final bytes separately. TEST candidates must remain visibly unsigned/unpublished, retain truthful baseline/source snapshot and source/output hash gates, and must not be represented as commercial releases.

Field gates: clean supported Windows with the two real installers and no developer residue; first binding/setup and installed runtime; a different LAN's discovery/manual fallback/selection/TEST; Production two-mode real paper; login autostart, ordinary restart, upgrade/uninstall/reinstall and journal retention. Coordinate physical actions with Founder. No new hardware test or paper output is recorded for this draft. Formal install/release distribution remains NOT READY.
