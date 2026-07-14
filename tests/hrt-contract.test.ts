import assert from "node:assert/strict";
import {
  HRT_CONTRACT_VERSION,
  customerDisplaySnapshotFixture,
  diagnosticFixture,
  evaluateCompatibility,
  handshakeRequestFixture,
  handshakeResponseFixture,
  healthSnapshotFixture,
  invalidMissingCorrelationFrameFixture,
  printReceiptCommandFixture,
  providerRegistrationFixture,
  scannerEventFixture,
  succeededCommandResultFixture,
  unknownCommandResultFixture,
  validateCommandRequestPayload,
  validateCommandResultPayload,
  validateCompatibilityResultPayload,
  validateCustomerDisplaySnapshotPayload,
  validateDiagnosticPayload,
  validateFrame,
  validateHandshakeRequestPayload,
  validateHandshakeResponsePayload,
  validateHealthSnapshotPayload,
  validateProviderRegistrationPayload,
  validateScannerEventPayload,
} from "@eshop/hrt-contract";
import { ProviderSimulator } from "../packages/hrt-provider-simulator/src";

assert.equal(providerRegistrationFixture.contractVersion, HRT_CONTRACT_VERSION);
assert.equal(validateFrame(providerRegistrationFixture).ok, true);
assert.equal(validateFrame(handshakeRequestFixture).ok, true);
assert.equal(validateFrame(handshakeResponseFixture).ok, true);
assert.equal(validateFrame(printReceiptCommandFixture).ok, true);
assert.equal(validateFrame(succeededCommandResultFixture).ok, true);
assert.equal(validateFrame(unknownCommandResultFixture).ok, true);
assert.equal(validateFrame(scannerEventFixture).ok, true);
assert.equal(validateFrame(customerDisplaySnapshotFixture).ok, true);
assert.equal(validateFrame(healthSnapshotFixture).ok, true);
assert.equal(validateFrame(diagnosticFixture).ok, true);

assert.equal(validateProviderRegistrationPayload(providerRegistrationFixture.payload).ok, true);
assert.equal(validateHandshakeRequestPayload(handshakeRequestFixture.payload).ok, true);
assert.equal(validateHandshakeResponsePayload(handshakeResponseFixture.payload).ok, true);
assert.equal(validateCommandRequestPayload(printReceiptCommandFixture.payload).ok, true);
assert.equal(validateCommandResultPayload(succeededCommandResultFixture.payload).ok, true);
assert.equal(validateCommandResultPayload(unknownCommandResultFixture.payload).ok, true);
assert.equal(validateScannerEventPayload(scannerEventFixture.payload).ok, true);
assert.equal(validateCustomerDisplaySnapshotPayload(customerDisplaySnapshotFixture.payload).ok, true);
assert.equal(validateHealthSnapshotPayload(healthSnapshotFixture.payload).ok, true);
assert.equal(validateDiagnosticPayload(diagnosticFixture.payload).ok, true);

assert.equal(validateFrame(invalidMissingCorrelationFrameFixture).ok, false);
assert.equal(validateFrame({ ...providerRegistrationFixture, messageType: "unsupported" }).ok, false);
assert.equal(validateFrame({ ...providerRegistrationFixture, instanceId: "" }).ok, false);
assert.equal(validateProviderRegistrationPayload({ ...providerRegistrationFixture.payload, providerInstanceId: "" }).ok, false);
assert.equal(validateHandshakeRequestPayload({ ...handshakeRequestFixture.payload, initiatedBy: "PROVIDER" }).ok, false);
assert.equal(validateCommandResultPayload({ ...succeededCommandResultFixture.payload, outcome: "MAYBE" }).ok, false);
assert.equal(validateDiagnosticPayload({ ...diagnosticFixture.payload, redactedDetails: { token: "secret" } }).ok, false);

const simulator = new ProviderSimulator({
  providerInstanceId: "provider-sim-test",
  startedAt: "2026-07-14T16:00:00.000Z",
});
const registration = simulator.register();
assert.equal(registration.contractVersion, HRT_CONTRACT_VERSION);
assert.equal(validateProviderRegistrationPayload(registration).ok, true);
assert.deepEqual(registration.supportedCapabilities.sort(), [
  "customer_display.snapshot",
  "printer.cash_drawer_pulse",
  "printer.receipt",
  "scanner.barcode_event",
].sort());

const compatibility = evaluateCompatibility(registration);
assert.equal(validateCompatibilityResultPayload(compatibility).ok, true);
assert.equal(compatibility.status, "COMPATIBLE");
assert.equal(compatibility.reason, "OK");

const incompatibleContract = new ProviderSimulator({ contractVersion: "0.0.0" }).register();
const incompatibleContractResult = evaluateCompatibility(incompatibleContract);
assert.equal(incompatibleContractResult.status, "INCOMPATIBLE");
assert.equal(incompatibleContractResult.reason, "INCOMPATIBLE_CONTRACT_VERSION");

const unsupportedProvider = new ProviderSimulator({ providerVersion: "9.0.0" }).register();
const unsupportedProviderResult = evaluateCompatibility(unsupportedProvider);
assert.equal(unsupportedProviderResult.status, "INCOMPATIBLE");
assert.equal(unsupportedProviderResult.reason, "UNSUPPORTED_PROVIDER_VERSION");

