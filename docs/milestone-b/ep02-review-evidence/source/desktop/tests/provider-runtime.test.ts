import { describe, expect, it } from "vitest";
import {
  HRT_CONTRACT_VERSION,
  HrtCapability,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
  printReceiptCommandFixture,
} from "@eshop/hrt-contract";
import {
  HrtLogicCore,
  HrtProviderLifecycle,
  HrtProviderOwnership,
  HrtProviderSupervision,
  HrtRuntimeDiagnostics,
} from "../src/main/hrt";
import { createDeviceSlotReference } from "../src/main/hrt/deviceSlot";
import { HrtProviderClient } from "../src/main/hrt/providerClient";
import providerRuntimeVectors from "../../packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json";

class RuntimeTestProvider implements HrtProviderClient {
  commandResultProviderInstanceId?: string;
  providerHealth: HrtHealthSnapshotPayload["providerHealth"] = "READY";
  deviceHealth: HrtHealthSnapshotPayload["devices"][number]["health"] = "UNKNOWN";

  constructor(
    private providerId: string,
    private providerInstanceId: string,
    private readonly options: {
      contractVersion?: string;
      capabilities?: HrtCapability[];
      providerVersion?: string;
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
      providerId: this.providerId,
      providerInstanceId: this.providerInstanceId,
      providerVersion: this.options.providerVersion ?? "0.1.0",
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
      providerInstanceId: this.commandResultProviderInstanceId ?? this.providerInstanceId,
    };
  }

  healthSnapshot(): HrtHealthSnapshotPayload {
    return {
      providerHealth: this.providerHealth,
      providerInstanceId: this.providerInstanceId,
      timestamp: "2026-07-14T16:00:06.000Z",
      devices: [
        {
          device: { deviceId: "printer-sim-001", deviceKind: "PRINTER", slotId: "receipt-printer" },
          health: this.deviceHealth,
          capabilities: ["printer.receipt", "printer.cash_drawer_pulse"],
        },
      ],
    };
  }

  restart(providerInstanceId: string): void {
    this.providerInstanceId = providerInstanceId;
  }
}

