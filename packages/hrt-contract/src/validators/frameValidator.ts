import {
  HRT_PROVIDER_COMPATIBILITY_MATRIX,
  HRT_CONTRACT_VERSION,
  HrtCapability,
  HrtCompatibilityResultPayload,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtCustomerDisplaySnapshotPayload,
  HrtDeviceEventPayload,
  HrtDiagnosticPayload,
  HrtFrame,
  HrtHandshakeRequestPayload,
  HrtHandshakeResponsePayload,
  HrtHealthSnapshotPayload,
  HrtMessageType,
  HrtProviderRegistrationPayload,
} from "../types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const messageTypes: ReadonlySet<string> = new Set<HrtMessageType>([
  "runtime.handshake.request",
  "provider.handshake.response",
  "provider.register",
  "provider.ready",
  "provider.rejected",
  "provider.disconnect",
  "provider.restart",
  "provider.shutdown",
  "command.request",
  "command.result",
  "device.event",
  "display.snapshot",
  "health.snapshot",
  "diagnostic.report",
]);

const outcomes = new Set(["SUCCEEDED", "FAILED", "REJECTED", "TIMEOUT", "CANCELLED", "UNKNOWN"]);
const boundaries = new Set(["NOT_CROSSED", "MAY_HAVE_CROSSED", "CROSSED"]);
const deviceKinds = new Set(["PRINTER", "SCANNER", "CUSTOMER_DISPLAY"]);
const commandTypes = new Set([
  "PRINT_RECEIPT",
  "OPEN_CASH_DRAWER",
  "SET_SCANNER_ENABLED",
  "DISPLAY_SNAPSHOT",
  "CLEAR_DISPLAY",
]);
const capabilities = new Set([
  "printer.receipt",
  "printer.cash_drawer_pulse",
  "scanner.barcode_event",
  "customer_display.snapshot",
]);
const commandFamilies = new Set(["printer", "scanner", "customer_display"]);
const eventFamilies = new Set(["scanner", "health", "diagnostics"]);
const compatibilityStatuses = new Set(["COMPATIBLE", "INCOMPATIBLE"]);
const compatibilityReasons = new Set([
  "OK",
  "INCOMPATIBLE_CONTRACT_VERSION",
  "UNSUPPORTED_PROVIDER_VERSION",
  "MISSING_REQUIRED_CAPABILITY",
]);
const providerHealthValues = new Set(["UNKNOWN", "STARTING", "READY", "DEGRADED", "DISCONNECTED", "SHUTDOWN"]);
const deviceHealthValues = new Set(["UNKNOWN", "ONLINE", "DEGRADED", "OFFLINE"]);
const diagnosticSeverities = new Set(["INFO", "WARN", "ERROR"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${field} must be a non-empty string`);
  }
}

function requireArray(value: unknown, field: string, errors: string[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  return value;
}

function requireScope(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  requireString(value.storeId, `${field}.storeId`, errors);
  requireString(value.terminalId, `${field}.terminalId`, errors);
}

function requireDevice(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  requireString(value.deviceId, `${field}.deviceId`, errors);
  if (typeof value.deviceKind !== "string" || !deviceKinds.has(value.deviceKind)) {
    errors.push(`${field}.deviceKind is not supported`);
  }
}

function requireCapabilities(value: unknown, field: string, errors: string[]): void {
  for (const capability of requireArray(value, field, errors)) {
    if (typeof capability !== "string" || !capabilities.has(capability)) {
      errors.push(`${field} contains unsupported capability`);
    }
  }
}

function compareSemver(left: string, right: string): number {
  const l = left.split(".").map((part) => Number.parseInt(part, 10));
  const r = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(l.length, r.length); index += 1) {
    const lv = Number.isFinite(l[index]) ? l[index] : 0;
    const rv = Number.isFinite(r[index]) ? r[index] : 0;
    if (lv !== rv) {
      return lv > rv ? 1 : -1;
    }
  }
  return 0;
}

export function validateFrame(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["frame must be an object"] };
  }

  requireString(value.contractVersion, "contractVersion", errors);
  if (value.contractVersion !== HRT_CONTRACT_VERSION) {
    errors.push(`contractVersion must be ${HRT_CONTRACT_VERSION}`);
  }
  if (typeof value.messageType !== "string" || !messageTypes.has(value.messageType)) {
    errors.push("messageType is not supported");
  }
  requireString(value.correlationId, "correlationId", errors);
  requireString(value.instanceId, "instanceId", errors);
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 0) {
    errors.push("sequence must be a non-negative integer");
  }
  requireString(value.timestamp, "timestamp", errors);
  if (!("payload" in value)) {
    errors.push("payload is required");
  }

  return { ok: errors.length === 0, errors };
}

export function validateCommandRequestPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["command request payload must be an object"] };
  }
  requireString(value.commandId, "commandId", errors);
  requireString(value.idempotencyKey, "idempotencyKey", errors);
  if (!isRecord(value.device)) {
    errors.push("device must be an object");
  } else {
    requireString(value.device.deviceId, "device.deviceId", errors);
    if (typeof value.device.deviceKind !== "string" || !deviceKinds.has(value.device.deviceKind)) {
      errors.push("device.deviceKind is not supported");
    }
  }
  if (typeof value.commandType !== "string" || !commandTypes.has(value.commandType)) {
    errors.push("commandType is not supported");
  }
  if (!isRecord(value.params)) {
    errors.push("params must be an object");
  }
  return { ok: errors.length === 0, errors };
}

export function validateProviderRegistrationPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["provider registration payload must be an object"] };
  }
  requireString(value.providerId, "providerId", errors);
  requireString(value.providerInstanceId, "providerInstanceId", errors);
  requireString(value.providerVersion, "providerVersion", errors);
  requireString(value.contractVersion, "contractVersion", errors);
  requireCapabilities(value.supportedCapabilities, "supportedCapabilities", errors);
  for (const descriptor of requireArray(value.capabilityDescriptors, "capabilityDescriptors", errors)) {
    if (!isRecord(descriptor)) {
      errors.push("capabilityDescriptors entries must be objects");
      continue;
    }
    if (typeof descriptor.capabilityId !== "string" || !capabilities.has(descriptor.capabilityId)) {
      errors.push("capabilityDescriptors.capabilityId is not supported");
    }
    requireString(descriptor.capabilityVersion, "capabilityDescriptors.capabilityVersion", errors);
    for (const family of requireArray(descriptor.supportedCommandFamilies, "capabilityDescriptors.supportedCommandFamilies", errors)) {
      if (typeof family !== "string" || !commandFamilies.has(family)) {
        errors.push("capabilityDescriptors.supportedCommandFamilies contains unsupported family");
      }
    }
    for (const family of requireArray(descriptor.supportedEventFamilies, "capabilityDescriptors.supportedEventFamilies", errors)) {
      if (typeof family !== "string" || !eventFamilies.has(family)) {
        errors.push("capabilityDescriptors.supportedEventFamilies contains unsupported family");
      }
    }
  }
  if (!isRecord(value.platform)) {
    errors.push("platform must be an object");
  } else {
    requireString(value.platform.os, "platform.os", errors);
    requireString(value.platform.arch, "platform.arch", errors);
  }
  if (!isRecord(value.process)) {
    errors.push("process must be an object");
  } else {
    if (!Number.isInteger(value.process.pid)) {
      errors.push("process.pid must be an integer");
    }
    requireString(value.process.startedAt, "process.startedAt", errors);
  }
  return { ok: errors.length === 0, errors };
}

export function validateHandshakeRequestPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["handshake request payload must be an object"] };
  }
  requireString(value.runtimeInstanceId, "runtimeInstanceId", errors);
  requireString(value.requiredContractVersion, "requiredContractVersion", errors);
  requireCapabilities(value.requiredCapabilities, "requiredCapabilities", errors);
  if (value.initiatedBy !== "RUNTIME") {
    errors.push("initiatedBy must be RUNTIME");
  }
  if (!isRecord(value.compatibilityMatrix)) {
    errors.push("compatibilityMatrix must be an object");
  } else {
    requireString(value.compatibilityMatrix.providerId, "compatibilityMatrix.providerId", errors);
    requireString(value.compatibilityMatrix.minProviderVersion, "compatibilityMatrix.minProviderVersion", errors);
    requireString(value.compatibilityMatrix.maxProviderVersionExclusive, "compatibilityMatrix.maxProviderVersionExclusive", errors);
    requireCapabilities(value.compatibilityMatrix.requiredCapabilities, "compatibilityMatrix.requiredCapabilities", errors);
  }
  return { ok: errors.length === 0, errors };
}

export function evaluateCompatibility(
  registration: HrtProviderRegistrationPayload,
  requiredCapabilities: readonly HrtCapability[] = HRT_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities,
): HrtCompatibilityResultPayload {
  const matrix = {
    providerId: HRT_PROVIDER_COMPATIBILITY_MATRIX.providerId,
    minProviderVersion: HRT_PROVIDER_COMPATIBILITY_MATRIX.minProviderVersion,
    maxProviderVersionExclusive: HRT_PROVIDER_COMPATIBILITY_MATRIX.maxProviderVersionExclusive,
    requiredCapabilities: [...requiredCapabilities],
  };
  const missingCapabilities = requiredCapabilities.filter(
    (capability) => !registration.supportedCapabilities.includes(capability),
  );
  let reason: HrtCompatibilityResultPayload["reason"] = "OK";
  if (registration.contractVersion !== HRT_CONTRACT_VERSION) {
    reason = "INCOMPATIBLE_CONTRACT_VERSION";
  } else if (
    compareSemver(registration.providerVersion, matrix.minProviderVersion) < 0 ||
    compareSemver(registration.providerVersion, matrix.maxProviderVersionExclusive) >= 0
  ) {
    reason = "UNSUPPORTED_PROVIDER_VERSION";
  } else if (missingCapabilities.length > 0) {
    reason = "MISSING_REQUIRED_CAPABILITY";
  }
  return {
    status: reason === "OK" ? "COMPATIBLE" : "INCOMPATIBLE",
    reason,
    providerId: registration.providerId,
    providerInstanceId: registration.providerInstanceId,
    providerVersion: registration.providerVersion,
    contractVersion: registration.contractVersion,
    missingCapabilities,
    matrix,
  };
}

export function validateCompatibilityResultPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["compatibility result payload must be an object"] };
  }
  if (typeof value.status !== "string" || !compatibilityStatuses.has(value.status)) {
    errors.push("status is not supported");
  }
  if (typeof value.reason !== "string" || !compatibilityReasons.has(value.reason)) {
    errors.push("reason is not supported");
  }
  requireString(value.providerId, "providerId", errors);
  requireString(value.providerInstanceId, "providerInstanceId", errors);
  requireString(value.providerVersion, "providerVersion", errors);
  requireString(value.contractVersion, "contractVersion", errors);
  requireCapabilities(value.missingCapabilities, "missingCapabilities", errors);
  return { ok: errors.length === 0, errors };
}

export function validateHandshakeResponsePayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["handshake response payload must be an object"] };
  }
  const provider = validateProviderRegistrationPayload(value.provider);
  errors.push(...provider.errors.map((error) => `provider.${error}`));
  const compatibility = validateCompatibilityResultPayload(value.compatibility);
  errors.push(...compatibility.errors.map((error) => `compatibility.${error}`));
  if (value.readyTransition !== "RUNTIME_AUTHORIZED" && value.readyTransition !== "REJECTED") {
    errors.push("readyTransition is not supported");
  }
  return { ok: errors.length === 0, errors };
}

export function validateCommandResultPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["command result payload must be an object"] };
  }
  requireString(value.commandId, "commandId", errors);
  if (typeof value.outcome !== "string" || !outcomes.has(value.outcome)) {
    errors.push("outcome is not one of the six frozen values");
  }
  if (typeof value.effectBoundary !== "string" || !boundaries.has(value.effectBoundary)) {
    errors.push("effectBoundary is not supported");
  }
  requireString(value.providerInstanceId, "providerInstanceId", errors);
  return { ok: errors.length === 0, errors };
}

export function validateScannerEventPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["scanner event payload must be an object"] };
  }
  requireString(value.eventId, "eventId", errors);
  requireDevice(value.device, "device", errors);
  if (value.eventType !== "BARCODE_SCANNED") {
    errors.push("eventType is not supported");
  }
  if (!Number.isInteger(value.monotonicSequence) || Number(value.monotonicSequence) < 0) {
    errors.push("monotonicSequence must be a non-negative integer");
  }
  requireString(value.providerInstanceId, "providerInstanceId", errors);
  requireScope(value.scope, "scope", errors);
  if (!isRecord(value.data)) {
    errors.push("data must be an object");
  }
  return { ok: errors.length === 0, errors };
}

export function validateCustomerDisplaySnapshotPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["customer display snapshot payload must be an object"] };
  }
  requireString(value.snapshotId, "snapshotId", errors);
  requireString(value.providerInstanceId, "providerInstanceId", errors);
  requireDevice(value.device, "device", errors);
  requireScope(value.scope, "scope", errors);
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 0) {
    errors.push("sequence must be a non-negative integer");
  }
  requireString(value.timestamp, "timestamp", errors);
  requireString(value.expiresAt, "expiresAt", errors);
  if (value.state !== "DISPLAY" && value.state !== "CLEAR") {
    errors.push("state is not supported");
  }
  if (!isRecord(value.payload)) {
    errors.push("payload must be an object");
  }
  return { ok: errors.length === 0, errors };
}

export function validateHealthSnapshotPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["health snapshot payload must be an object"] };
  }
  if (typeof value.providerHealth !== "string" || !providerHealthValues.has(value.providerHealth)) {
    errors.push("providerHealth is not supported");
  }
  requireString(value.providerInstanceId, "providerInstanceId", errors);
  requireString(value.timestamp, "timestamp", errors);
  for (const device of requireArray(value.devices, "devices", errors)) {
    if (!isRecord(device)) {
      errors.push("devices entries must be objects");
      continue;
    }
    requireDevice(device.device, "devices.device", errors);
    if (typeof device.health !== "string" || !deviceHealthValues.has(device.health)) {
      errors.push("devices.health is not supported");
    }
    requireCapabilities(device.capabilities, "devices.capabilities", errors);
  }
  return { ok: errors.length === 0, errors };
}

export function validateDiagnosticPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["diagnostic payload must be an object"] };
  }
  requireString(value.diagnosticCode, "diagnosticCode", errors);
  if (typeof value.severity !== "string" || !diagnosticSeverities.has(value.severity)) {
    errors.push("severity is not supported");
  }
  requireString(value.reason, "reason", errors);
  if (!isRecord(value.redactedDetails)) {
    errors.push("redactedDetails must be an object");
  } else if ("secret" in value.redactedDetails || "password" in value.redactedDetails || "token" in value.redactedDetails) {
    errors.push("redactedDetails must not include secret values");
  }
  requireString(value.correlationId, "correlationId", errors);
  requireString(value.providerInstanceId, "providerInstanceId", errors);
  requireString(value.timestamp, "timestamp", errors);
  return { ok: errors.length === 0, errors };
}

export function assertValidFrame<TPayload>(frame: HrtFrame<TPayload>): void {
  const result = validateFrame(frame);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidCommandRequest(payload: HrtCommandRequestPayload): void {
  const result = validateCommandRequestPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidCommandResult(payload: HrtCommandResultPayload): void {
  const result = validateCommandResultPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidProviderRegistration(payload: HrtProviderRegistrationPayload): void {
  const result = validateProviderRegistrationPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidHandshakeRequest(payload: HrtHandshakeRequestPayload): void {
  const result = validateHandshakeRequestPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidHandshakeResponse(payload: HrtHandshakeResponsePayload): void {
  const result = validateHandshakeResponsePayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidScannerEvent(payload: HrtDeviceEventPayload): void {
  const result = validateScannerEventPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidCustomerDisplaySnapshot(payload: HrtCustomerDisplaySnapshotPayload): void {
  const result = validateCustomerDisplaySnapshotPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidHealthSnapshot(payload: HrtHealthSnapshotPayload): void {
  const result = validateHealthSnapshotPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export function assertValidDiagnostic(payload: HrtDiagnosticPayload): void {
  const result = validateDiagnosticPayload(payload);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}