const missingCapability = new ProviderSimulator({
  capabilities: ["printer.receipt", "scanner.barcode_event"],
}).register();
const missingCapabilityResult = evaluateCompatibility(missingCapability);
assert.equal(missingCapabilityResult.status, "INCOMPATIBLE");
assert.equal(missingCapabilityResult.reason, "MISSING_REQUIRED_CAPABILITY");
assert.deepEqual(missingCapabilityResult.missingCapabilities, ["customer_display.snapshot"]);

const handshake = simulator.handshake(handshakeRequestFixture.payload);
assert.equal(handshake.readyTransition, "RUNTIME_AUTHORIZED");
assert.equal(handshake.compatibility.status, "COMPATIBLE");
assert.equal(validateHandshakeResponsePayload(handshake).ok, true);

assert.throws(() => simulator.duplicateRegistration(), /DUPLICATE_REGISTRATION/);
const oldInstance = simulator.providerInstanceId;
simulator.restart("provider-sim-restarted");
assert.notEqual(simulator.providerInstanceId, oldInstance);
assert.equal(simulator.healthSnapshot().providerHealth, "STARTING");

const result = simulator.execute(printReceiptCommandFixture.payload);
assert.equal(result.outcome, "SUCCEEDED");
assert.equal(result.effectBoundary, "CROSSED");

const unknown = simulator.execute(printReceiptCommandFixture.payload, "unknown");
assert.equal(unknown.outcome, "UNKNOWN");
assert.equal(unknown.effectBoundary, "MAY_HAVE_CROSSED");
assert.equal(simulator.shouldRetryBlindly(unknown), false);

const disconnectDuringCommand = simulator.execute(printReceiptCommandFixture.payload, "disconnect-during-command");
assert.equal(disconnectDuringCommand.outcome, "UNKNOWN");
assert.equal(disconnectDuringCommand.effectBoundary, "MAY_HAVE_CROSSED");
assert.equal(simulator.providerHealth, "DISCONNECTED");

const timeout = simulator.execute(printReceiptCommandFixture.payload, "timeout-uncertain");
assert.equal(timeout.outcome, "UNKNOWN");
assert.equal(timeout.effectBoundary, "MAY_HAVE_CROSSED");

const scannerEvent = simulator.scanBarcode("scanner-sim-001", "1234567890", { eventId: "scan-same" });
assert.equal(scannerEvent.eventType, "BARCODE_SCANNED");
assert.equal(scannerEvent.data.barcode, "1234567890");
assert.equal(simulator.acceptScannerEvent(scannerEvent), true);
assert.equal(simulator.acceptScannerEvent(scannerEvent), false);
assert.equal(scannerEvent.monotonicSequence, 1);

const staleScanner = simulator.scanBarcode("scanner-sim-001", "1234567890", {
  eventId: "scan-stale",
  providerInstanceId: "old-instance",
});
assert.equal(simulator.acceptScannerEvent(staleScanner), false);

const wrongScopeScanner = simulator.scanBarcode("scanner-sim-001", "1234567890", {
  eventId: "scan-wrong-scope",
  scope: { storeId: "OTHER", terminalId: "terminal-001" },
});
assert.equal(simulator.acceptScannerEvent(wrongScopeScanner), false);
assert.throws(() => simulator.scanBarcode("scanner-sim-001", "1234567890", { omitDeviceIdentity: true }), /device.deviceId/);

const displayOne = simulator.displaySnapshot(1);
const displayTwo = simulator.displaySnapshot(2);
assert.deepEqual(simulator.applyDisplaySnapshot(displayOne), { accepted: true, reason: "ACCEPTED" });
assert.deepEqual(simulator.applyDisplaySnapshot(displayTwo), { accepted: true, reason: "ACCEPTED" });
assert.deepEqual(simulator.applyDisplaySnapshot(displayOne), { accepted: false, reason: "OLDER_SEQUENCE" });
assert.deepEqual(
  simulator.applyDisplaySnapshot(simulator.displaySnapshot(3, { scope: { storeId: "OTHER", terminalId: "terminal-001" } })),
  { accepted: false, reason: "WRONG_SCOPE" },
);
assert.deepEqual(
  simulator.applyDisplaySnapshot(simulator.displaySnapshot(3, { expiresAt: "2026-07-14T15:00:00.000Z" })),
  { accepted: false, reason: "EXPIRED" },
);
assert.equal(simulator.reconnectDisplay("2026-07-14T16:01:00.000Z")?.sequence, 2);
assert.equal(simulator.reconnectDisplay("2026-07-14T16:06:00.000Z"), null);
const clearDisplay = simulator.displaySnapshot(4, { state: "CLEAR", payload: {} });
assert.equal(clearDisplay.state, "CLEAR");

const health = new ProviderSimulator({ providerHealth: "READY", deviceHealth: "UNKNOWN" }).healthSnapshot();
assert.equal(health.providerHealth, "READY");
assert.equal(health.devices[0].health, "UNKNOWN");
assert.notEqual(health.providerHealth, health.devices[0].health);

const diagnostic = simulator.diagnostic("corr-diag-test", "WARN");
assert.equal(validateDiagnosticPayload(diagnostic).ok, true);

console.log("hrt contract tests passed");
