import { describe, expect, it } from "vitest";
import {
  HRT_CONTRACT_VERSION,
  HrtCapability,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtDeviceHealth,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
  printReceiptCommandFixture,
} from "@eshop/hrt-contract";
import { HrtLogicCore } from "../src/main/hrt";
import { HrtProviderClient } from "../src/main/hrt/providerClient";

class TestProvider implements HrtProviderClient {
  constructor(
    private providerInstanceId: string,
    private readonly options: {
      contractVersion?: string;
      capabilities?: HrtCapability[];
      commandResultProviderInstanceId?: string;
      deviceHealth?: HrtDeviceHealth;
    } = {},
  ) {}

  register(): HrtProviderRegistrationPayload {
    const capabilities = this.options.capabilities ?? [
      "printer.receipt",
      "printer.cash_drawer_pulse",
      "scanner.barcode_event",
      "customer_display.snapshot",
    ];
    return {
      providerId: "windows-provider-simulator",
      providerInstanceId: this.providerInstanceId,
      providerVersion: "0.1.0",
      contractVersion: this.options.contractVersion ?? HRT_CONTRACT_VERSION,
      supportedCapabilities: capabilities,
      capabilityDescriptors: capabilities.map((capabilityId) => ({
        capabilityId,
        capabilityVersion: "1.0.0",
        supportedCommandFamilies: capabilityId.startsWith("printer.")
          ? ["printer"]
          : capabilityId.startsWith("scanner.")
            ? ["scanner"]
            : ["customer_display"],
        supportedEventFamilies: capabilityId === "scanner.barcode_event" ? ["scanner", "health"] : ["health"],
      })),
      platform: { os: "simulator", arch: "x64", runtime: "simulator" },
      process: { pid: 1, startedAt: "2026-07-14T16:00:00.000Z" },
    };
  }

  execute(command: HrtCommandRequestPayload): HrtCommandResultPayload {
    return {
      commandId: command.commandId,
      outcome: "SUCCEEDED",
      effectBoundary: "CROSSED",
      providerInstanceId: this.options.commandResultProviderInstanceId ?? this.providerInstanceId,
    };
  }

  healthSnapshot(): HrtHealthSnapshotPayload {
    const deviceHealth = this.options.deviceHealth ?? "UNKNOWN";
    return {
      providerHealth: "READY",
      providerInstanceId: this.providerInstanceId,
      timestamp: "2026-07-14T16:00:06.000Z",
      devices: [
        {
          device: { deviceId: "printer-sim-001", deviceKind: "PRINTER", slotId: "receipt-printer" },
          health: deviceHealth,
          capabilities: ["printer.receipt", "printer.cash_drawer_pulse"],
        },
        {
          device: { deviceId: "scanner-sim-001", deviceKind: "SCANNER", slotId: "barcode-scanner" },
          health: deviceHealth,
          capabilities: ["scanner.barcode_event"],
        },
        {
          device: { deviceId: "display-sim-001", deviceKind: "CUSTOMER_DISPLAY", slotId: "customer-display" },
          health: deviceHealth,
          capabilities: ["customer_display.snapshot"],
        },
      ],
    };
  }

  restart(providerInstanceId: string): void {
    this.providerInstanceId = providerInstanceId;
  }
}

describe("HrtLogicCore", () => {
  it("registers a provider, refreshes device health, and executes a command", async () => {
    const provider = new TestProvider("provider-sim-vitest");
    const core = new HrtLogicCore(provider);

    const registration = core.registerProvider();

    expect(core.state()).toBe("READY");
    expect(registration.providerInstanceId).toBe("provider-sim-vitest");
    expect(registration.capabilityDescriptors.length).toBeGreaterThan(0);
    expect(core.registry.list()).toHaveLength(3);
    expect(core.registry.list()[0].health).toBe("UNKNOWN");

    const result = await core.execute(printReceiptCommandFixture.payload);

    expect(result.outcome).toBe("SUCCEEDED");
    expect(result.effectBoundary).toBe("CROSSED");
    expect(core.audit.list().map((event) => event.type)).toContain("hrt.command.result");
  });

  it("rejects command execution before provider registration", async () => {
    const core = new HrtLogicCore(new TestProvider("provider-sim-vitest"));

    await expect(core.execute(printReceiptCommandFixture.payload)).rejects.toThrow("Provider is not READY");
  });

  it("rejects duplicate registration from the same provider instance", () => {
    const core = new HrtLogicCore(new TestProvider("provider-sim-vitest"));

    core.registerProvider();

    expect(() => core.registerProvider()).toThrow("Duplicate provider registration");
    expect(core.state()).toBe("REJECTED");
  });

  it("rejects incompatible providers and missing required capabilities", () => {
    const incompatible = new HrtLogicCore(new TestProvider("provider-sim-vitest", { contractVersion: "0.0.0" }));
    expect(() => incompatible.registerProvider()).toThrow("Provider contract version mismatch");

    const missingCapability = new HrtLogicCore(
      new TestProvider("provider-sim-vitest", { capabilities: ["printer.receipt", "scanner.barcode_event"] }),
    );
    expect(() => missingCapability.registerProvider()).toThrow(
      "Provider compatibility rejected: MISSING_REQUIRED_CAPABILITY",
    );
  });

  it("allows restart with a new instance and rejects stale command results", async () => {
    const provider = new TestProvider("provider-sim-before-restart");
    const core = new HrtLogicCore(provider);

    core.registerProvider();
    provider.restart("provider-sim-after-restart");
    const registration = core.registerProvider();

    expect(registration.providerInstanceId).toBe("provider-sim-after-restart");
    expect(core.audit.list().map((event) => event.type)).toContain("hrt.provider.restart");

    const staleProvider = new TestProvider("provider-sim-after-restart", {
      commandResultProviderInstanceId: "provider-sim-stale-result",
    });
    const staleCore = new HrtLogicCore(staleProvider);
    staleCore.registerProvider();

    await expect(staleCore.execute(printReceiptCommandFixture.payload)).rejects.toThrow("Stale provider instance");
  });
});