describe("Provider Runtime MB-2A", () => {
  function assignReceiptPrinter(core: HrtLogicCore) {
    const printer = core.registry.getByProviderLocalDeviceId("printer-sim-001");
    if (!printer) {
      throw new Error("missing test printer");
    }
    core.deviceRuntime.registerSlot(createDeviceSlotReference({
      slotId: "receipt-printer",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "PRINTER",
      requiredCapabilities: ["printer.receipt"],
      revision: "test",
    }));
    const assignment = core.deviceRuntime.assign({
      slotId: "receipt-printer",
      physicalDeviceId: printer.physicalDeviceId,
    });
    expect(assignment.accepted).toBe(true);
  }

  it("enforces lifecycle transitions and rejects provider self-ready", () => {
    const lifecycle = new HrtProviderLifecycle();

    expect(() => lifecycle.transitionTo("READY", "HANDSHAKE_ACCEPTED")).toThrow("Illegal provider lifecycle transition");
    lifecycle.transitionTo("CONNECTING", "CONNECT_REQUESTED");
    lifecycle.transitionTo("REGISTERED", "REGISTRATION_ACCEPTED");
    lifecycle.transitionTo("HANDSHAKING", "HANDSHAKE_STARTED");
    lifecycle.transitionTo("READY", "HANDSHAKE_ACCEPTED");
    lifecycle.transitionTo("DISCONNECTED", "PROVIDER_DISCONNECTED");
    lifecycle.transitionTo("STOPPED", "PROVIDER_STOPPED");

    expect(lifecycle.state()).toBe("STOPPED");
    expect(lifecycle.history().map((entry) => entry.newState)).toEqual([
      "CONNECTING",
      "REGISTERED",
      "HANDSHAKING",
      "READY",
      "DISCONNECTED",
      "STOPPED",
    ]);
  });

  it("records illegal lifecycle transitions in runtime diagnostics", () => {
    const core = new HrtLogicCore(new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001"));

    expect(() => core.lifecycle.transitionTo("READY", "HANDSHAKE_ACCEPTED")).toThrow("Illegal provider lifecycle transition");
    expect(core.diagnostics.list()[0]).toMatchObject({
      eventCode: "HRT_PROVIDER_ILLEGAL_TRANSITION",
      severity: "ERROR",
      previousState: "NEW",
      newState: "READY",
      reason: "HANDSHAKE_ACCEPTED",
    });
  });

  it("registers the first provider and creates a complete provider session", () => {
    const core = new HrtLogicCore(new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001"));

    core.registerProvider();
    const session = core.providerRegistry.activeSession();

    expect(session?.providerId).toBe("windows-provider-simulator");
    expect(session?.providerInstanceId).toBe("provider-sim-001");
    expect(session?.providerVersion).toBe("0.1.0");
    expect(session?.contractVersion).toBe(HRT_CONTRACT_VERSION);
    expect(session?.connectionState).toBe("CONNECTED");
    expect(session?.handshakeState).toBe("ACCEPTED");
    expect(session?.ownershipValid).toBe(true);
    expect(session?.lastHealth?.providerHealth).toBe("READY");
    expect(core.state()).toBe("READY");
  });

  it("rejects incompatible, missing-capability, duplicate, and conflicting providers distinctly", () => {
    expect(() =>
      new HrtLogicCore(
        new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001", { contractVersion: "0.0.0" }),
      ).registerProvider(),
    ).toThrow("Provider contract version mismatch");

    expect(() =>
      new HrtLogicCore(
        new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001", {
          capabilities: ["printer.receipt", "scanner.barcode_event"],
        }),
      ).registerProvider(),
    ).toThrow("Provider compatibility rejected: MISSING_REQUIRED_CAPABILITY");

    const duplicateCore = new HrtLogicCore(new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001"));
    duplicateCore.registerProvider();
    expect(() => duplicateCore.registerProvider()).toThrow("Duplicate provider registration");
    expect(duplicateCore.providerRegistry.rejectedSessions()[0].rejectionReason).toBe("DUPLICATE_REGISTRATION");

    const provider = new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001");
    const conflictCore = new HrtLogicCore(provider);
    conflictCore.registerProvider();
    const conflictingProvider = new RuntimeTestProvider("other-provider", "provider-sim-002");
    expect(conflictCore.providerRegistry.register(conflictingProvider.register()).decision).toBe("REJECTED_CONFLICTING_PROVIDER");
  });

  it("replaces a restarted provider instance and rejects stale ownership", async () => {
    const provider = new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001");
    const core = new HrtLogicCore(provider);

    core.registerProvider();
    provider.restart("provider-sim-002");
    core.registerProvider();

    expect(core.providerRegistry.activeSession()?.providerInstanceId).toBe("provider-sim-002");
    expect(core.providerRegistry.staleSessions()[0].providerInstanceId).toBe("provider-sim-001");
    expect(core.ownership.check("provider-sim-001", "COMMAND_RESULT")).toEqual({
      accepted: false,
      reason: "STALE_PROVIDER_INSTANCE",
    });

    assignReceiptPrinter(core);
    provider.commandResultProviderInstanceId = "provider-sim-001";
    await expect(core.execute(printReceiptCommandFixture.payload)).rejects.toThrow("Stale provider instance");
  });

  it("models disconnect, in-flight uncertainty hook, backoff, max restart, and manual reset", async () => {
    const core = new HrtLogicCore(new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001"), {
      initialBackoffMs: 100,
      backoffMultiplier: 2,
      maxBackoffMs: 1000,
      maxRestartAttempts: 2,
      restartWindowMs: 60000,
    });

    core.registerProvider();
    core.disconnectProvider(1000);

    expect(core.state()).toBe("DISCONNECTED");
    expect(core.ownership.isValid()).toBe(false);
    expect(core.supervision.restartAttempts()).toBe(1);
    expect(core.supervision.lastBackoffMs()).toBe(100);
    await expect(core.execute(printReceiptCommandFixture.payload)).rejects.toThrow("Provider is not READY");

    const restartedProvider = core.providerRegistry.activeSession();
    expect(restartedProvider?.ownershipValid).toBe(false);
    core.disconnectProvider(2000);
    core.disconnectProvider(3000);

    expect(core.supervision.state()).toBe("STOPPED");
    expect(core.state()).toBe("SHUTDOWN");
    expect(core.supervision.manualReset().supervisionState).toBe("IDLE");
  });

  it("keeps provider health separate from device health and rejects stale health", () => {
    const provider = new RuntimeTestProvider("windows-provider-simulator", "provider-sim-001");
    provider.providerHealth = "READY";
    provider.deviceHealth = "OFFLINE";
    const core = new HrtLogicCore(provider);

    core.registerProvider();
    const health = core.providerHealth.view();

    expect(health.providerHealth).toBe("READY");
    expect(health.devices[0].health).toBe("OFFLINE");

    provider.restart("provider-sim-002");
    expect(() => core.refreshHealth()).toThrow("Health snapshot rejected: STALE_PROVIDER_INSTANCE");
  });

  it("emits structured diagnostics without leaking sensitive fields", () => {
    const diagnostics = new HrtRuntimeDiagnostics();
    const ownership = new HrtProviderOwnership(diagnostics);

    ownership.authorize("provider-sim-001");
    ownership.check("provider-sim-stale", "SCANNER_EVENT");
    diagnostics.emit({
      eventCode: "HRT_TEST_SECRET_REDACTION",
      severity: "WARN",
      reason: "TEST",
      details: { token: "secret-token", safe: "visible" },
    });

    expect(diagnostics.list()[0].eventCode).toBe("HRT_PROVIDER_STALE_INSTANCE_REJECTED");
    expect(diagnostics.list()[0].severity).toBe("WARN");
    expect(diagnostics.list()[1].redactedDetails.token).toBe("[REDACTED]");
    expect(diagnostics.list()[1].redactedDetails.safe).toBe("visible");
  });

  it("loads provider runtime conformance vectors", () => {
    expect(providerRuntimeVectors.fixtureFamily).toBe("provider-runtime");
    expect(providerRuntimeVectors.vectors.map((vector) => vector.id)).toEqual([
      "valid-registration",
      "incompatible-contract",
      "missing-capability",
      "duplicate-registration",
      "restart-with-new-instance",
      "stale-instance-result",
      "disconnect",
      "supervision-backoff",
      "max-restart",
      "illegal-transition",
      "shutdown",
    ]);
  });

  it("calculates deterministic supervision backoff", () => {
    const supervision = new HrtProviderSupervision({
      initialBackoffMs: 250,
      backoffMultiplier: 2,
      maxBackoffMs: 600,
      maxRestartAttempts: 3,
      restartWindowMs: 60000,
    });

    expect(supervision.onDisconnect(1000)).toMatchObject({ restartAllowed: true, backoffMs: 250 });
    expect(supervision.onDisconnect(2000)).toMatchObject({ restartAllowed: true, backoffMs: 500 });
    expect(supervision.onDisconnect(3000)).toMatchObject({ restartAllowed: true, backoffMs: 600 });
    expect(supervision.onDisconnect(4000)).toMatchObject({ restartAllowed: false, supervisionState: "STOPPED" });
  });
});
