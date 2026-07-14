import {
  HRT_CONTRACT_VERSION,
  HRT_PROVIDER_COMPATIBILITY_MATRIX,
  HrtCapability,
  HrtCommandFamily,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtCustomerDisplaySnapshotPayload,
  HrtDeviceEventPayload,
  HrtDeviceHealth,
  HrtDiagnosticPayload,
  HrtEventFamily,
  HrtHandshakeRequestPayload,
  HrtHandshakeResponsePayload,
  HrtHealthSnapshotPayload,
  HrtJsonValue,
  HrtProviderHealth,
  HrtProviderRegistrationPayload,
  assertValidCommandRequest,
  assertValidCustomerDisplaySnapshot,
  assertValidHealthSnapshot,
  assertValidScannerEvent,
  evaluateCompatibility,
} from "@eshop/hrt-contract";

export interface ProviderSimulatorOptions {
  providerId?: string;
  providerInstanceId?: string;
  providerVersion?: string;
  contractVersion?: string;
  capabilities?: HrtCapability[];
  startedAt?: string;
  providerHealth?: HrtProviderHealth;
  deviceHealth?: HrtDeviceHealth;
  scope?: {
    storeId: string;
    terminalId: string;
  };
}

export type ProviderSimulatorCommandMode =
  | "success"
  | "unknown"
  | "side-effect-unknown"
  | "disconnect-during-command"
  | "timeout-uncertain";

export interface SnapshotApplyResult {
  accepted: boolean;
  reason:
    | "ACCEPTED"
    | "OLDER_SEQUENCE"
    | "EXPIRED"
    | "WRONG_SCOPE"
    | "STALE_PROVIDER_INSTANCE";
}

// TEST / DEVELOPMENT ONLY. NOT A PRODUCTION PROVIDER.
export class ProviderSimulator {
  readonly providerId: string;
  providerInstanceId: string;
  providerHealth: HrtProviderHealth;
  private readonly providerVersion: string;
  private readonly contractVersion: string;
  private readonly supportedCapabilities: HrtCapability[];
  private readonly startedAt: string;
  private readonly defaultDeviceHealth: HrtDeviceHealth;
  private readonly scope: { storeId: string; terminalId: string };
  private registered = false;
  private scannerSequence = 0;
  private readonly seenScannerEvents = new Set<string>();
  private lastDisplaySnapshot: HrtCustomerDisplaySnapshotPayload | null = null;

  constructor(options: ProviderSimulatorOptions = {}) {
    this.providerId = options.providerId ?? HRT_PROVIDER_COMPATIBILITY_MATRIX.providerId;
    this.providerInstanceId = options.providerInstanceId ?? "provider-sim-001";
    this.providerVersion = options.providerVersion ?? "0.1.0";
    this.contractVersion = options.contractVersion ?? HRT_CONTRACT_VERSION;
    this.supportedCapabilities = options.capabilities ?? this.defaultCapabilities();
    this.startedAt = options.startedAt ?? new Date(0).toISOString();
    this.providerHealth = options.providerHealth ?? "STARTING";
    this.defaultDeviceHealth = options.deviceHealth ?? "UNKNOWN";
    this.scope = options.scope ?? { storeId: "STORE-A", terminalId: "terminal-001" };
  }

  register(): HrtProviderRegistrationPayload {
    this.registered = true;
    return {
      providerId: this.providerId,
      providerInstanceId: this.providerInstanceId,
      providerVersion: this.providerVersion,
      contractVersion: this.contractVersion,
      supportedCapabilities: this.supportedCapabilities,
      capabilityDescriptors: this.supportedCapabilities.map((capabilityId) => ({
        capabilityId,
        capabilityVersion: "1.0.0",
        supportedCommandFamilies: this.commandFamiliesFor(capabilityId),
        supportedEventFamilies: this.eventFamiliesFor(capabilityId),
      })),
      platform: {
        os: "simulator",
        arch: "x64",
        runtime: "simulator",
      },
      process: {
        pid: 1,
        startedAt: this.startedAt,
      },
    };
  }

  handshake(request: HrtHandshakeRequestPayload): HrtHandshakeResponsePayload {
    const registration = this.register();
    const compatibility = evaluateCompatibility(registration, request.requiredCapabilities);
    return {
      provider: registration,
      compatibility,
      readyTransition: compatibility.status === "COMPATIBLE" ? "RUNTIME_AUTHORIZED" : "REJECTED",
      rejectionReason: compatibility.reason === "OK" ? undefined : this.rejectionReasonFor(compatibility.reason),
    };
  }

