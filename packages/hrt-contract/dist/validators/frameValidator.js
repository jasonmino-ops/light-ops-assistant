"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFrame = validateFrame;
exports.validateCommandRequestPayload = validateCommandRequestPayload;
exports.validateProviderRegistrationPayload = validateProviderRegistrationPayload;
exports.validateHandshakeRequestPayload = validateHandshakeRequestPayload;
exports.evaluateCompatibility = evaluateCompatibility;
exports.validateCompatibilityResultPayload = validateCompatibilityResultPayload;
exports.validateHandshakeResponsePayload = validateHandshakeResponsePayload;
exports.validateCommandResultPayload = validateCommandResultPayload;
exports.validateScannerEventPayload = validateScannerEventPayload;
exports.validateCustomerDisplaySnapshotPayload = validateCustomerDisplaySnapshotPayload;
exports.validateHealthSnapshotPayload = validateHealthSnapshotPayload;
exports.validateDiagnosticPayload = validateDiagnosticPayload;
exports.assertValidFrame = assertValidFrame;
exports.assertValidCommandRequest = assertValidCommandRequest;
exports.assertValidCommandResult = assertValidCommandResult;
exports.assertValidProviderRegistration = assertValidProviderRegistration;
exports.assertValidHandshakeRequest = assertValidHandshakeRequest;
exports.assertValidHandshakeResponse = assertValidHandshakeResponse;
exports.assertValidScannerEvent = assertValidScannerEvent;
exports.assertValidCustomerDisplaySnapshot = assertValidCustomerDisplaySnapshot;
exports.assertValidHealthSnapshot = assertValidHealthSnapshot;
exports.assertValidDiagnostic = assertValidDiagnostic;
const types_1 = require("../types");
const messageTypes = new Set([
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
const outcomes = new Set(["SUCCEEDED", "FAILED", "REJECTED", "TIMED_OUT", "CANCELLED", "UNKNOWN"]);
const boundaries = new Set(["NOT_CROSSED", "CROSSING_UNKNOWN", "CROSSED"]);
const deviceKinds = new Set(["PRINTER", "SCANNER", "CUSTOMER_DISPLAY"]);
const commandTypes = new Set([
    "PRINT_RECEIPT",
    "OPEN_ATTACHED_CASH_DRAWER",
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
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireString(value, field, errors) {
    if (typeof value !== "string" || value.length === 0) {
        errors.push(`${field} must be a non-empty string`);
    }
}
function requireArray(value, field, errors) {
    if (!Array.isArray(value)) {
        errors.push(`${field} must be an array`);
        return [];
    }
    return value;
}
function requireScope(value, field, errors) {
    if (!isRecord(value)) {
        errors.push(`${field} must be an object`);
        return;
    }
    requireString(value.storeId, `${field}.storeId`, errors);
    requireString(value.terminalId, `${field}.terminalId`, errors);
}
function requireDevice(value, field, errors) {
    if (!isRecord(value)) {
        errors.push(`${field} must be an object`);
        return;
    }
    requireString(value.deviceId, `${field}.deviceId`, errors);
    if (typeof value.deviceKind !== "string" || !deviceKinds.has(value.deviceKind)) {
        errors.push(`${field}.deviceKind is not supported`);
    }
}
function requireCapabilities(value, field, errors) {
    for (const capability of requireArray(value, field, errors)) {
        if (typeof capability !== "string" || !capabilities.has(capability)) {
            errors.push(`${field} contains unsupported capability`);
        }
    }
}
function compareSemver(left, right) {
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
function validateFrame(value) {
    const errors = [];
    if (!isRecord(value)) {
        return { ok: false, errors: ["frame must be an object"] };
    }
    requireString(value.contractVersion, "contractVersion", errors);
    if (value.contractVersion !== types_1.HRT_CONTRACT_VERSION) {
        errors.push(`contractVersion must be ${types_1.HRT_CONTRACT_VERSION}`);
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
function validateCommandRequestPayload(value) {
    const errors = [];
    if (!isRecord(value)) {
        return { ok: false, errors: ["command request payload must be an object"] };
    }
    requireString(value.commandId, "commandId", errors);
    requireString(value.idempotencyKey, "idempotencyKey", errors);
    if (!isRecord(value.device)) {
        errors.push("device must be an object");
    }
    else {
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
function validateProviderRegistrationPayload(value) {
    const errors = [];
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
    }
    else {
        requireString(value.platform.os, "platform.os", errors);
        requireString(value.platform.arch, "platform.arch", errors);
    }
    if (!isRecord(value.process)) {
        errors.push("process must be an object");
    }
    else {
        if (!Number.isInteger(value.process.pid)) {
            errors.push("process.pid must be an integer");
        }
        requireString(value.process.startedAt, "process.startedAt", errors);
    }
    return { ok: errors.length === 0, errors };
}
function validateHandshakeRequestPayload(value) {
    const errors = [];
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
    }
    else {
        requireString(value.compatibilityMatrix.providerId, "compatibilityMatrix.providerId", errors);
        requireString(value.compatibilityMatrix.minProviderVersion, "compatibilityMatrix.minProviderVersion", errors);
        requireString(value.compatibilityMatrix.maxProviderVersionExclusive, "compatibilityMatrix.maxProviderVersionExclusive", errors);
        requireCapabilities(value.compatibilityMatrix.requiredCapabilities, "compatibilityMatrix.requiredCapabilities", errors);
    }
    return { ok: errors.length === 0, errors };
}
function evaluateCompatibility(registration, requiredCapabilities = types_1.HRT_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities) {
    const matrix = {
        providerId: types_1.HRT_PROVIDER_COMPATIBILITY_MATRIX.providerId,
        minProviderVersion: types_1.HRT_PROVIDER_COMPATIBILITY_MATRIX.minProviderVersion,
        maxProviderVersionExclusive: types_1.HRT_PROVIDER_COMPATIBILITY_MATRIX.maxProviderVersionExclusive,
        requiredCapabilities: [...requiredCapabilities],
    };
    const missingCapabilities = requiredCapabilities.filter((capability) => !registration.supportedCapabilities.includes(capability));
    let reason = "OK";
    if (registration.contractVersion !== types_1.HRT_CONTRACT_VERSION) {
        reason = "INCOMPATIBLE_CONTRACT_VERSION";
    }
    else if (compareSemver(registration.providerVersion, matrix.minProviderVersion) < 0 ||
        compareSemver(registration.providerVersion, matrix.maxProviderVersionExclusive) >= 0) {
        reason = "UNSUPPORTED_PROVIDER_VERSION";
    }
    else if (missingCapabilities.length > 0) {
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
function validateCompatibilityResultPayload(value) {
    const errors = [];
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
function validateHandshakeResponsePayload(value) {
    const errors = [];
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
function validateCommandResultPayload(value) {
    const errors = [];
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
function validateScannerEventPayload(value) {
    const errors = [];
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
function validateCustomerDisplaySnapshotPayload(value) {
    const errors = [];
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
function validateHealthSnapshotPayload(value) {
    const errors = [];
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
function validateDiagnosticPayload(value) {
    const errors = [];
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
    }
    else if ("secret" in value.redactedDetails || "password" in value.redactedDetails || "token" in value.redactedDetails) {
        errors.push("redactedDetails must not include secret values");
    }
    requireString(value.correlationId, "correlationId", errors);
    requireString(value.providerInstanceId, "providerInstanceId", errors);
    requireString(value.timestamp, "timestamp", errors);
    return { ok: errors.length === 0, errors };
}
function assertValidFrame(frame) {
    const result = validateFrame(frame);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidCommandRequest(payload) {
    const result = validateCommandRequestPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidCommandResult(payload) {
    const result = validateCommandResultPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidProviderRegistration(payload) {
    const result = validateProviderRegistrationPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidHandshakeRequest(payload) {
    const result = validateHandshakeRequestPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidHandshakeResponse(payload) {
    const result = validateHandshakeResponsePayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidScannerEvent(payload) {
    const result = validateScannerEventPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidCustomerDisplaySnapshot(payload) {
    const result = validateCustomerDisplaySnapshotPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidHealthSnapshot(payload) {
    const result = validateHealthSnapshotPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
function assertValidDiagnostic(payload) {
    const result = validateDiagnosticPayload(payload);
    if (!result.ok) {
        throw new Error(result.errors.join("; "));
    }
}
//# sourceMappingURL=frameValidator.js.map