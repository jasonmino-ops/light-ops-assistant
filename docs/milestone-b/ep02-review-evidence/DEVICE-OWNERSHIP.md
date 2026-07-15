# EP-MB2-02 Device Ownership

## Ownership Model

Device Ownership is bound to:

- physical device id;
- provider id;
- provider instance id;
- ownership state.

## Ownership States

- `VALID`
- `STALE_PROVIDER`
- `INVALIDATED`
- `UNKNOWN`

## Stale Provider Behavior

When the provider instance is invalidated:

- device registration becomes stale;
- assigned devices become `AWAITING_REBIND`;
- ownership becomes `STALE_PROVIDER`;
- health view is marked stale.

Command eligibility reports `STALE_PROVIDER_INSTANCE` before unassigned state can mask ownership staleness.
