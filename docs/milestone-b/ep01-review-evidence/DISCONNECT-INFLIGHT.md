# Disconnect and In-flight Evidence

- Provider disconnect invalidates ownership and moves lifecycle to `DISCONNECTED`.
- New commands after disconnect are rejected because lifecycle is not `READY` and ownership is invalid.
- In-flight command IDs are recorded in `HrtLogicCore.inFlightCommandIds` and emitted in disconnect diagnostics.
- In-flight commands are not automatically marked `FAILED`.
- `UNKNOWN + CROSSING_UNKNOWN` is produced by the Provider Simulator for uncertain results and remains a contract/simulator behavior; EP-01 only provides the disconnect hook for EP-03.
- No blind retry behavior exists.
- Stale result after restart is rejected by ownership gate.
- This implementation does not implement full Command Lifecycle; it stays at Provider Runtime hook level.
