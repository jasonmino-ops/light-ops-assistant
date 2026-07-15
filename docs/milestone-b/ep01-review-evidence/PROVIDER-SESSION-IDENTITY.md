# Provider Session and Identity Evidence

| Identity / Field | Runtime Representation | Notes |
| --- | --- | --- |
| Stable Provider Identity | `providerId` | Compared against compatibility matrix provider identity. |
| Provider Instance ID | `providerInstanceId` | Authoritative ownership instance. |
| Session ID | `providerId:providerInstanceId:process.startedAt` | Distinct from provider identity and instance identity. |
| Connection Identity | `connectionState` + session timestamps | No Named Pipe identity in EP-01. |
| Provider Version | `providerVersion` | Stored in session and compatibility. |
| Contract Version | `contractVersion` | Must match frozen contract version. |
| Capability | `capabilities`, `capabilityDescriptors` | Required capabilities checked. |
| Platform / Process Metadata | `platform`, `process` | Stored from registration. |
| Ownership Validity | `ownershipValid`, `stale` | Invalidated on restart/disconnect/shutdown. |

## Findings

- The three identities are not represented by a single field.
- Restart with new instance marks old session stale and creates a new active session.
- Old instance remains as stale audit evidence in registry.
- Session is not reused by old instance after restart because ownership checks compare providerInstanceId.
