# ES-DESKTOP-UX-01 / P4-1 Minimal Boundary Decision

## Decision

Implement a Web-only startup boundary around the existing `/desktop/pos` entry. Keep the existing Cashier page and Desktop Shell unchanged. The boundary selects an operating principal before Desktop business requests use the existing authorization path:

```text
Desktop startup
  → existing store / POS device restore
  → explicit OWNER or current active OWNER/STAFF account choice
  → existing Cashier
```

The default Desktop principal remains the authorized device and its legacy active OWNER fallback. A signed-in account is used only after an explicit choice. This prevents an existing ACCOUNT cookie from silently replacing the Desktop device principal.

## Reuse and limits

- `UserStoreRole` is the source of active store role validation.
- Existing POS authorization continues to produce `operatorUserId`; no second attribution framework is added.
- The current authenticated account is the only low-cost precise operator choice. There is no employee directory, independent PIN, PIN persistence, or new credential framework in this slice.
- `transactionActorType` / `transactionActorId` remain unchanged because their recorded meaning is device-audit compatibility, not Operator identity.
- Browser `/cashier` does not send the Desktop boundary marker and keeps current account behavior.

## Safety behavior

- The boundary is shown only for online Desktop startup. Offline operation falls through to the existing offline CASH path.
- The MVP has no in-session Switch button. That is deliberate: no code can switch while a cart is incomplete, and no cart handover or reassignment is introduced.
- A later P4-1B may add exact per-employee verification only if it remains small and receives its own gate.

## Rollback

`DESKTOP_OPERATOR_BOUNDARY_ENABLED=0` is the server-side kill switch. When disabled, the server ignores the Desktop boundary marker and uses the pre-P4-1 authorization order. No feature-flag table or migration is introduced.

## Delivery classification

`WEB` only. No `desktop/src/**` file is in the implementation plan, so no new Desktop installer is required by this change. No schema or migration is planned.
