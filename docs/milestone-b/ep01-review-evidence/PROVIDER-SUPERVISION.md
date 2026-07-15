# Provider Supervision Evidence

| Policy Field | Default |
| --- | --- |
| initialBackoffMs | 500 |
| backoffMultiplier | 2 |
| maxBackoffMs | 5000 |
| maxRestartAttempts | 3 |
| restartWindowMs | 60000 |

## Scenarios

- disconnect increments attempts
- deterministic backoff
- max restart limit
- no infinite restart loop
- manual reset
- DEGRADED on final allowed restart attempt
- STOPPED after threshold exceeded

## Review Questions

1. Infinite restart prevention: Yes, max attempts blocks further restart and enters STOPPED.
2. Restart window participation: Yes, `nowMs - firstRestartAtMs > restartWindowMs` resets the attempt window.
3. Backoff off-by-one: attempt 1 uses initial delay; tests assert 250, 500, capped 600, then stopped.
4. Manual reset and stale ownership: manual reset only resets supervision counters; it does not restore ownership.
5. Process spawn: No process spawn exists.
6. Time flakiness: Tests pass deterministic `nowMs`; no real timers are used.
