# Dev-Gate / ES-PRINT-DUAL-CHANNEL-01 A11.2 Exact-Path Exception

## Status

| Item | Value |
| --- | --- |
| Service task | `ES-PRINT-DUAL-CHANNEL-01` |
| Feature | A11.2 Desktop POS GUI Entry Compatibility |
| Feature branch | `codex/es-print-desktop-pos-relay-entry-v01` |
| Approved base | `414a1c33e9907b57e7a47e43ff758738b64c0f51` |
| Authorization ID | `A11.2-DESKTOP-POS-CASHIER-PAGE` |
| Exception status | `ACTIVE` |
| Lifecycle | Close after feature merge |

`ACTIVE` in a governance branch does not grant authority. The authorization becomes usable only after the byte-identical record and Guard implementation are present in trusted `origin/main`.

## Reason and exact scope

V727 field evidence established that the real Desktop 0.4.7 runtime path is:

`/desktop/pos` → `CashierPage` → `desktopRecordsOpen` → `OrderDetailSheet`

A11.2 therefore needs one minimal connection in `app/cashier/page.tsx` so the existing `OrderDetailSheet` Relay client is reached by the actual Desktop POS entry. This is compatibility wiring, not authorization for a new Cashier capability.

The only authorized path is:

`app/cashier/page.tsx`

The approved content SHA-256 is:

`9d1c8aaa8c0ac919dbc75dc18ee9668f3f81f315da46650862a0d14ee2c536b3`

No directory, prefix, sibling path, or wildcard is authorized. `app/cashier/other.tsx`, other forbidden paths, and content that does not match the approved hash remain blocked. The already-allowed test file receives no exception.

## Pre-commit authorization contract

The A11.2 draft existed before its feature commit, so this grant uses the existing trusted exception controls with the restricted `PRE_COMMIT_CONTENT_SHA256` lineage mode. It does not skip lineage validation.

The Guard requires all of the following:

- the task ID supplied to the Guard is exactly `ES-PRINT-DUAL-CHANNEL-01`;
- the actual Git branch is exactly `codex/es-print-desktop-pos-relay-entry-v01`;
- the grant status is `ACTIVE` and Founder-approved;
- the approved base is an ancestor of both trusted `origin/main` and the feature `HEAD`;
- the requested path is the one canonical exact path in the grant;
- the current file content matches the approved SHA-256;
- the working exception record and `gate-config.json` are byte-identical to their trusted `origin/main` blobs.

Absent, malformed, closed, tampered, wrong-task, wrong-branch, wrong-lineage, wrong-path, wildcard, or hash-mismatched grants fail closed.

## Existing Prisma authorization

The original Production Relay V0.1 authorization remains the primary grant in the same task record. Its branch, authorized commits, exact Prisma paths, hashes, status, and approval metadata are unchanged. The A11.2 grant is additive and branch-specific; it cannot authorize either Prisma path, and the primary grant cannot authorize the Cashier path.

## Activation and closure

After the governance-only change is separately reviewed and merged, the A11.2 feature line must incorporate the trusted `origin/main` governance baseline and run the real Scope Guard with `--task-id ES-PRINT-DUAL-CHANNEL-01`. The approved file must retain the exact content hash before and after its feature commit.

After the A11.2 feature is merged and its required Production/FIELD verification is complete, a separate governance closure must set this authorization to `CLOSED` and record the feature merge commit. The audit record remains, but the closed grant must not authorize future changes.

This exception does not authorize a main merge, Production deployment, further Cashier changes, Printer or Tray changes, Prisma changes, migration changes, or any wildcard expansion.
