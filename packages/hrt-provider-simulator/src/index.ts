import {
  HRT_CONTRACT_VERSION,
  HrtCapability,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtDeviceEventPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
  assertValidCommandRequest,
} from "../../hrt-contract/src";

export interface ProviderSimulatorOptions {
  providerInstanceId?: string;
  startedAt?: string;
}

export class ProviderSimulator {
  readonly providerInstanceId: string;
  private readonly startedAt: string;
  private scannerSequence = 0;

  constructor(options: ProviderSimulatorOptions = {}) {
    this.providerInstanceId = options.providerInstanceId ?? "provider-sim-001";
    this.startedAt = options.startedAt ?? new Date(0).toISOString();
  }

  register(): HrtProviderRegistrationPayload {
    return {
      providerId: "windows-provider-simulator",
      providerInstanceId: this.providerInstanceId,
      providerVersion: "0.1.0",
      contractVersion: HRT_CONTRACT_VERSION,
      supportedCapabilities: this.capabilities(),
      platform: {
        os: "simulator",
        arch: "x64",
      },
      process: {
        pid: 1,
        startedAt: this.startedAt,
      },
    };
  }

  execute(command: HrtCommandRequestPayload): HrtCommandResultPayload {
    assertValidCommandRequest(command);
    return {
      commandId: command.commandId,
      outcome: "SUCCEEDED",
      effectBoundary: command.commandType === "SET_SCANNER_ENABLED" ? "NOT_CROSSED" : "CROSSED",
      providerInstanceId: this.providerInstanceId,
    };
  }

  scanBarcode(deviceId: string, barcode: string): HrtDeviceEventPayload {
    this.scannerSequence += 1;
    return {
      eventId: `scan-${this.scannerSequence}`,
      device: {
        deviceId,
        deviceKind: "SCANNER",
        slotId: "barcode-scanner",
      },
      eventType: "BARCODE_SCANNED",
      monotonicSequence: this.scannerSequence,
      data: {
        barcode,
      },
    };
  }

  healthSnapshot(): HrtHealthSnapshotPayload {
    return {
      providerState: "READY",
      providerInstanceId: this.providerInstanceId,
      devices: [
        {
          device: { deviceId: "printer-sim-001", deviceKind: "PRINTER", slotId: "receipt-printer" },
          health: "ONLINE",
          capabilities: ["printer.receipt", "printer.cash_drawer_pulse"],
        },
        {
          device: { deviceId: "scanner-sim-001", deviceKind: "SCANNER", slotId: "barcode-scanner" },
          health: "ONLINE",
          capabilities: ["scanner.barcode_event"],
        },
        {
          device: { deviceId: "display-sim-001", deviceKind: "CUSTOMER_DISPLAY", slotId: "customer-display" },
          health: "ONLINE",
          capabilities: ["customer_display.snapshot"],
        },
      ],
    };
  }

  private capabilities(): HrtCapability[] {
    return [
      "printer.receipt",
      "printer.cash_drawer_pulse",
      "scanner.barcode_event",
      "customer_display.snapshot",
    ];
  }
}

