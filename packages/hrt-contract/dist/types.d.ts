export declare const HRT_CONTRACT_VERSION = "1.0.0";
export declare const HRT_PROVIDER_COMPATIBILITY_MATRIX: {
    readonly providerId: "windows-provider-simulator";
    readonly minProviderVersion: "0.1.0";
    readonly maxProviderVersionExclusive: "1.0.0";
    readonly requiredCapabilities: readonly ["printer.receipt", "scanner.barcode_event", "customer_display.snapshot"];
};
export type HrtDeviceKind = "PRINTER" | "SCANNER" | "CUSTOMER_DISPLAY";
export type HrtMessageType = "runtime.handshake.request" | "provider.handshake.response" | "provider.register" | "provider.ready" | "provider.rejected" | "provider.disconnect" | "provider.restart" | "provider.shutdown" | "command.request" | "command.result" | "device.event" | "display.snapshot" | "health.snapshot" | "diagnostic.report";
export type HrtCommandOutcome = "SUCCEEDED" | "FAILED" | "REJECTED" | "TIMED_OUT" | "CANCELLED" | "UNKNOWN";
export type HrtEffectBoundary = "NOT_CROSSED" | "CROSSING_UNKNOWN" | "CROSSED";
export type HrtCapability = "printer.receipt" | "printer.cash_drawer_pulse" | "scanner.barcode_event" | "customer_display.snapshot";
export type HrtCommandFamily = "printer" | "scanner" | "customer_display";
export type HrtEventFamily = "scanner" | "health" | "diagnostics";
export type HrtProviderState = "NEW" | "REGISTERED" | "HANDSHAKING" | "READY" | "REJECTED" | "DISCONNECTED" | "SHUTDOWN";
export type HrtDeviceHealth = "UNKNOWN" | "ONLINE" | "DEGRADED" | "OFFLINE";
export type HrtProviderHealth = "UNKNOWN" | "STARTING" | "READY" | "DEGRADED" | "DISCONNECTED" | "SHUTDOWN";
export type HrtCompatibilityStatus = "COMPATIBLE" | "INCOMPATIBLE";
export type HrtCompatibilityReason = "OK" | "INCOMPATIBLE_CONTRACT_VERSION" | "UNSUPPORTED_PROVIDER_VERSION" | "MISSING_REQUIRED_CAPABILITY";
export type HrtRejectionReason = "CONTRACT_VERSION_MISMATCH" | "UNSUPPORTED_PROVIDER_VERSION" | "MISSING_REQUIRED_CAPABILITY" | "DUPLICATE_REGISTRATION" | "STALE_PROVIDER_INSTANCE" | "MALFORMED_FRAME" | "MISSING_CORRELATION_ID";
export type HrtDiagnosticSeverity = "INFO" | "WARN" | "ERROR";
export type HrtJsonValue = null | boolean | number | string | HrtJsonValue[] | {
    [key: string]: HrtJsonValue;
};
export interface HrtFrame<TPayload = HrtJsonValue> {
    contractVersion: string;
    messageType: HrtMessageType;
    correlationId: string;
    instanceId: string;
    sequence: number;
    timestamp: string;
    payload: TPayload;
}
export interface HrtCapabilityDescriptor {
    capabilityId: HrtCapability;
    capabilityVersion: string;
    supportedCommandFamilies: HrtCommandFamily[];
    supportedEventFamilies: HrtEventFamily[];
}
export interface HrtProviderRegistrationPayload {
    providerId: string;
    providerInstanceId: string;
    providerVersion: string;
    contractVersion: string;
    supportedCapabilities: HrtCapability[];
    capabilityDescriptors: HrtCapabilityDescriptor[];
    platform: {
        os: "windows" | "macos" | "linux" | "simulator";
        arch: string;
        runtime?: "electron" | "node" | "simulator";
    };
    process: {
        pid: number;
        startedAt: string;
    };
}
export interface HrtHandshakeRequestPayload {
    runtimeInstanceId: string;
    requiredContractVersion: string;
    requiredCapabilities: HrtCapability[];
    compatibilityMatrix: HrtCompatibilityMatrixEntry;
    initiatedBy: "RUNTIME";
}
export interface HrtCompatibilityMatrixEntry {
    providerId: string;
    minProviderVersion: string;
    maxProviderVersionExclusive: string;
    requiredCapabilities: readonly HrtCapability[];
}
export interface HrtCompatibilityResultPayload {
    status: HrtCompatibilityStatus;
    reason: HrtCompatibilityReason;
    providerId: string;
    providerInstanceId: string;
    providerVersion: string;
    contractVersion: string;
    missingCapabilities: HrtCapability[];
    matrix: HrtCompatibilityMatrixEntry;
}
export interface HrtHandshakeResponsePayload {
    provider: HrtProviderRegistrationPayload;
    compatibility: HrtCompatibilityResultPayload;
    readyTransition: "RUNTIME_AUTHORIZED" | "REJECTED";
    rejectionReason?: HrtRejectionReason;
}
export interface HrtProviderLifecyclePayload {
    providerId: string;
    providerInstanceId: string;
    previousProviderInstanceId?: string;
    lifecycle: "REGISTERED" | "HANDSHAKE_REQUESTED" | "HANDSHAKE_RESPONDED" | "READY" | "REJECTED" | "DISCONNECTED" | "RESTARTED" | "SHUTDOWN" | "HEALTH_UPDATED";
    reason?: HrtRejectionReason | "PROVIDER_DISCONNECTED" | "PROVIDER_RESTARTED" | "PROVIDER_SHUTDOWN";
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
    commandType: "PRINT_RECEIPT" | "OPEN_ATTACHED_CASH_DRAWER" | "SET_SCANNER_ENABLED" | "DISPLAY_SNAPSHOT" | "CLEAR_DISPLAY";
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
    providerInstanceId: string;
    scope: {
        storeId: string;
        terminalId: string;
    };
    data: Record<string, HrtJsonValue>;
}
export interface HrtCustomerDisplaySnapshotPayload {
    snapshotId: string;
    providerInstanceId: string;
    device: HrtDeviceRef;
    scope: {
        storeId: string;
        terminalId: string;
    };
    sequence: number;
    timestamp: string;
    expiresAt: string;
    state: "DISPLAY" | "CLEAR";
    payload: Record<string, HrtJsonValue>;
}
export interface HrtHealthSnapshotPayload {
    providerHealth: HrtProviderHealth;
    providerInstanceId: string;
    timestamp: string;
    devices: Array<{
        device: HrtDeviceRef;
        health: HrtDeviceHealth;
        capabilities: HrtCapability[];
    }>;
}
export interface HrtDiagnosticPayload {
    diagnosticCode: string;
    severity: HrtDiagnosticSeverity;
    reason: string;
    redactedDetails: Record<string, HrtJsonValue>;
    correlationId: string;
    providerInstanceId: string;
    timestamp: string;
}
//# sourceMappingURL=types.d.ts.map