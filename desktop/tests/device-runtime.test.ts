import { describe, expect, it } from "vitest";
import { HrtCommandRequestPayload, HrtHealthSnapshotPayload, HrtProviderRegistrationPayload } from "@eshop/hrt-contract";
import { HrtDeviceRuntime, HrtRuntimeDiagnostics } from "../src/main/hrt";
import { createDeviceSlotReference } from "../src/main/hrt/deviceSlot";

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

function printCommand(deviceId = "printer-sim-001"): HrtCommandRequestPayload {
  return {
    commandId: "cmd-print-001",
    idempotencyKey: "sale-record-001-print",
    device: { deviceId, deviceKind: "PRINTER", slotId: "receipt-printer" },
    commandType: "PRINT_RECEIPT",
    params: {},
  };
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
    expect(runtime.evaluateCommand(printCommand())).toMatchObject({ accepted: false, reason: "UNASSIGNED_DEVICE" });
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

  it("accepts scanner events only from assigned source scope", () => {
    const runtime = new HrtDeviceRuntime(new HrtRuntimeDiagnostics());
    runtime.authorizeProvider(provider);
    runtime.acceptHealthSnapshot(healthSnapshot());
    const scanner = runtime.registry.getByProviderLocalDeviceId("scanner-sim-001")!;
    runtime.registerSlot(createDeviceSlotReference({
      slotId: "barcode-scanner",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "SCANNER",
      requiredCapabilities: ["scanner.barcode_event"],
    }));
    runtime.assign({ slotId: "barcode-scanner", physicalDeviceId: scanner.physicalDeviceId });

    expect(() => runtime.acceptScannerEvent({
      eventId: "scan-001",
      device: { deviceId: "scanner-sim-001", deviceKind: "SCANNER", slotId: "barcode-scanner" },
      eventType: "BARCODE_SCANNED",
      monotonicSequence: 1,
      providerInstanceId: "provider-sim-001",
      scope: { storeId: "STORE-A", terminalId: "terminal-001" },
      data: { barcode: "1234567890" },
    })).not.toThrow();

    expect(() => runtime.acceptScannerEvent({
      eventId: "scan-002",
      device: { deviceId: "scanner-sim-001", deviceKind: "SCANNER", slotId: "barcode-scanner" },
      eventType: "BARCODE_SCANNED",
      monotonicSequence: 2,
      providerInstanceId: "provider-sim-stale",
      scope: { storeId: "STORE-A", terminalId: "terminal-001" },
      data: { barcode: "1234567890" },
    })).toThrow("Scanner event rejected: UNKNOWN_DEVICE");
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
});