  duplicateRegistration(): HrtProviderRegistrationPayload {
    if (this.registered) {
      throw new Error("DUPLICATE_REGISTRATION");
    }
    return this.register();
  }

  restart(nextProviderInstanceId: string): void {
    this.providerInstanceId = nextProviderInstanceId;
    this.providerHealth = "STARTING";
    this.registered = false;
    this.scannerSequence = 0;
    this.seenScannerEvents.clear();
    this.lastDisplaySnapshot = null;
  }

  disconnect(): void {
    this.providerHealth = "DISCONNECTED";
  }

  shutdown(): void {
    this.providerHealth = "SHUTDOWN";
  }

  execute(command: HrtCommandRequestPayload, mode: ProviderSimulatorCommandMode = "success"): HrtCommandResultPayload {
    assertValidCommandRequest(command);
    if (mode === "disconnect-during-command") {
      this.disconnect();
      return this.uncertainResult(command.commandId, "DISCONNECTED_DURING_COMMAND");
    }
    if (mode === "timeout-uncertain") {
      return this.uncertainResult(command.commandId, "TIMEOUT_UNCERTAIN");
    }
    if (mode === "unknown" || mode === "side-effect-unknown") {
      return this.uncertainResult(command.commandId, "UNKNOWN_OUTCOME");
    }
    return {
      commandId: command.commandId,
      outcome: "SUCCEEDED",
      effectBoundary: command.commandType === "SET_SCANNER_ENABLED" ? "NOT_CROSSED" : "CROSSED",
      providerInstanceId: this.providerInstanceId,
    };
  }

  shouldRetryBlindly(result: HrtCommandResultPayload): boolean {
    return result.outcome !== "UNKNOWN" && result.effectBoundary !== "MAY_HAVE_CROSSED";
  }

  scanBarcode(
    deviceId: string,
    barcode: string,
    options: {
      eventId?: string;
      providerInstanceId?: string;
      scope?: { storeId: string; terminalId: string };
      omitDeviceIdentity?: boolean;
    } = {},
  ): HrtDeviceEventPayload {
    this.scannerSequence += 1;
    const event: HrtDeviceEventPayload = {
      eventId: options.eventId ?? `scan-${this.scannerSequence}`,
      device: {
        deviceId: options.omitDeviceIdentity ? "" : deviceId,
        deviceKind: "SCANNER",
        slotId: "barcode-scanner",
      },
      eventType: "BARCODE_SCANNED",
      monotonicSequence: this.scannerSequence,
      providerInstanceId: options.providerInstanceId ?? this.providerInstanceId,
      scope: options.scope ?? this.scope,
      data: {
        barcode,
      },
    };
    assertValidScannerEvent(event);
    return event;
  }

  acceptScannerEvent(event: HrtDeviceEventPayload): boolean {
    assertValidScannerEvent(event);
    if (event.providerInstanceId !== this.providerInstanceId) {
      return false;
    }
    if (event.scope.storeId !== this.scope.storeId || event.scope.terminalId !== this.scope.terminalId) {
      return false;
    }
    if (this.seenScannerEvents.has(event.eventId)) {
      return false;
    }
    this.seenScannerEvents.add(event.eventId);
    return true;
  }

  displaySnapshot(
    sequence: number,
    options: {
      snapshotId?: string;
      scope?: { storeId: string; terminalId: string };
      expiresAt?: string;
      timestamp?: string;
      state?: "DISPLAY" | "CLEAR";
      payload?: Record<string, HrtJsonValue>;
      providerInstanceId?: string;
    } = {},
  ): HrtCustomerDisplaySnapshotPayload {
    const snapshot: HrtCustomerDisplaySnapshotPayload = {
      snapshotId: options.snapshotId ?? `display-snapshot-${sequence}`,
      providerInstanceId: options.providerInstanceId ?? this.providerInstanceId,
      device: { deviceId: "display-sim-001", deviceKind: "CUSTOMER_DISPLAY", slotId: "customer-display" },
      scope: options.scope ?? this.scope,
      sequence,
      timestamp: options.timestamp ?? "2026-07-14T16:00:05.000Z",
      expiresAt: options.expiresAt ?? "2026-07-14T16:05:05.000Z",
      state: options.state ?? "DISPLAY",
      payload: options.payload ?? { totalAmount: 12.5, currencyCode: "USD" },
    };
    assertValidCustomerDisplaySnapshot(snapshot);
    return snapshot;
  }

