# Simulator Boundary Evidence

- TEST / DEVELOPMENT ONLY: stated in simulator source comment.
- NOT A PRODUCTION PROVIDER: stated in simulator source comment.
- `package.json` exists: yes.
- `private: true`: yes.
- Depends on `@eshop/hrt-contract`: yes.
- Does not depend on Desktop private implementation: PASS.
- Does not contain real hardware code: PASS.
- Does not contain Named Pipe implementation: PASS.
- Does not spawn a process: PASS.
- Does not copy Contract types: it imports from Contract SoT.

## Scenarios

- registration
- handshake
- duplicate registration
- restart
- disconnect
- shutdown
- success command
- unknown/uncertain command
- disconnect during command
- timeout uncertain
- scanner event duplicate/stale/wrong scope
- display snapshot scope/expiry/sequence/reconnect
- health snapshot
- diagnostic payload

Tests: `tests/hrt-contract.test.ts`, `desktop/tests/provider-runtime.test.ts`.
