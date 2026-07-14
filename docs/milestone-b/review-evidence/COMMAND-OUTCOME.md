# Command Outcome

Frozen command outcome values:

1. SUCCEEDED
2. FAILED
3. REJECTED
4. TIMED_OUT
5. CANCELLED
6. UNKNOWN

## UNKNOWN Preservation

`UNKNOWN` is defined in `HrtCommandOutcome`, accepted by `validateCommandResultPayload`, covered by `unknownCommandResultFixture`, and exercised in `tests/hrt-contract.test.ts`. No helper converts `UNKNOWN` to `FAILED`, `TIMED_OUT`, or `SUCCEEDED`.