  applyDisplaySnapshot(snapshot: HrtCustomerDisplaySnapshotPayload, now = "2026-07-14T16:00:06.000Z"): SnapshotApplyResult {
    assertValidCustomerDisplaySnapshot(snapshot);
    if (snapshot.providerInstanceId !== this.providerInstanceId) {
      return { accepted: false, reason: "STALE_PROVIDER_INSTANCE" };
    }
    if (snapshot.scope.storeId !== this.scope.storeId || snapshot.scope.terminalId !== this.scope.terminalId) {
      return { accepted: false, reason: "WRONG_SCOPE" };
    }
    if (Date.parse(snapshot.expiresAt) <= Date.parse(now)) {
      return { accepted: false, reason: "EXPIRED" };
    }
    if (this.lastDisplaySnapshot && snapshot.sequence <= this.lastDisplaySnapshot.sequence) {
      return { accepted: false, reason: "OLDER_SEQUENCE" };
    }
    this.lastDisplaySnapshot = snapshot;
    return { accepted: true, reason: "ACCEPTED" };
  }

  reconnectDisplay(now = "2026-07-14T16:00:06.000Z"): HrtCustomerDisplaySnapshotPayload | null {
    if (!this.lastDisplaySnapshot || Date.parse(this.lastDisplaySnapshot.expiresAt) <= Date.parse(now)) {
      return null;
    }
    return this.lastDisplaySnapshot;
  }

  healthSnapshot(): HrtHealthSnapshotPayload {
    const snapshot: HrtHealthSnapshotPayload = {
      providerHealth: this.providerHealth,
      providerInstanceId: this.providerInstanceId,
      timestamp: "2026-07-14T16:00:06.000Z",
      devices: [
        {
          device: { deviceId: "printer-sim-001", deviceKind: "PRINTER", slotId: "receipt-printer" },
          health: this.defaultDeviceHealth,
          capabilities: ["printer.receipt", "printer.cash_drawer_pulse"],
        },
        {
          device: { deviceId: "scanner-sim-001", deviceKind: "SCANNER", slotId: "barcode-scanner" },
          health: this.defaultDeviceHealth,
          capabilities: ["scanner.barcode_event"],
        },
        {
          device: { deviceId: "display-sim-001", deviceKind: "CUSTOMER_DISPLAY", slotId: "customer-display" },
          health: this.defaultDeviceHealth,
          capabilities: ["customer_display.snapshot"],
        },
      ],
    };
    assertValidHealthSnapshot(snapshot);
    return snapshot;
  }

  diagnostic(correlationId: string, severity: HrtDiagnosticPayload["severity"] = "INFO"): HrtDiagnosticPayload {
    return {
      diagnosticCode: "SIMULATOR_DIAGNOSTIC",
      severity,
      reason: "Simulator diagnostic event.",
      redactedDetails: {
        providerId: this.providerId,
      },
      correlationId,
      providerInstanceId: this.providerInstanceId,
      timestamp: "2026-07-14T16:00:07.000Z",
    };
  }

  private uncertainResult(commandId: string, errorCode: string): HrtCommandResultPayload {
    return {
      commandId,
      outcome: "UNKNOWN",
      effectBoundary: "MAY_HAVE_CROSSED",
      providerInstanceId: this.providerInstanceId,
      errorCode,
      message: "Command outcome is unknown and side effect may have crossed boundary.",
    };
  }

  private rejectionReasonFor(reason: HrtHandshakeResponsePayload["compatibility"]["reason"]) {
    if (reason === "INCOMPATIBLE_CONTRACT_VERSION") {
      return "CONTRACT_VERSION_MISMATCH";
    }
    if (reason === "UNSUPPORTED_PROVIDER_VERSION") {
      return "UNSUPPORTED_PROVIDER_VERSION";
    }
    if (reason === "MISSING_REQUIRED_CAPABILITY") {
      return "MISSING_REQUIRED_CAPABILITY";
    }
    return undefined;
  }

  private commandFamiliesFor(capability: HrtCapability): HrtCommandFamily[] {
    if (capability.startsWith("printer.")) {
      return ["printer"];
    }
    if (capability.startsWith("scanner.")) {
      return ["scanner"];
    }
    return ["customer_display"];
  }

  private eventFamiliesFor(capability: HrtCapability): HrtEventFamily[] {
    if (capability === "scanner.barcode_event") {
      return ["scanner", "health"];
    }
    return ["health", "diagnostics"];
  }

  private defaultCapabilities(): HrtCapability[] {
    return [
      "printer.receipt",
      "printer.cash_drawer_pulse",
      "scanner.barcode_event",
      "customer_display.snapshot",
    ];
  }
}
