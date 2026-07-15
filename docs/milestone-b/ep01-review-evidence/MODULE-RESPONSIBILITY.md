# Module Responsibility Matrix

| Module | Responsibility | Owns State | Depends On | Called By | Explicitly Does Not Do |
| --- | --- | --- | --- | --- | --- |
| providerSession | Formal Provider Session shape and identity fields | Session object fields | @eshop/hrt-contract types | providerRegistry | Does not authorize READY or supervise process |
| providerLifecycle | Lifecycle state machine and legal transitions | Current lifecycle state and transition history | none | HrtLogicCore, providerRegistry | Does not track health, ownership, or restart policy |
| providerRegistry | Active/stale/rejected provider sessions and handshake decision | Active session, stale sessions, rejected sessions, last handshake/rejection/disconnect | Contract compatibility, providerSession, lifecycle, diagnostics | HrtLogicCore | Does not manage devices, spawn process, or assign device slots |
| providerOwnership | Authoritative provider instance ownership gates | Authoritative provider instance id and validity | runtimeDiagnostics | HrtLogicCore/tests | Does not implement Device Assignment Runtime |
| providerSupervision | Restart/backoff/max restart policy model | Supervision state, restart attempts, first restart window, last backoff | none | HrtLogicCore/tests | Does not spawn or monitor a real process |
| providerHealth | Provider/device health separation view | Last health snapshot and stale provider ids | Contract health types | HrtLogicCore | Does not rewrite device health or discover devices |
| runtimeDiagnostics | Structured diagnostics and redaction | Diagnostic event list | Contract provider health type, lifecycle type | HrtLogicCore, ownership, registry | Does not export support bundles or persist logs |
| hrtLogicCore | Facade/composition root for HRT Provider Runtime | Composed module instances and in-flight command id set | All HRT modules plus providerClient/commandRouter/deviceRegistry | Desktop tests/future runtime entry | Does not contain business logic or direct hardware control |
| providerClient | Boundary interface to provider implementation | No state | Contract payload types | HrtLogicCore, commandRouter, healthEngine | Does not implement provider |
| deviceRegistry | Basic device cache from health snapshot | Map of registered devices | Contract device types | HrtLogicCore, healthEngine | Does not do real discovery or assignment |
| commandRouter | Validates command request/result and forwards to provider | No durable state | Contract validators, providerClient, auditEmitter | HrtLogicCore | Does not implement full command lifecycle |
| auditEmitter | Legacy simple audit collector retained for compatibility | Audit event list | none | commandRouter, HrtLogicCore | Does not replace structured diagnostics |

## Review Notes

- `HrtLogicCore` remains a facade / composition root. It composes Provider Runtime modules and exposes controlled runtime operations.
- No single module owns Registry, Lifecycle, Supervision, and Health together.
- No God Object was found in the new modules. `HrtLogicCore` has grown, but delegates state to specialized modules.
- No business logic was found in `desktop/src/main/hrt/`.
- Static import review found no module cycle in the Provider Runtime modules.
