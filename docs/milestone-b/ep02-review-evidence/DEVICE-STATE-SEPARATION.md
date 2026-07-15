# EP-MB2-02 Device State Separation

No combined `DeviceState` abstraction was introduced.

## Registration

Registration state is tracked as:

- `UNKNOWN`
- `DISCOVERED`
- `REGISTERED`
- `STALE`
- `REMOVED`

## Assignment

Assignment state is tracked as:

- `UNASSIGNED`
- `ASSIGNED`
- `INVALID`
- `AWAITING_REBIND`

## Ownership

Ownership state is tracked as:

- `VALID`
- `STALE_PROVIDER`
- `INVALIDATED`
- `UNKNOWN`

## Health

Health is tracked as:

- `healthState`
- `healthView`

The dimensions are coordinated by Device Runtime but remain independently visible in Registry.
