import {
  HRT_CONTRACT_VERSION,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtFrame,
  HrtMessageType,
} from "../types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const messageTypes: ReadonlySet<string> = new Set<HrtMessageType>([
  "provider.register",
  "provider.ready",
  "provider.rejected",
  "command.request",
  "command.result",
  "device.event",
  "health.snapshot",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${field} must be a non-empty string`);
  }
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
