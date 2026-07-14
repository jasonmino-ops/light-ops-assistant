# Side-Effect Boundary

Frozen side-effect boundary values:

1. NOT_CROSSED
2. CROSSING_UNKNOWN
3. CROSSED

## Blind Retry Rule

When a command result is `UNKNOWN` and the effect boundary is `CROSSING_UNKNOWN`, the simulator returns `shouldRetryBlindly() === false`. This prevents an adapter or dispatcher from treating uncertain side effects as safe retry conditions.
