import { describe, expect, it } from "vitest";
import {
  HrtCapability,
  HrtCommandRequestPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from "@eshop/hrt-contract";
import { HrtDeviceRuntime, HrtRuntimeDiagnostics } from "../src/main/hrt";
import { createDeviceSlotReference } from "../src/main/hrt/deviceSlot";
import deviceRuntimeVectors from "../../packages/hrt-provider-simulator/fixtures/device-runtime-vectors.json";

const provider: HrtProviderRegistrationPayload = {
  providerId: "windows-provider-simulator",
  providerInstanceId: "provider-sim-001",
  providerVersion: "0.1.0",
  contractVersion: "1.0.0",
  supportedCapabilities: [
    "printer.receipt",
    "printer.cash_drawer_pulse",
    "scanner.barcode_event",
    "customer_display.snapshot",
  ],
  capabilityDescriptors: [],
  platform: { os: "simulator" as const, arch: "x64", runtime: "simulator" as const },
  process: { pid: 1, startedAt: "2026-07-14T16:00:00.000Z" },
};

function healthSnapshot(providerInstanceId = provider.providerInstanceId): HrtHealthSnapshotPayload {
  return {
    providerHealth: "READY",
    providerInstanceId,
    timestamp: "2026-07-14T16:00:06.000Z",
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

function healthSnapshotWithSecondPrinter(providerInstanceId = provider.providerInstanceId): HrtHealthSnapshotPayload {
  const snapshot = healthSnapshot(providerInstanceId);
  return {
    ...snapshot,
    devices: [
      ...snapshot.devices,
      {
        device: { deviceId: "printer-sim-002", deviceKind: "PRINTER", slotId: "backup-printer" },
        health: "ONLINE",
        capabilities: ["printer.receipt", "printer.cash_drawer_pulse"],
      },
    ],
  };
}

function printCommand(deviceId = "printer-sim-001"): HrtCommandRequestPayload {
  return {
    commandId: "cmd-print-001",
    idempotencyKey: "sale-record-001-print",
    device: { deviceId, deviceKind: "PRINTER", slotId: "receipt-printer" },
    commandType: "PRINT_RECEIPT",
    params: {},
  };
}

function commandFor(commandType: HrtCommandRequestPayload["commandType"], deviceId: string): HrtCommandRequestPayload {
  const deviceKind = commandType === "DISPLAY_SNAPSHOT" || commandType === "CLEAR_DISPLAY"
    ? "CUSTOMER_DISPLAY"
    : commandType === "SET_SCANNER_ENABLED"
      ? "SCANNER"
      : "PRINTER";
  const slotId = deviceKind === "CUSTOMER_DISPLAY"
    ? "customer-display"
    : deviceKind === "SCANNER"
      ? "barcode-scanner"
      : "receipt-printer";
  return {
    commandId: `cmd-${commandType.toLowerCase()}`,
    idempotencyKey: `test-${commandType.toLowerCase()}`,
    device: { deviceId, deviceKind, slotId },
    commandType,
    params: {},
  };
}

function createRuntime(options: { secondPrinter?: boolean } = {}) {
  const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
  runtime.authorizeProvider(provider);
  runtime.acceptHealthSnapshot(options.secondPrinter ? healthSnapshotWithSecondPrinter() : healthSnapshot());
  return runtime;
}

function registerSlot(runtime: HrtDeviceRuntime, args: {
  slotId: string;
  expectedDeviceKind: "PRINTER" | "SCANNER" | "CUSTOMER_DISPLAY";
  requiredCapabilities: HrtCapability[];
}) {
  runtime.registerSlot(createDeviceSlotReference({
    slotId: args.slotId,
    storeId: "STORE-A",
    terminalId: "terminal-001",
    expectedDeviceKind: args.expectedDeviceKind,
    requiredCapabilities: args.requiredCapabilities,
    revision: "vector-rev-1",
  }));
}

describe("Device Runtime MB-2B", () => {
  it("registers physical devices and keeps lifecycle dimensions separate", () => {
    const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
    runtime.authorizeProvider(provider);
    runtime.acceptHealthSnapshot(healthSnapshot());

    const printer = runtime.registry.getByProviderLocalDeviceId("printer-sim-001");

    expect(printer?.physicalIdentity.providerLocalDeviceId).toBe("printer-sim-001");
    expect(printer?.registrationState).toBe("REGISTERED");
    expect(printer?.assignmentState).toBe("UNASSIGNED");
    expect(printer?.ownershipState).toBe("VALID");
    expect(printer?.healthState).toBe("ONLINE");
  });

  it("assigns by slot reference and accepts eligible printer commands", () => {
    const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
    runtime.authorizeProvider(provider);
    runtime.acceptHealthSnapshot(healthSnapshot());
    const printer = runtime.registry.getByProviderLocalDeviceId("printer-sim-001")!;

    runtime.registerSlot(createDeviceSlotReference({
      slotId: "receipt-printer",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "PRINTER",
      requiredCapabilities: ["printer.receipt"],
      revision: "slot-rev-1",
    }));

    expect(runtime.assign({ slotId: "receipt-printer", physicalDeviceId: printer.physicalDeviceId }).accepted).toBe(true);
    expect(runtime.evaluateCommand(printCommand())).toMatchObject({ accepted: true, commandFamily: "printer" });
  });

  it("rejects unassigned, kind mismatch, and capability mismatch commands", () => {
    const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
    runtime.authorizeProvider(provider);
    runtime.acceptHealthSnapshot(healthSnapshot());
    const printer = runtime.registry.getByProviderLocalDeviceId("printer-sim-001")!;

    expect(runtime.evaluateCommand(printCommand())).toMatchObject({ accepted: false, reason: "UNASSIGNED_DEVICE" });

    runtime.registerSlot(createDeviceSlotReference({
      slotId: "scanner-slot",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "SCANNER",
      requiredCapabilities: ["scanner.barcode_event"],
    }));
    expect(runtime.assign({ slotId: "scanner-slot", physicalDeviceId: printer.physicalDeviceId })).toMatchObject({
      accepted: false,
      reason: "KIND_MISMATCH",
    });

    runtime.registerSlot(createDeviceSlotReference({
      slotId: "printer-with-display-cap",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "PRINTER",
      requiredCapabilities: ["customer_display.snapshot"],
    }));
    expect(runtime.assign({ slotId: "printer-with-display-cap", physicalDeviceId: printer.physicalDeviceId })).toMatchObject({
      accepted: false,
      reason: "CAPABILITY_MISMATCH",
    });
  });

  it("invalidates device ownership and assignment when provider becomes stale", () => {
    const diagnostics = new HrtRuntimeDiagnostics();
    const runtime = new HrtDeviceRuntime(diagnostics);
    runtime.authorizeProvider(provider);
    runtime.acceptHealthSnapshot(healthSnapshot());
    const printer = runtime.registry.getByProviderLocalDeviceId("printer-sim-001")!;
    runtime.registerSlot(createDeviceSlotReference({
      slotId: "receipt-printer",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "PRINTER",
      requiredCapabilities: ["printer.receipt"],
    }));
    runtime.assign({ slotId: "receipt-printer", physicalDeviceId: printer.physicalDeviceId });

    runtime.invalidateProviderInstance("provider-sim-001", "PROVIDER_RESTARTED");
    const stalePrinter = runtime.registry.get(printer.physicalDeviceId)!;

    expect(stalePrinter.registrationState).toBe("STALE");
    expect(stalePrinter.assignmentState).toBe("AWAITING_REBIND");
    expect(stalePrinter.ownershipState).toBe("STALE_PROVIDER");
    expect(runtime.evaluateCommand(printCommand())).toMatchObject({ accepted: false, reason: "STALE_PROVIDER_INSTANCE" });
    expect(diagnostics.list().map((event) => event.eventCode)).toContain("HRT_DEVICE_OWNERSHIP_INVALIDATED");
  });

  it("keeps cash drawer as printer attached action", () => {
    const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
    runtime.authorizeProvider(provider);
    runtime.acceptHealthSnapshot(healthSnapshot());
    const printer = runtime.registry.getByProviderLocalDeviceId("printer-sim-001")!;
    runtime.registerSlot(createDeviceSlotReference({
      slotId: "receipt-printer",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "PRINTER",
      requiredCapabilities: ["printer.cash_drawer_pulse"],
    }));
    runtime.assign({ slotId: "receipt-printer", physicalDeviceId: printer.physicalDeviceId });

    expect(runtime.evaluateCommand({
      ...printCommand(),
      commandType: "OPEN_ATTACHED_CASH_DRAWER",
    })).toMatchObject({
      accepted: true,
      requiredKind: "PRINTER",
      requiredCapability: "printer.cash_drawer_pulse",
    });
  });

  it("gates customer display commands by display assignment", () => {
    const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
    runtime.authorizeProvider(provider);
    runtime.acceptHealthSnapshot(healthSnapshot());
    const display = runtime.registry.getByProviderLocalDeviceId("display-sim-001")!;
    runtime.registerSlot(createDeviceSlotReference({
      slotId: "customer-display",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "CUSTOMER_DISPLAY",
      requiredCapabilities: ["customer_display.snapshot"],
    }));
    runtime.assign({ slotId: "customer-display", physicalDeviceId: display.physicalDeviceId });

    expect(runtime.evaluateCommand({
      commandId: "cmd-display-001",
      idempotencyKey: "display-snapshot-001",
      device: { deviceId: "display-sim-001", deviceKind: "CUSTOMER_DISPLAY", slotId: "customer-display" },
      commandType: "DISPLAY_SNAPSHOT",
      params: {},
    })).toMatchObject({
      accepted: true,
      commandFamily: "customer_display",
      requiredCapability: "customer_display.snapshot",
    });
  });

  it("executes every device runtime conformance vector against runtime methods", () => {
    let executed = 0;

    for (const vector of deviceRuntimeVectors.vectors) {
      executed += 1;
      const input = vector.input as Record<string, any>;
      const expectedStateChange = vector.expectedStateChange as Record<string, any> | undefined;

      switch (vector.id) {
        case "physical-identity-valid": {
          const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
          runtime.authorizeProvider(provider);
          runtime.acceptHealthSnapshot({
            providerHealth: "READY",
            providerInstanceId: provider.providerInstanceId,
            timestamp: "2026-07-14T16:00:06.000Z",
            devices: [{
              device: { deviceId: input.deviceId, deviceKind: input.deviceKind },
              health: "ONLINE",
              capabilities: input.capabilities,
            }],
          });
          const device = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          expect(vector.expectedDecision).toBe("ACCEPTED");
          expect(vector.expectedCode).toBe("REGISTERED");
          expect(device.registrationState).toBe(expectedStateChange?.registrationState);
          expect(device.ownershipState).toBe(expectedStateChange?.ownershipState);
          expect(device.healthState).toBe(expectedStateChange?.healthState);
          break;
        }
        case "physical-identity-invalid": {
          const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
          runtime.authorizeProvider(provider);
          expect(() => runtime.acceptHealthSnapshot({
            providerHealth: "READY",
            providerInstanceId: provider.providerInstanceId,
            timestamp: "2026-07-14T16:00:06.000Z",
            devices: [{
              device: { deviceId: input.deviceId, deviceKind: input.deviceKind },
              health: "ONLINE",
              capabilities: input.capabilities,
            }],
          })).toThrow(`Device registration rejected: ${vector.expectedCode}`);
          expect(vector.expectedDecision).toBe("REJECTED");
          break;
        }
        case "slot-reference-valid": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: input.expectedDeviceKind,
            requiredCapabilities: input.requiredCapabilities,
          });
          expect(runtime.listSlots().find((slot) => slot.slotId === input.slotId)).toBeTruthy();
          expect(vector.expectedDecision).toBe("ACCEPTED");
          expect(vector.expectedCode).toBe("SLOT_REFERENCE_REGISTERED");
          break;
        }
        case "assignment-accepted": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: input.expectedDeviceKind,
            requiredCapabilities: input.requiredCapabilities,
          });
          const device = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          const result = runtime.assign({ slotId: input.slotId, physicalDeviceId: device.physicalDeviceId });
          const assigned = runtime.registry.get(device.physicalDeviceId)!;
          expect(result.accepted).toBe(true);
          expect(vector.expectedDecision).toBe("ACCEPTED");
          expect(vector.expectedCode).toBe("ASSIGNED");
          expect(assigned.assignmentState).toBe(expectedStateChange?.assignmentState);
          expect(assigned.ownershipState).toBe(expectedStateChange?.ownershipState);
          break;
        }
        case "assignment-unknown-slot": {
          const runtime = createRuntime();
          const device = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          const result = runtime.assign({ slotId: input.slotId, physicalDeviceId: device.physicalDeviceId });
          expect(result).toMatchObject({ accepted: false, reason: vector.expectedCode });
          break;
        }
        case "assignment-unknown-device": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: "PRINTER",
            requiredCapabilities: ["printer.receipt"],
          });
          const result = runtime.assign({ slotId: input.slotId, physicalDeviceId: input.deviceId });
          expect(result).toMatchObject({ accepted: false, reason: vector.expectedCode });
          break;
        }
        case "kind-mismatch":
        case "capability-mismatch": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: input.expectedDeviceKind,
            requiredCapabilities: input.requiredCapabilities,
          });
          const device = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          const result = runtime.assign({ slotId: input.slotId, physicalDeviceId: device.physicalDeviceId });
          expect(result).toMatchObject({ accepted: false, reason: vector.expectedCode });
          break;
        }
        case "conflicting-slot-assignment": {
          const runtime = createRuntime({ secondPrinter: true });
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: input.expectedDeviceKind,
            requiredCapabilities: input.requiredCapabilities,
          });
          const first = runtime.registry.getByProviderLocalDeviceId(input.firstDeviceId)!;
          const second = runtime.registry.getByProviderLocalDeviceId(input.secondDeviceId)!;
          expect(runtime.assign({ slotId: input.slotId, physicalDeviceId: first.physicalDeviceId }).accepted).toBe(true);
          expect(runtime.assign({ slotId: input.slotId, physicalDeviceId: second.physicalDeviceId })).toMatchObject({
            accepted: false,
            reason: vector.expectedCode,
          });
          break;
        }
        case "conflicting-device-assignment": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.firstSlotId,
            expectedDeviceKind: input.expectedDeviceKind,
            requiredCapabilities: input.requiredCapabilities,
          });
          registerSlot(runtime, {
            slotId: input.secondSlotId,
            expectedDeviceKind: input.expectedDeviceKind,
            requiredCapabilities: input.requiredCapabilities,
          });
          const device = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          expect(runtime.assign({ slotId: input.firstSlotId, physicalDeviceId: device.physicalDeviceId }).accepted).toBe(true);
          expect(runtime.assign({ slotId: input.secondSlotId, physicalDeviceId: device.physicalDeviceId })).toMatchObject({
            accepted: false,
            reason: vector.expectedCode,
          });
          break;
        }
        case "stale-provider-ownership": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: "PRINTER",
            requiredCapabilities: ["printer.receipt"],
          });
          const device = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          runtime.assign({ slotId: input.slotId, physicalDeviceId: device.physicalDeviceId });
          runtime.invalidateProviderInstance(input.providerInstanceId, input.reason);
          const stale = runtime.registry.get(device.physicalDeviceId)!;
          const eligibility = runtime.evaluateCommand(printCommand(input.deviceId));
          expect(eligibility).toMatchObject({ accepted: false, reason: vector.expectedCode });
          expect(stale.registrationState).toBe(expectedStateChange?.registrationState);
          expect(stale.assignmentState).toBe(expectedStateChange?.assignmentState);
          expect(stale.ownershipState).toBe(expectedStateChange?.ownershipState);
          break;
        }
        case "unassigned-command-rejection": {
          const runtime = createRuntime();
          expect(runtime.evaluateCommand(commandFor(input.commandType, input.deviceId))).toMatchObject({
            accepted: false,
            reason: vector.expectedCode,
          });
          break;
        }
        case "eligible-printer-command":
        case "attached-cash-drawer-action": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: "PRINTER",
            requiredCapabilities: input.requiredCapabilities,
          });
          const device = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          runtime.assign({ slotId: input.slotId, physicalDeviceId: device.physicalDeviceId });
          const eligibility = runtime.evaluateCommand(commandFor(input.commandType, input.deviceId));
          expect(eligibility).toMatchObject({ accepted: true });
          expect(vector.expectedDecision).toBe("ACCEPTED");
          expect(vector.expectedCode).toBe("ELIGIBLE");
          if (expectedStateChange) {
            expect(eligibility.requiredKind).toBe(expectedStateChange.requiredKind);
            expect(eligibility.requiredCapability).toBe(expectedStateChange.requiredCapability);
          }
          break;
        }
        case "scanner-source-ownership":
        case "scanner-wrong-scope": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: "SCANNER",
            requiredCapabilities: ["scanner.barcode_event"],
          });
          const scanner = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          runtime.assign({ slotId: input.slotId, physicalDeviceId: scanner.physicalDeviceId });
          const reference = runtime.evaluateDeviceReference({
            deviceId: input.deviceId,
            providerInstanceId: provider.providerInstanceId,
            scope: input.scope,
          });
          if (vector.expectedDecision === "ACCEPTED") {
            expect(reference).toMatchObject({ accepted: true });
            expect(vector.expectedCode).toBe("SOURCE_ELIGIBLE");
          } else {
            expect(reference).toMatchObject({ accepted: false, reason: vector.expectedCode });
          }
          break;
        }
        case "display-target-valid":
        case "display-wrong-scope": {
          const runtime = createRuntime();
          registerSlot(runtime, {
            slotId: input.slotId,
            expectedDeviceKind: "CUSTOMER_DISPLAY",
            requiredCapabilities: ["customer_display.snapshot"],
          });
          const display = runtime.registry.getByProviderLocalDeviceId(input.deviceId)!;
          runtime.assign({ slotId: input.slotId, physicalDeviceId: display.physicalDeviceId });
          const reference = runtime.evaluateDeviceReference({
            deviceId: input.deviceId,
            providerInstanceId: provider.providerInstanceId,
            scope: input.scope,
          });
          if (vector.expectedDecision === "ACCEPTED") {
            expect(reference).toMatchObject({ accepted: true });
            expect(vector.expectedCode).toBe("TARGET_ELIGIBLE");
          } else {
            expect(reference).toMatchObject({ accepted: false, reason: vector.expectedCode });
          }
          break;
        }
        case "unsupported-scale": {
          const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
          runtime.authorizeProvider(provider);
          expect(() => runtime.acceptHealthSnapshot({
            providerHealth: "READY",
            providerInstanceId: provider.providerInstanceId,
            timestamp: "2026-07-14T16:00:06.000Z",
            devices: [{
              device: { deviceId: input.deviceId, deviceKind: input.deviceKind },
              health: "ONLINE",
              capabilities: [],
            }],
          })).toThrow(`Device registration rejected: ${vector.expectedCode}`);
          expect(vector.expectedDecision).toBe("REJECTED");
          break;
        }
        default:
          throw new Error(`Unhandled device runtime vector: ${vector.id}`);
      }
    }

    expect(executed).toBe(deviceRuntimeVectors.vectors.length);
    expect(executed).toBe(19);
  });
});
