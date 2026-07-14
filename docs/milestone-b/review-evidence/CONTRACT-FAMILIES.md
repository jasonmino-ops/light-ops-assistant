# Contract Family Matrix

| Family | Type | Schema | Validator | Fixture | Tests | Public Export |
| --- | --- | --- | --- | --- | --- | --- |
| Lifecycle | HrtProviderLifecyclePayload / HrtProviderState | frame lifecycle message types | validateProviderRegistrationPayload / HRT core restart guards | providerRegistrationFixture / simulator lifecycle methods | tests/hrt-contract.test.ts; desktop/tests/hrt-logic-core.test.ts | Yes |
| Registration | HrtProviderRegistrationPayload | provider-registration.schema.json | validateProviderRegistrationPayload | providerRegistrationFixture | Yes | Yes |
| Handshake | HrtHandshakeRequestPayload / HrtHandshakeResponsePayload | handshake.schema.json | validateHandshakeRequestPayload / validateHandshakeResponsePayload | handshakeRequestFixture / handshakeResponseFixture | Yes | Yes |
| Compatibility | HrtCompatibilityResultPayload / HrtCompatibilityMatrixEntry | compatibility.schema.json | evaluateCompatibility / validateCompatibilityResultPayload | handshakeResponseFixture compatibility | Yes | Yes |
| Capability | HrtCapability / HrtCapabilityDescriptor | provider-registration.schema.json | registration validator capability checks | providerRegistrationFixture descriptors | Yes | Yes |
| Identity | providerId / providerInstanceId fields | provider-registration / handshake / health schemas | registration/handshake/health validators | fixtures include stable provider and instance IDs | Yes | Yes |
| Assignment | HrtDeviceRef.slotId | command/scanner/display/health schemas reference device | device validators | fixtures include slotId | Partial | Yes |
| Health | HrtHealthSnapshotPayload / HrtProviderHealth / HrtDeviceHealth | health-snapshot.schema.json | validateHealthSnapshotPayload | healthSnapshotFixture | Yes | Yes |
| Command | HrtCommandRequestPayload / HrtCommandResultPayload | command-request.schema.json / command-result.schema.json | validateCommandRequestPayload / validateCommandResultPayload | printReceiptCommandFixture / succeededCommandResultFixture / unknownCommandResultFixture | Yes | Yes |
| Printer | PRINT_RECEIPT / OPEN_ATTACHED_CASH_DRAWER / printer capabilities | command schemas | command validators | printReceiptCommandFixture | Basic | Yes |
| Scanner | HrtDeviceEventPayload | scanner-event.schema.json | validateScannerEventPayload | scannerEventFixture | Yes | Yes |
| Customer Display | HrtCustomerDisplaySnapshotPayload | customer-display-snapshot.schema.json | validateCustomerDisplaySnapshotPayload | customerDisplaySnapshotFixture | Yes | Yes |
| Diagnostics | HrtDiagnosticPayload | diagnostics.schema.json | validateDiagnosticPayload | diagnosticFixture / invalidMissingCorrelationFrameFixture | Yes | Yes |
| Version | HRT_CONTRACT_VERSION / providerVersion | frame/provider/handshake schemas | frame + compatibility validators | all versioned frame fixtures | Yes | Yes |
| Outcome | HrtCommandOutcome | command-result.schema.json | validateCommandResultPayload | succeeded/unknown result fixtures | Yes | Yes |
| Side-Effect | HrtEffectBoundary | command-result.schema.json | validateCommandResultPayload | succeeded/unknown result fixtures | Yes | Yes |
