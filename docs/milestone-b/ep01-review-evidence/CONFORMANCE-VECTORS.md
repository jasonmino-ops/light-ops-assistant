# Conformance Vector Review

| Vector ID | Input | Expected | Runtime Test | Language Neutral | TS-specific Structure |
| --- | --- | --- | --- | --- | --- |
| `valid-registration` | `{"providerId": "windows-provider-simulator", "providerInstanceId": "provider-sim-001"}` | `{"decision": "ACCEPTED_FIRST_REGISTRATION", "diagnosticCode": "HRT_PROVIDER_REGISTRATION_ACCEPTED"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `incompatible-contract` | `{"contractVersion": "0.0.0"}` | `{"decision": "REJECTED_INCOMPATIBLE", "rejectionReason": "CONTRACT_VERSION_MISMATCH"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `missing-capability` | `{"capabilities": ["printer.receipt", "scanner.barcode_event"]}` | `{"decision": "REJECTED_INCOMPATIBLE", "rejectionReason": "MISSING_REQUIRED_CAPABILITY"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `duplicate-registration` | `{"providerInstanceId": "provider-sim-001", "repeatSameInstance": true}` | `{"decision": "REJECTED_DUPLICATE_SAME_INSTANCE", "diagnosticCode": "HRT_PROVIDER_REGISTRATION_REJECTED"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `restart-with-new-instance` | `{"previousProviderInstanceId": "provider-sim-001", "providerInstanceId": "provider-sim-002"}` | `{"decision": "ACCEPTED_RESTART_NEW_INSTANCE", "diagnosticCode": "HRT_PROVIDER_STALE_INSTANCE_MARKED"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `stale-instance-result` | `{"activeProviderInstanceId": "provider-sim-002", "resultProviderInstanceId": "provider-sim-001"}` | `{"accepted": false, "rejectionReason": "STALE_PROVIDER_INSTANCE"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `disconnect` | `{"providerInstanceId": "provider-sim-001"}` | `{"lifecycleState": "DISCONNECTED", "diagnosticCode": "HRT_PROVIDER_DISCONNECTED"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `supervision-backoff` | `{"restartAttempt": 1}` | `{"restartAllowed": true, "backoffMs": 500, "diagnosticCode": "HRT_PROVIDER_RESTART_BACKOFF"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `max-restart` | `{"restartAttempt": 4}` | `{"restartAllowed": false, "supervisionState": "STOPPED", "diagnosticCode": "HRT_PROVIDER_MAX_RESTART_REACHED"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `illegal-transition` | `{"from": "NEW", "to": "READY"}` | `{"throws": true, "diagnosticCode": "HRT_PROVIDER_ILLEGAL_TRANSITION"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |
| `shutdown` | `{"providerInstanceId": "provider-sim-001"}` | `{"lifecycleState": "STOPPED", "diagnosticCode": "HRT_PROVIDER_STOPPED"}` | `desktop/tests/provider-runtime.test.ts` | Yes | No TS-specific value |

## Findings

- Vectors are JSON and language-neutral in shape.
- Current TS test loads the vector file and asserts vector ID ordering.
- Expected fields are not yet individually executed as a conformance runner.
- This is adequate as MB-2A review evidence but not yet sufficient as future .NET conformance automation.
