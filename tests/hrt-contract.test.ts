import assert from "node:assert/strict";
import {
  HRT_CONTRACT_VERSION,
  printReceiptCommandFixture,
  providerRegistrationFixture,
  succeededCommandResultFixture,
  validateCommandRequestPayload,
  validateCommandResultPayload,
  validateFrame,
} from "../packages/hrt-contract/src";
import { ProviderSimulator } from "../packages/hrt-provider-simulator/src";

assert.equal(providerRegistrationFixture.contractVersion, HRT_CONTRACT_VERSION);
assert.equal(validateFrame(providerRegistrationFixture).ok, true);
assert.equal(validateFrame(printReceiptCommandFixture).ok, true);
assert.equal(validateCommandRequestPayload(printReceiptCommandFixture.payload).ok, true);
assert.equal(validateFrame(succeededCommandResultFixture).ok, true);
assert.equal(validateCommandResultPayload(succeededCommandResultFixture.payload).ok, true);

const badOutcome = {
  ...succeededCommandResultFixture.payload,
  outcome: "MAYBE",
};
assert.equal(validateCommandResultPayload(badOutcome).ok, false);

const simulator = new ProviderSimulator({
  providerInstanceId: "provider-sim-test",
  startedAt: "2026-07-14T16:00:00.000Z",
});
const registration = simulator.register();
assert.equal(registration.contractVersion, HRT_CONTRACT_VERSION);
assert.deepEqual(registration.supportedCapabilities.sort(), [
  "customer_display.snapshot",
  "printer.cash_drawer_pulse",
  "printer.receipt",
  "scanner.barcode_event",
].sort());

const result = simulator.execute(printReceiptCommandFixture.payload);
assert.equal(result.outcome, "SUCCEEDED");
assert.equal(result.effectBoundary, "CROSSED");

const event = simulator.scanBarcode("scanner-sim-001", "1234567890");
assert.equal(event.eventType, "BARCODE_SCANNED");
assert.equal(event.data.barcode, "1234567890");

