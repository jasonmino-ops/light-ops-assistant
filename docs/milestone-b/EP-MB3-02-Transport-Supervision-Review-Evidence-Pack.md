# EP-MB3-02 Transport & Supervision Review Evidence Pack

## Result

- Status: READY FOR INDEPENDENT REVIEW
- Reason: Provider Windows CI passed, and Desktop cross-repository Windows CI passed after closing the private Provider repository checkout authentication gap.
- Authentication closure: Desktop workflow uses repository secret `EP_MB3_PROVIDER_REPO_TOKEN` only in the `actions/checkout@v4` step for `jasonmino-ops/eshop-windows-provider`, with `persist-credentials: false`.

## Repositories

### Desktop Repository

- Path: `/Users/jason/light-ops-assistant`
- Remote: `git@github.com:jasonmino-ops/light-ops-assistant.git`
- Branch: `feat/ep-mb3-02-desktop-provider-supervision`
- Baseline commit: `540e0d15408bbb27bb03cc55275fb7f43245c38a`
- Baseline tag: `mb-2-runtime-core-v1.0-final`
- Implementation commits:
  - `4523222` - `feat: supervise windows provider transport`
  - `4bc13b9` - `ci: pin provider transport artifact source`
  - `6e9e97d` - `ci: use provider repo token for pinned checkout`
  - `e20f307` - `ci: validate electron provider smoke output`
  - `3a3e9f8` - `ci: capture electron provider smoke log`

### Provider Repository

- Path: `/Users/jason/eshop-windows-provider`
- Remote: `git@github.com:jasonmino-ops/eshop-windows-provider.git`
- Branch: `feat/ep-mb3-02-named-pipe-transport`
- Baseline commit: `68a9d63fc5285fdf1e4f4fe892a1fca1015bbed7`
- Baseline tag: `ep-mb3-01-windows-provider-bootstrap-v1.0-final`
- Implementation commits:
  - `2511c234e527055542bfdd3a70b0112ab60b5e49` - `feat: add named pipe transport supervision bridge`
  - `a3c6e55688b7c0ec693568d6000c687d6aa29114` - `test: stabilize named pipe server reads`
  - `7785be145d5259991038d17839d322e2694e338c` - `docs: add ep-mb3-02 provider transport evidence`

## Checkout Authentication Model

- Secret name: `EP_MB3_PROVIDER_REPO_TOKEN`
- Secret value recorded: no
- Token scope: read-only Contents for `jasonmino-ops/eshop-windows-provider`
- Token usage: only `actions/checkout@v4` for the private Provider repository
- Checkout repository: `jasonmino-ops/eshop-windows-provider`
- Checkout ref: `7785be145d5259991038d17839d322e2694e338c`
- Checkout path: `ep-mb3-provider`
- `persist-credentials`: `false`
- Floating ref used: no
- Token passed to Provider process/tests/artifact/build scripts: no

## Architecture Implemented

- Process model: Desktop main process owns Provider lifecycle via `child_process.spawn`, `detached: false`, `windowsHide: true`.
- Runtime portability: Provider launches through `process.execPath` with `ELECTRON_RUN_AS_NODE=1`; dev overrides use `ESHOP_WINDOWS_PROVIDER_ENTRY` / `ESHOP_WINDOWS_PROVIDER_DIR`; packaged path is `process.resourcesPath/eshop-windows-provider/dist/index.js`.
- Packaging: `desktop/electron-builder.yml` uses `extraResources`, not ASAR, to stage `eshop-windows-provider`.
- Transport: length-prefixed 4-byte unsigned little-endian frames with JSON envelopes, 64 KiB max.
- Named Pipe roles: Provider is server; Desktop is client; single-client enforcement is implemented Provider-side.
- Security: supervisor token is generated per Provider start, passed by child env, required on transport envelope, and redacted by existing logger rules. Pipe name hashes are logged, not full tokens.
- Compatibility: formal external Provider ID is `windows-provider`; simulator remains in Runtime Core tests. Frozen contract package was not modified.
- Health: Desktop runtime health now records Provider runtime state, PID, provider ID/instance ID, pipe hash, restart attempt, and last error.
- Scope guard: no Printer Executor, GDI, Raw ESC/POS, sales printing, printer config, scanner, customer display executor, Windows Service, or Runtime Core contract change was implemented.

## Local Verification

### Provider

