# Provider Registry Evidence

Registry responsibilities:

- active provider session
- stale provider sessions
- rejected provider sessions
- authoritative provider instance
- duplicate same instance handling
- restart new instance handling
- conflicting provider handling
- one active provider enforcement

## Behavior

| Scenario | Decision | Test Mapping |
| --- | --- | --- |
| first registration | `ACCEPTED_FIRST_REGISTRATION` | `registers the first provider...` |
| duplicate same instance | `REJECTED_DUPLICATE_SAME_INSTANCE` | `rejects incompatible... duplicate...` |
| restart new instance | `ACCEPTED_RESTART_NEW_INSTANCE` | `replaces a restarted provider instance...` |
| conflicting provider | `REJECTED_CONFLICTING_PROVIDER` | `rejects incompatible... conflicting providers distinctly` |
| stale retained | staleSessions list | `replaces a restarted provider instance...` |
| one active provider | `activeSession` replaced, not multi-dispatched | registry behavior and tests |

## Accumulation Risk

Stale and rejected sessions are retained in memory for audit evidence. There is no cleanup/compaction policy yet. This is acceptable for MB-2A review but should be revisited in a later diagnostics/support-bundle EP.
