# EP-MB2-02 Device Assignment

## Assignment Runtime

Assignment Runtime assigns one physical device to one slot reference.

## Accepted Path

Assignment is accepted when:

- slot reference exists;
- physical device exists;
- device kind matches slot expected kind;
- device capabilities satisfy slot required capabilities;
- device ownership is valid for the active provider instance;
- scope matches.

## Rejection Codes

- `UNKNOWN_SLOT`
- `UNKNOWN_DEVICE`
- `KIND_MISMATCH`
- `CAPABILITY_MISMATCH`
- `STALE_PROVIDER_INSTANCE`
- `CONFLICTING_ASSIGNMENT`
- `INVALID_SCOPE`

## Conflict Rules

The same slot cannot be assigned to a different physical device.

The same physical device cannot be assigned to a different slot.