- `npm run type-check`: PASS
- `npm test`: PASS, 21 passed, 5 non-Windows pipe-server tests skipped locally; Windows CI runs them.
- `npm run build`: PASS
- `npm run package`: PASS
- `npm run smoke`: PASS

### Desktop

- `npm run typecheck`: PASS
- `npm test`: PASS, 104 passed
- `npm run compile`: PASS
- `npm run pack:dir`: PASS after network-enabled Electron runtime download
- Packaged resource check: PASS, `release/mac-arm64/E-Shop Desktop.app/Contents/Resources/eshop-windows-provider/dist/index.js` exists

### Cross-Repository Local Integration

- Harness: Desktop compiled supervisor launched `/Users/jason/eshop-windows-provider/dist/index.js`
- Result: PASS
- Observed state: Provider runtime reached `ok`
- Verified:
  - process started
  - pipe connected
  - handshake accepted
  - provider registered as `windows-provider`
  - health returned READY
  - Desktop stop closed Provider

## CI Evidence

### Provider Windows CI

- Workflow: `.github/workflows/windows-provider-ci.yml`
- Run ID: `29437701169`
- Run URL: `https://github.com/jasonmino-ops/eshop-windows-provider/actions/runs/29437701169`
- Commit: `a3c6e55688b7c0ec693568d6000c687d6aa29114`
- Status: PASS
- Artifact: `eshop-windows-provider-bootstrap`
- Artifact ID: `8352092291`
- Artifact digest: `sha256:693b80ea29c417ea8f60b281f4ddfb9dad640b07b96ec6f255dcde0c5e652853`

### Desktop Windows CI

- Workflow: `.github/workflows/desktop-windows-build.yml`
- Run ID: `29438925764`
- Run URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29438925764`
- Job URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29438925764/job/87432558036`
- Commit: `3a3e9f8`
- Windows runner: `windows-latest`
- Status: PASS
- Duration: `2m 17s`
- Provider exact consumed commit: `7785be145d5259991038d17839d322e2694e338c`
- Checkout Desktop: PASS
- Checkout exact Provider commit: PASS
- Verify exact Provider commit: PASS
- Contract dependencies/install/build: PASS
- Desktop dependencies install: PASS
- Desktop type-check: PASS
- Desktop tests: PASS
- Desktop compile: PASS
- Provider dependencies install: PASS
- Provider build/package: PASS
- Windows Named Pipe integration: PASS
- Handshake: PASS
- Health: PASS
- Crash detection / process exit detection: covered by supervisor integration and no-orphan gate; PASS for CI scope
- Bounded restart: covered by supervisor tests and CI integration smoke; PASS for CI scope
- Graceful shutdown: PASS
- Forced kill fallback: no orphan process proof PASS
- Path with spaces: PASS
- Electron runtime launch without system Node: PASS via Electron executable with `ELECTRON_RUN_AS_NODE=1`
- Packaged resources smoke: PASS, `release/win-unpacked/resources/eshop-windows-provider/dist/index.js` verified
- No surviving Provider process: PASS
- Installer/build artifact: PASS
- Artifact upload: PASS
- Artifact: `eshop-desktop-windows-installer`
- Artifact ID: `8352623393`
- Artifact digest: `sha256:71e13f25babacc9570316972eb319e5a6baecfe24034e03777c5ae605d93c9ef`

## Gate Self-Check

- Frozen Contract unchanged: PASS
- Provider formal ID `windows-provider`: PASS
- Length-prefixed framing: PASS
- Fragmented/multiple frame tests: PASS
- Token mismatch rejection: PASS in Provider tests
- Health round trip: PASS locally and in Provider transport design
- Desktop starts Provider: PASS locally
- Electron runtime launch: PASS locally through `pack:dir`; PASS in Windows CI via Electron executable and `ELECTRON_RUN_AS_NODE=1`
- Electron runtime launch: PASS in Windows CI
- Desktop Windows CI: PASS
- Cross-repo Windows integration: PASS
- Artifact upload: Provider PASS; Desktop PASS

## Known Limitations

- Windows ACL hardening is not claimed. This package uses session-scoped pipe names, single-client enforcement, and a per-start supervisor token as the minimum EP-MB3-02 boundary.
- Desktop cross-repo CI depends on repository secret `EP_MB3_PROVIDER_REPO_TOKEN`; the secret value is not logged or persisted by checkout.

## Readiness

- Gate met: YES
- Blocker: none known
- Independent review status: READY FOR INDEPENDENT REVIEW
