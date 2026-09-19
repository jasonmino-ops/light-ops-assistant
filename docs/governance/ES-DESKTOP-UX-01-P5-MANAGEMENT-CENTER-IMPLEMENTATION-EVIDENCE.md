# ES-DESKTOP-UX-01 / P5 Management Center

## Implementation evidence record

This record captures the Founder-authorized P5 first slice. It is additive evidence and does not modify the frozen Blueprint, Roadmap, Freeze Record, or any prior authorization record.

### Authorization and baseline

- Founder authorization: `P5 IMPLEMENTATION AUTHORIZED = YES`.
- Founder UX Addendum: applies; Management Center is a navigation hub, reuse means linking to existing capability, and user complexity must not increase.
- Risk: `L2`.
- Delivery class: Web UI only.
- Production SHA observed: `fa7c005bbefbf4350c4b4b03c85c6403a78370f9`.
- Authoritative development base: `origin/main` at `b08506233aec40b4e6e52aa9feab77a6087489e1`.
- Release Lineage Gate: `PASS` — Production is an ancestor of `origin/main`; baseline worktree was clean.
- Development branch: `codex/es-desktop-ux-01-p5-management-center`.

### Implemented scope

- Added `/management` as a low-density Management Hub with five business groups.
- Added the `/home` entry to `/management`.
- Reused existing routes by navigation only; no business data or state is copied into the hub.
- Used the existing `effectiveRole` only for UI visibility. Existing backend authorization remains unchanged.
- Kept unfinished, technical, low-frequency, and future-phase capabilities hidden rather than fabricating placeholder status.
- Added localized copy for Chinese, English, and Khmer.

### Explicit non-scope check

- No changes to `app/cashier/page.tsx`, `app/desktop/pos/page.tsx`, `middleware.ts`, APIs, schema, migrations, Electron, IPC, printing, runtime, or IAM/ACL.
- No P6, P7, or P8 capability was implemented.

### Validation status

- `node tests/management-center-static.test.cjs`: PASS.
- `git diff --check`: PASS.
- `npm run build`: PASS with `DATABASE_URL` supplied for local Prisma Client generation; the new `/management` route compiled and was emitted.
- Local OWNER browser smoke: PASS — `/home` links to `/management`; all five groups and existing owner entries render.
- Local STAFF browser smoke: PASS — business/support entries render and owner-only entries are hidden. This uses local `DEV_ROLE=STAFF`, not a real production STAFF session.
- Real STAFF session smoke: pending environment-backed execution.
- `npm run test:core`: BLOCKED before collection by the repository runner's active known-failure metadata (`KTF-20260912-01` has no machine-checkable failure-shape fingerprint); no core tests were collected.
- Independent review, including the 10-item UX Complexity Check from the Founder UX Addendum: PASS. The review verified the dashboard/system/technical entries were hidden, POS entry was consolidated, and no duplicate business logic or false status was introduced.
- Scope Guard: PASS on the explicit seven-file implementation set.
- Browser/Desktop consistency: source-level PASS; live real-session evidence remains unavailable.
- FIELD VERIFIED: not required and not claimed.
- Production deploy, main merge, migration, and CLOSED: not performed or claimed.
