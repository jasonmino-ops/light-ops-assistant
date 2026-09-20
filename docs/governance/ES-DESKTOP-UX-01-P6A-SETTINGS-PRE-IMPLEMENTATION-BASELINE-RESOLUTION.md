# ES-DESKTOP-UX-01 / P6A Settings
## Pre-Implementation Baseline Resolution

**Record type:** governance-only baseline evidence
**Product implementation:** not performed
**Date:** 2026-09-20

## 1. Review disposition

- Codex Pre-Development Audit: direction accepted.
- Independent Review verdict: **PASS WITH CORRECTIONS**.
- Founder Decisions D1–D5: accepted and frozen below.
- Implementation Authorization: **not granted by this record**.

## 2. Accepted corrections C-1–C-12

The accepted corrections are normalized here as durable boundary decisions:

1. C-1: refresh authoritative `origin/main` before implementation.
2. C-2: obtain the current Production deployment SHA from authoritative Vercel metadata.
3. C-3: run the repository Release Lineage Gate from a clean worktree.
4. C-4: preserve durable governance evidence instead of relying on session-only review text.
5. C-5: establish `/settings` as the sole canonical Settings ownership surface.
6. C-6: retain Dashboard/Cashier legacy settings UI during P6A; cleanup is a separate task.
7. C-7: define `cashier:autoPrint` as a Desktop-only device preference and keep it distinct from network printing.
8. C-8: define Settings language as the current operator Web UI/device preference; do not alter Customer Display language contracts.
9. C-9: keep Display Settings Desktop-only and read-only/entry-only; add no display IPC or assignment implementation.
10. C-10: make the complete Settings Center OWNER-only while retaining real backend authorization.
11. C-11: keep KHQR editing and RC10 printer endpoint editing outside P6A.
12. C-12: make Management Center navigate to canonical Settings without changing protected product surfaces.

## 3. Accepted risks R-1–R-7

1. R-1: stale remote baseline; resolved by successful fetch and ref verification.
2. R-2: unknown Production SHA; resolved by authoritative Vercel deployment metadata.
3. R-3: Production/main lineage divergence; checked by the Release Lineage Gate.
4. R-4: legacy UI remains physically present; accepted as a separate cleanup task under D1.
5. R-5: Browser receipt print, QZ, and RC10 Network Printing could be conflated; prevented by D2 and the frozen printing boundary.
6. R-6: language, display, and STAFF visibility could exceed P6A; bounded by D3–D5.
7. R-7: forbidden-path or scope creep could force an exception; minimum P6A scope is checked against `gate-config.json` and requires no exception.

## 4. Founder Decisions D1–D5

### D1 — Canonical ownership and legacy UI

`/settings` is the canonical Settings Center. P6A does not modify or delete Dashboard/Cashier legacy settings UI. Canonical ownership does not require physical legacy cleanup in this phase.

### D2 — autoPrint

`cashier:autoPrint` is a Desktop-only device preference, effective in `/desktop/pos`. P6A reuses the existing key and execution chain, does not modify Cashier, and does not describe it as network printing. Browser receipt printing, QZ, and RC10 Network Printing remain separate concepts.

### D3 — Language

Settings Language controls the current operator Web UI/device preference through the existing `LangProvider` and `localStorage['lang']`. Customer Display, Desktop launch `?lang=`, IPC, and display runtime contracts are unchanged. No Store language schema is added.

### D4 — Display Settings

No reusable Web Display Settings surface or display assignment/swap/redetect IPC is currently available. P6A may show only a Desktop read-only explanation or existing safe entry. Browser renders no Display Settings block. No Electron, IPC, preload, WindowManager, or assignment implementation is added.

### D5 — STAFF

The complete `/settings` Center is OWNER-only. STAFF retains existing local/operator preferences. No IAM, ACL, or policy engine is added. Real session and backend OWNER authorization remain the security boundary.

## 5. Frozen implementation boundary

```text
Web UI Only       = YES
New API           = NO
Schema            = NO
Migration         = NO
Electron          = NO
New IPC           = NO
Printing Core     = NO
Runtime           = NO
Scope Exception   = NO
```

Expected future implementation surface is limited to a new `app/settings/page.tsx`, Settings tests/browser regression, `app/management/page.tsx`, and non-protected Settings resources/components as necessary. It must not modify Dashboard, Cashier, API, Prisma, middleware, Desktop, Electron, e-shop-tray, relay, or printing paths.

## 6. Baseline evidence

| Check | Result |
|---|---|
| Fetch | PASS; successful `git fetch origin --prune` from clean `/Users/jason/worktrees/ep-br-cd-01-main-freeze` |
| Authoritative `origin/main` | `fad5e514381358fa57fa135e66f517f2da5b4b8f` |
| Previous audited main SHA | `fad5e514381358fa57fa135e66f517f2da5b4b8f` |
| Current Production deployment | `dpl_AGD3gpuBFX7EnhnVtDXVqWcg6757` |
| Current Production Product SHA | `e463e8c34c73a0dedfa8c1bfc9cee5f9f634085a` |
| Production state | `READY` |
| Production ancestor of `origin/main` | `YES` |
| Working tree used for lineage | `CLEAN` |
| Release Lineage Gate | `PASS` |
| Minimum P6A forbidden path required | `NO` |
| Scope Exception | `NO` |

## 7. Status

This record is governance evidence only. It does not authorize implementation, merge, push, deployment, migration, FIELD, P6B, P6C, P7, or P8.

**Result:** READY FOR IMPLEMENTATION AUTHORIZATION, pending a separate explicit implementation authorization.
