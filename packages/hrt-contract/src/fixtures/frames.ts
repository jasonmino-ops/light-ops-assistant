import {
  HRT_CONTRACT_VERSION,
  HRT_PROVIDER_COMPATIBILITY_MATRIX,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtCustomerDisplaySnapshotPayload,
  HrtDeviceEventPayload,
  HrtDiagnosticPayload,
  HrtFrame,
  HrtHandshakeRequestPayload,
  HrtHandshakeResponsePayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from "../types";

export const providerRegistrationFixture: HrtFrame<HrtProviderRegistrationPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "provider.register",
  correlationId: "corr-register-001",
  instanceId: "runtime-instance-001",
  sequence: 1,
  timestamp: "2026-07-14T16:00:00.000Z",
  payload: {
    providerId: "windows-provider-simulator",
    providerInstanceId: "provider-sim-001",
    providerVersion: "0.1.0",
    contractVersion: HRT_CONTRACT_VERSION,
    supportedCapabilities: [
      "printer.receipt",
      "printer.cash_drawer_pulse",
      "scanner.barcode_event",
      "customer_display.snapshot",
    ],
    capabilityDescriptors: [
      {
        capabilityId: "printer.receipt",
        capabilityVersion: "1.0.0",
        supportedCommandFamilies: ["printer"],
        supportedEventFamilies: ["diagnostics"],
      },
      {
        capabilityId: "printer.cash_drawer_pulse",
        capabilityVersion: "1.0.0",
        supportedCommandFamilies: ["printer"],
        supportedEventFamilies: ["diagnostics"],
      },
      {
        capabilityId: "scanner.barcode_event",
        capabilityVersion: "1.0.0",
        supportedCommandFamilies: ["scanner"],
        supportedEventFamilies: ["scanner", "health"],
      },
      {
        capabilityId: "customer_display.snapshot",
        capabilityVersion: "1.0.0",
        supportedCommandFamilies: ["customer_display"],
        supportedEventFamilies: ["health", "diagnostics"],
      },
    ],
    platform: {
      os: "simulator",
      arch: "x64",
      runtime: "simulator",
    },
    process: {
      pid: 1001,
      startedAt: "2026-07-14T16:00:00.000Z",
    },
  },
};

export const handshakeRequestFixture: HrtFrame<HrtHandshakeRequestPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "runtime.handshake.request",
  correlationId: "corr-handshake-001",
  instanceId: "runtime-instance-001",
  sequence: 0,
  timestamp: "2026-07-14T16:00:00.000Z",
  payload: {
    runtimeInstanceId: "runtime-instance-001",
    requiredContractVersion: HRT_CONTRACT_VERSION,
    requiredCapabilities: [...HRT_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities],
    compatibilityMatrix: {
      providerId: HRT_PROVIDER_COMPATIBILITY_MATRIX.providerId,
      minProviderVersion: HRT_PROVIDER_COMPATIBILITY_MATRIX.minProviderVersion,
      maxProviderVersionExclusive: HRT_PROVIDER_COMPATIBILITY_MATRIX.maxProviderVersionExclusive,
      requiredCapabilities: [...HRT_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities],
    },
    initiatedBy: "RUNTIME",
  },
};

export const handshakeResponseFixture: HrtFrame<HrtHandshakeResponsePayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "provider.handshake.response",
  correlationId: "corr-handshake-001",
  instanceId: "runtime-instance-001",
  sequence: 1,
  timestamp: "2026-07-14T16:00:00.500Z",
  payload: {
    provider: providerRegistrationFixture.payload,
    compatibility: {
      status: "COMPATIBLE",
      reason: "OK",
      providerId: providerRegistrationFixture.payload.providerId,
      providerInstanceId: providerRegistrationFixture.payload.providerInstanceId,
      providerVersion: providerRegistrationFixture.payload.providerVersion,
      contractVersion: HRT_CONTRACT_VERSION,
      missingCapabilities: [],
      matrix: handshakeRequestFixture.payload.compatibilityMatrix,
    },
    readyTransition: "RUNTIME_AUTHORIZED",
  },
};

export const printReceiptCommandFixture: HrtFrame<HrtCommandRequestPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "command.request",
  correlationId: "corr-command-001",
  instanceId: "runtime-instance-001",
  sequence: 2,
  timestamp: "2026-07-14T16:00:01.000Z",
  payload: {
    commandId: "cmd-print-001",
    idempotencyKey: "sale-record-001-print",
    device: {
      deviceId: "printer-sim-001",
      deviceKind: "PRINTER",
      slotId: "receipt-printer",
    },
    commandType: "PRINT_RECEIPT",
    params: {
      receiptNo: "R-001",
      total: 12.5,
    },
  },
};

