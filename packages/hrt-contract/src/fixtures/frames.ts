import {
  HRT_CONTRACT_VERSION,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtFrame,
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
    platform: {
      os: "simulator",
      arch: "x64",
    },
    process: {
      pid: 1001,
      startedAt: "2026-07-14T16:00:00.000Z",
    },
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

