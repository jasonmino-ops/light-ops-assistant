# Dev-Gate / ES-PRINT-DUAL-CHANNEL-01 A12.2 Launch-Page Exact-Path Exception

## Status

| Item | Value |
| --- | --- |
| Service task | `ES-PRINT-DUAL-CHANNEL-01` |
| Feature | A12.2 Desktop 0.4.7 Official Launch Route Compatibility |
| Feature branch | `codex/es-print-desktop-launch-route-compat-v01` |
| Approved base | `b8f15951e4e727b1c926536eedd9f9bcf1c3e310` |
| Authorization ID | `A12.2-DESKTOP-POS-LAUNCH-PAGE` |
| Exception status | `ACTIVE` |
| Lifecycle | Close after feature merge |

`ACTIVE` in a governance branch grants no authority. The authorization becomes usable only after the byte-identical record and exact default-deny rule are present in trusted `origin/main`.

## Reason and exact scope

V727 field evidence established this failing Desktop 0.4.7 path:

`/cashier/launch#ticket=<one-time-ticket>` → launch consume `200` → cashier access `200` → `/cashier`

The delegated BrowserPosDevice session and ComputerBinding are valid, but `/cashier` does not enter the A11.4 `/desktop/pos` device context. Consequently the Desktop runtime sends neither `GET /api/es-tray-02/device/config` nor `GET /api/es-tray-02/device/orders/[orderNo]`, and the sales-record order-detail flow reports that loading failed.

This authorization is not a new POS feature. It permits only the reviewed navigation compatibility change after a successful launch consume:

`/desktop/pos?storeCode=<server-validated-storeCode>&mode=pos`

The only authorized path is:

`app/cashier/launch/page.tsx`

The approved post-change content SHA-256 is:

`1589fe6b8c7131cebecd9143a77b8e61eb76e0290e42f0bb94ecdd9aeb923901`

The approved content retains launch-ticket consumption and delegated-session persistence, derives `storeCode` only from the successful consume response, sets `mode=pos`, and changes no authentication or authorization boundary.

## Default deny and pre-commit contract

`app/cashier/launch/page.tsx` is added as one exact `forbidden_paths.absolute` entry. This is necessary so the existing Guard performs the approved-content hash check; no directory or wildcard rule is added.

The existing `PRE_COMMIT_CONTENT_SHA256` mechanism requires all of the following:

- `--task-id` is exactly `ES-PRINT-DUAL-CHANNEL-01`;
- the actual Git branch is exactly `codex/es-print-desktop-launch-route-compat-v01`;
- the authorization is Founder-approved and `ACTIVE`;
- the approved base is an ancestor of trusted `origin/main` and the feature `HEAD`;
- the path is the one canonical exact path above;
- current file content matches the approved SHA-256;
- working exception and `gate-config.json` are byte-identical to trusted `origin/main` blobs.

Missing, closed, malformed, wrong-task, wrong-branch, wrong-lineage, sibling-path, wildcard, tampered-record, or content-hash-mismatch cases fail closed.

## Isolation from existing authorizations

This grant is additive and branch-specific. It does not change the primary exact Prisma authorization or the A11.2 `app/cashier/page.tsx` authorization. The two Cashier-related authorizations remain distinct: neither `app/cashier/**` nor `app/**` is authorized.

## Activation and closure

After this governance-only change is separately reviewed and merged, the A12.2 feature line must incorporate the trusted `origin/main` governance baseline. Only then may it create the exact approved content and run the real Scope Guard with `--task-id ES-PRINT-DUAL-CHANNEL-01`.

After the A12.2 feature is merged and its required Production/FIELD verification is complete, a separate governance closure must set this authorization to `CLOSED` and record the feature merge commit. The record remains as audit evidence, but the closed authorization must not permit future changes.

This exception does not authorize a main merge, Production deployment, device print API changes, other Cashier changes, Tray, Printer, Prisma, migration, Installer, or NP330 changes.
