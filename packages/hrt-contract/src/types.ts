export const HRT_CONTRACT_VERSION = "1.0.0";

export type HrtDeviceKind = "PRINTER" | "SCANNER" | "CUSTOMER_DISPLAY";

export type HrtMessageType =
  | "provider.register"
  | "provider.ready"
  | "provider.rejected"
  | "command.request"
  | "command.result"
  | "device.event"
  | "health.snapshot";

export type HrtCommandOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "TIMEOUT"
  | "CANCELLED"
  | "UNKNOWN";

export type HrtEffectBoundary = "NOT_CROSSED" | "MAY_HAVE_CROSSED" | "CROSSED";

export type HrtCapability =
  | "printer.receipt"
  | "printer.cash_drawer_pulse"
  | "scanner.barcode_event"
  | "customer_display.snapshot";

export type HrtProviderState = "NEW" | "REGISTERED" | "READY" | "REJECTED" | "DISCONNECTED";

export type HrtDeviceHealth = "UNKNOWN" | "ONLINE" | "DEGRADED" | "OFFLINE";

export type HrtJsonValue =
  | null
  | boolean
  | number
  | string
  | HrtJsonValue[]
  | { [key: string]: HrtJsonValue };

export interface HrtFrame<TPayload = HrtJsonValue> {
  contractVersion: string;
  messageType: HrtMessageType;
  correlationId: string;
  instanceId: string;
  sequence: number;
  timestamp: string;
  payload: TPayload;
}

export interface HrtProviderRegistrationPayload {
  providerId: string;
  providerInstanceId: string;
  providerVersion: string;
  contractVersion: string;
  supportedCapabilities: HrtCapability[];
  platform: {
    os: "windows" | "macos" | "linux" | "simulator";
    arch: string;
  };
  process: {
    pid: number;
    startedAt: string;
  };
}

export interface HrtDeviceRef {
  deviceId: string;
  deviceKind: HrtDeviceKind;
  slotId?: string;
}

export interface HrtCommandRequestPayload {
  commandId: string;
  idempotencyKey: string;
  device: HrtDeviceRef;
  commandType:
    | "PRINT_RECEIPT"
    | "OPEN_CASH_DRAWER"
    | "SET_SCANNER_ENABLED"
    | "DISPLAY_SNAPSHOT"
    | "CLEAR_DISPLAY";
  params: Record<string, HrtJsonValue>;
}

export interface HrtCommandResultPayload {
  commandId: string;
  outcome: HrtCommandOutcome;
  effectBoundary: HrtEffectBoundary;
  providerInstanceId: string;
  errorCode?: string;
  message?: string;
}

export interface HrtDeviceEventPayload {
  eventId: string;
  device: HrtDeviceRef;
  eventType: "BARCODE_SCANNED";
  monotonicSequence: number;
  data: Record<string, HrtJsonValue>;
}

export interface HrtHealthSnapshotPayload {
  providerState: HrtProviderState;
  providerInstanceId: string;
  devices: Array<{
    device: HrtDeviceRef;
    health: HrtDeviceHealth;
    capabilities: HrtCapability[];
  }>;
}
