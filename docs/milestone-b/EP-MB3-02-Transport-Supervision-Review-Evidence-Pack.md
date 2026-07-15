# EP-MB3-02 Transport & Supervision Review Evidence Pack

## Result

- Status: NOT READY
- Reason: Provider Windows CI passed, but Desktop Windows CI is blocked by cross-private-repository checkout permissions for `jasonmino-ops/eshop-windows-provider`.
- Desktop CI blocker: `actions/checkout` cannot read the private Provider repo with the default `GITHUB_TOKEN`; run `29437728773` fails with `repository 'https://github.com/jasonmino-ops/eshop-windows-provider/' not found`.

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

### Provider Repository

- Path: `/Users/jason/eshop-windows-provider`
- Remote: `git@github.com:jasonmino-ops/eshop-windows-provider.git`
- Branch: `feat/ep-mb3-02-named-pipe-transport`
- Baseline commit: `68a9d63fc5285fdf1e4f4fe892a1fca1015bbed7`
- Baseline tag: `ep-mb3-01-windows-provider-bootstrap-v1.0-final`
- Implementation commits:
  - `2511c234e527055542bfdd3a70b0112ab60b5e49` - `feat: add named pipe transport supervision bridge`
  - `a3c6e55688b7c0ec693568d6000c687d6aa29114` - `test: stabilize named pipe server reads`

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
- Artifact digest: `sha256:693b80ea29c417ea8f60b281f4ddfb9dad640b07b96ec6f255dcde0c5e652853`

### Desktop Windows CI

- Workflow: `.github/workflows/desktop-windows-build.yml`
- Run ID: `29437728773`
- Run URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29437728773`
- Commit: `4bc13b9`
- Status: FAIL
- Failure: cross-private-repository checkout blocked before build/test integration could run.
- Required closure: configure `EP_MB3_PROVIDER_REPO_TOKEN` in `light-ops-assistant` repository secrets with read access to `jasonmino-ops/eshop-windows-provider`, or otherwise grant the workflow token read access to the Provider repository.

## Gate Self-Check

- Frozen Contract unchanged: PASS
- Provider formal ID `windows-provider`: PASS
- Length-prefixed framing: PASS
- Fragmented/multiple frame tests: PASS
- Token mismatch rejection: PASS in Provider tests
- Health round trip: PASS locally and in Provider transport design
- Desktop starts Provider: PASS locally
- Electron runtime launch: PASS locally through `pack:dir`; Windows CI blocked before smoke
- Desktop Windows CI: FAIL
- Cross-repo Windows integration: NOT RUN due checkout permission failure
- Artifact upload: Provider PASS; Desktop installer artifact not produced

## Known Limitations

- Windows ACL hardening is not claimed. This package uses session-scoped pipe names, single-client enforcement, and a per-start supervisor token as the minimum EP-MB3-02 boundary.
- Desktop restart/forced-kill behavior is partially implemented at supervisor state level but lacks complete Windows CI proof because Desktop CI is blocked before integration.
- Desktop cross-repo CI requires a repository secret or access-policy change; this is an external GitHub permissions closure, not a runtime code blocker.

## Readiness

- Gate met: NO
- Blocker: Desktop Windows CI cannot access the private Provider repository.
- Independent review status: NOT READY
