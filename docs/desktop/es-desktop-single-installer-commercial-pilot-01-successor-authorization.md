# ES-DESKTOP-SINGLE-INSTALLER-COMMERCIAL-PILOT-01

## Release Foundation Successor Authorization

Status: FOUNDER-AUTHORIZED SUCCESSOR
Target version: `0.3.0-commercial-pilot.1`
Source baseline: `3f9a8b559c8db05a72355b3ec042d88a0b20912e`

Successor reason:

> Commercial Pilot cashier availability must be gated by canonical Provider runtime readiness.

Authorized product boundary changes:

- Desktop startup readiness gate
- WindowManager Cashier lifecycle
- canonical Provider readiness consumption

Authorized exact boundary snapshots:

| Boundary | Path | SHA-256 |
| --- | --- | --- |
| Desktop main startup gate | `desktop/src/main/main.ts` | `aef3d6426a3be6dee55426e3104071f6118281c37278ee49ab53be07e375113a` |
| WindowManager | `desktop/src/main/windowManager.ts` | `14497c1c0eac104fe70586a4bd40201cc5284425e3051e9059d7b70c39fce590` |

Safety semantics:

- Provider not READY: Cashier remains HOLD.
- Provider degraded or crashed: Cashier closes or remains HOLD.
- Provider respawned and READY: Cashier may automatically restore.
- No second Provider owner is introduced.
- Existing V3 control-plane safety is not bypassed.

Scope exclusions:

- No unrelated frozen product files.
- No Production, release branch, database, RC10, or V2 historical artifacts.
- No changes to printing engine, control-plane identity, owner/lease/batch, fencing, or Local First deduplication.