export const succeededCommandResultFixture: HrtFrame<HrtCommandResultPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "command.result",
  correlationId: "corr-command-001",
  instanceId: "runtime-instance-001",
  sequence: 3,
  timestamp: "2026-07-14T16:00:02.000Z",
  payload: {
    commandId: "cmd-print-001",
    outcome: "SUCCEEDED",
    effectBoundary: "CROSSED",
    providerInstanceId: "provider-sim-001",
  },
};

export const unknownCommandResultFixture: HrtFrame<HrtCommandResultPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "command.result",
  correlationId: "corr-command-unknown-001",
  instanceId: "runtime-instance-001",
  sequence: 4,
  timestamp: "2026-07-14T16:00:03.000Z",
  payload: {
    commandId: "cmd-print-unknown-001",
    outcome: "UNKNOWN",
    effectBoundary: "MAY_HAVE_CROSSED",
    providerInstanceId: "provider-sim-001",
    errorCode: "DISCONNECTED_DURING_COMMAND",
    message: "Provider disconnected before command acknowledgement.",
  },
};

export const scannerEventFixture: HrtFrame<HrtDeviceEventPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "device.event",
  correlationId: "corr-scan-001",
  instanceId: "runtime-instance-001",
  sequence: 5,
  timestamp: "2026-07-14T16:00:04.000Z",
  payload: {
    eventId: "scan-001",
    device: {
      deviceId: "scanner-sim-001",
      deviceKind: "SCANNER",
      slotId: "barcode-scanner",
    },
    eventType: "BARCODE_SCANNED",
    monotonicSequence: 1,
    providerInstanceId: "provider-sim-001",
    scope: {
      storeId: "STORE-A",
      terminalId: "terminal-001",
    },
    data: {
      barcode: "1234567890",
    },
  },
};

export const customerDisplaySnapshotFixture: HrtFrame<HrtCustomerDisplaySnapshotPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "display.snapshot",
  correlationId: "corr-display-001",
  instanceId: "runtime-instance-001",
  sequence: 6,
  timestamp: "2026-07-14T16:00:05.000Z",
  payload: {
    snapshotId: "display-snapshot-001",
    providerInstanceId: "provider-sim-001",
    device: {
      deviceId: "display-sim-001",
      deviceKind: "CUSTOMER_DISPLAY",
      slotId: "customer-display",
    },
    scope: {
      storeId: "STORE-A",
      terminalId: "terminal-001",
    },
    sequence: 1,
    timestamp: "2026-07-14T16:00:05.000Z",
    expiresAt: "2026-07-14T16:05:05.000Z",
    state: "DISPLAY",
    payload: {
      totalAmount: 12.5,
      currencyCode: "USD",
    },
  },
};

export const healthSnapshotFixture: HrtFrame<HrtHealthSnapshotPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "health.snapshot",
  correlationId: "corr-health-001",
  instanceId: "runtime-instance-001",
  sequence: 7,
  timestamp: "2026-07-14T16:00:06.000Z",
  payload: {
    providerHealth: "READY",
    providerInstanceId: "provider-sim-001",
    timestamp: "2026-07-14T16:00:06.000Z",
    devices: [
      {
        device: { deviceId: "printer-sim-001", deviceKind: "PRINTER", slotId: "receipt-printer" },
        health: "UNKNOWN",
        capabilities: ["printer.receipt", "printer.cash_drawer_pulse"],
      },
    ],
  },
};

export const diagnosticFixture: HrtFrame<HrtDiagnosticPayload> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "diagnostic.report",
  correlationId: "corr-diagnostic-001",
  instanceId: "runtime-instance-001",
  sequence: 8,
  timestamp: "2026-07-14T16:00:07.000Z",
  payload: {
    diagnosticCode: "SIMULATOR_HEALTH",
    severity: "INFO",
    reason: "Simulator diagnostic event.",
    redactedDetails: {
      provider: "windows-provider-simulator",
    },
    correlationId: "corr-diagnostic-001",
    providerInstanceId: "provider-sim-001",
    timestamp: "2026-07-14T16:00:07.000Z",
  },
};

export const invalidMissingCorrelationFrameFixture: Omit<HrtFrame<HrtDiagnosticPayload>, "correlationId"> = {
  contractVersion: HRT_CONTRACT_VERSION,
  messageType: "diagnostic.report",
  instanceId: "runtime-instance-001",
  sequence: 9,
  timestamp: "2026-07-14T16:00:08.000Z",
  payload: diagnosticFixture.payload,
};
