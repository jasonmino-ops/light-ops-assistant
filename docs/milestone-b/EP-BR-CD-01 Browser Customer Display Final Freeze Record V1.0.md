# EP-BR-CD-01 Browser Customer Display Final Freeze Record V1.0

## Document Identity

- Engineering Package: `EP-BR-CD-01 — Browser Customer Display Persistent Payment & Customer Entry Panel V1`
- Freeze Status: `FINAL FROZEN`
- Freeze Date: `2026-07-21`
- Repository: `jasonmino-ops/light-ops-assistant`
- Acceptance Commit: `8a63bc4d694531c1e97e0cd4b74c804dfbc3aa9f`
- Merge Commit: `1ae1ee865b76ad9de1aa1565adca674ecb23a117`
- Final Main Commit: assigned by this Freeze Record commit and reported in the final execution record.
- Tag: `ep-br-cd-01-browser-customer-display-v1.0-final`

## Acceptance And Merge

- Acceptance Record: `docs/milestone-b/EP-BR-CD-01 Browser Customer Display Acceptance Record V1.0.md`
- Acceptance Decision: `ACCEPTED`
- Merge Strategy: non-squash `--no-ff`, preserving the reviewed implementation history.
- Main baseline before merge: `15dad1aae9972046258857985469ce13e51349e6`
- Merge result: `1ae1ee865b76ad9de1aa1565adca674ecb23a117`

## Main Verification

- Execution environment: isolated main worktree `/Users/jason/worktrees/ep-br-cd-01-main-freeze`.
- Dependency environment: temporary `node_modules` symlink to the lockfile-identical acceptance worktree was used only for validation, then removed before commit and push.
- EP test suite: `PASS`.
- TypeScript: `npx tsc --noEmit --incremental false` — `PASS`.
- Production build: `npm run build` — `PASS`.
- Formal GitHub Actions CI: `cloud-ci` — `success`.
- CI Run ID: `29845615429`.
- CI URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29845615429`.
- CI Head SHA: `1ae1ee865b76ad9de1aa1565adca674ecb23a117`.

Raw feature-branch acceptance logs are retained at:

- `docs/milestone-b/evidence/ep-br-cd-01-final-validation/tests.stdout-stderr.log`
- `docs/milestone-b/evidence/ep-br-cd-01-final-validation/typescript.stdout-stderr.log`
- `docs/milestone-b/evidence/ep-br-cd-01-final-validation/build.stdout-stderr.log`

## Frozen Scope

- Persistent three-column browser customer display.
- Customer H5 QR only in the left panel; it shares the invitation page public entry rule.
- Static store-level KHQR only in the right payment panel.
- ORDER/CASH/KHQR and terminal-state display behavior, including B1 old-order clearing.
- The approved `session/current` read-model exception for active-order `storeKhqrImageUrl` availability.
- Cashier inline-style shorthand warning fixes only.
- Related tests, evidence, Acceptance Record and this Freeze Record.

## Boundary Integrity

- Prisma schema / migration: unchanged.
- Payment model, transaction semantics and POS business logic: unchanged.
- Dynamic KHQR: not implemented.
- BroadcastChannel / realtime protocol: unchanged.
- Printing chain, Desktop Runtime, Windows Provider, installation package and activation system: unchanged.
- Next.js version: unchanged.
- No advertisement carousel, store logo feature, completed-state H5 enlargement or responsive-system rewrite was added.

## Deferred Items

- Public URL environment-variable governance.
- `findKhqrConfig` TTL and error isolation.
- Expanded responsive breakpoints.
- Advertisement carousel, store logo and completed-state H5 emphasis.
- Dynamic KHQR and Windows visual-polish follow-up.

## Rollback Anchor

- Code rollback anchor before this EP merge: `15dad1aae9972046258857985469ce13e51349e6`.
- Accepted merge anchor: `1ae1ee865b76ad9de1aa1565adca674ecb23a117`.
- Final release anchor: annotated tag `ep-br-cd-01-browser-customer-display-v1.0-final` targeting the final Freeze Record commit.

## Final Decision

- Merge Verification: `PASS`
- Main CI: `PASS`
- Freeze Preconditions: `SATISFIED`
- Final Freeze Decision: `FINAL FROZEN`
