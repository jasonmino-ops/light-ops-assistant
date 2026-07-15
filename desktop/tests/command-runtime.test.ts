import { describe, expect, it } from "vitest";
import {
  HRT_CONTRACT_VERSION,
  HrtCapability,
  HrtHealthSnapshotPayload,
  HrtJsonValue,
  HrtProviderRegistrationPayload,
} from "@eshop/hrt-contract";
import {
  HrtCommandRuntime,
  HrtFakeCommandExecutor,
  HrtProviderLifecycle,
  HrtProviderRegistry,
  HrtRuntimeCommandLifecycle,
  HrtDeviceRuntime,
  HrtRuntimeDiagnostics,
} from "../src/main/hrt";
import { createDeviceSlotReference } from "../src/main/hrt/deviceSlot";

const providerRegistration: HrtProviderRegistrationPayload = {
  providerId: "windows-provider-simulator",
  providerInstanceId: "provider-sim-001",
  providerVersion: "0.1.0",
  contractVersion: HRT_CONTRACT_VERSION,
  supportedCapabilities: [
    "printer.receipt",
    "printer.cash_drawer_pulse",
    "scanner.barcode_event",
    "customer_display.snapshot",
  ],
  capabilityDescriptors: [
    {
      capabilityId: "printer.receipt",
      capabilityVersion: "1.0.0",
      supportedCommandFamilies: ["printer"],
      supportedEventFamilies: ["health"],
    },
    {
      capabilityId: "printer.cash_drawer_pulse",
      capabilityVersion: "1.0.0",
      supportedCommandFamilies: ["printer"],
      supportedEventFamilies: ["health"],
    },
    {
      capabilityId: "scanner.barcode_event",
      capabilityVersion: "1.0.0",
      supportedCommandFamilies: ["scanner"],
      supportedEventFamilies: ["scanner", "health"],
    },
    {
      capabilityId: "customer_display.snapshot",
      capabilityVersion: "1.0.0",
      supportedCommandFamilies: ["customer_display"],
      supportedEventFamilies: ["health"],
    },
  ],
  platform: { os: "simulator", arch: "x64", runtime: "simulator" },
  process: { pid: 1, startedAt: "2026-07-15T09:00:00.000Z" },
};

function healthSnapshot(capabilities: HrtCapability[] = ["printer.receipt", "printer.cash_drawer_pulse"]): HrtHealthSnapshotPayload {
  return {
    providerHealth: "READY",
    providerInstanceId: providerRegistration.providerInstanceId,
    timestamp: "2026-07-15T09:00:02.000Z",
    devices: [
      {
        device: { deviceId: "printer-sim-001", deviceKind: "PRINTER", slotId: "receipt-printer" },
        health: "ONLINE",
        capabilities,
      },
    ],
  };
}

function printRequest(args: {
  commandId?: string;
  deviceId?: string;
  idempotencyKey?: string;
  params?: Record<string, HrtJsonValue>;
} = {}) {
  return {
    commandId: args.commandId ?? "cmd-print-001",
    idempotencyKey: args.idempotencyKey ?? "idem-print-001",
    device: { deviceId: args.deviceId ?? "printer-sim-001", deviceKind: "PRINTER" as const, slotId: "receipt-printer" },
    commandType: "PRINT_RECEIPT" as const,
    params: args.params ?? {},
  };
}

function createRuntime(args: {
  executor?: HrtFakeCommandExecutor;
  registerProvider?: boolean;
  assignDevice?: boolean;
  deviceCapabilities?: HrtCapability[];
  providerCapabilities?: HrtCapability[];
} = {}) {
  const diagnostics = new HrtRuntimeDiagnostics();
  const lifecycle = new HrtProviderLifecycle();
  const providerRegistry = new HrtProviderRegistry(lifecycle, diagnostics);
  const deviceRuntime = new HrtDeviceRuntime(diagnostics);
  const registration = {
    ...providerRegistration,
    supportedCapabilities: args.providerCapabilities ?? providerRegistration.supportedCapabilities,
    capabilityDescriptors: providerRegistration.capabilityDescriptors.filter((descriptor) =>
      (args.providerCapabilities ?? providerRegistration.supportedCapabilities).includes(descriptor.capabilityId),
    ),
  };

  if (args.registerProvider !== false) {
    const result = providerRegistry.register(registration);
    expect(result.decision).toBe("ACCEPTED_FIRST_REGISTRATION");
  }

  deviceRuntime.authorizeProvider(registration);
  deviceRuntime.acceptHealthSnapshot(healthSnapshot(args.deviceCapabilities));
  if (args.assignDevice !== false) {
    const printer = deviceRuntime.registry.getByProviderLocalDeviceId("printer-sim-001")!;
    deviceRuntime.registerSlot(createDeviceSlotReference({
      slotId: "receipt-printer",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "PRINTER",
      requiredCapabilities: ["printer.receipt"],
      revision: "command-runtime-test",
    }));
    expect(deviceRuntime.assign({ slotId: "receipt-printer", physicalDeviceId: printer.physicalDeviceId }).accepted).toBe(true);
  }

  return {
    runtime: new HrtCommandRuntime({
      deviceRuntime,
      providerRegistry,
      executor: args.executor ?? new HrtFakeCommandExecutor(),
    }),
    deviceRuntime,
    providerRegistry,
  };
}

function envelope(runtime: HrtCommandRuntime, overrides: Partial<Parameters<HrtCommandRuntime["createCommand"]>[0]> = {}) {
  return runtime.createCommand({
    request: printRequest(),
    source: "TEST",
    correlationId: "corr-001",
    createdAt: "2026-07-15T09:00:03.000Z",
    ...overrides,
  });
}

describe("Command Runtime MB-2C", () => {
  it("creates a stable command contract and preserves correlation and idempotency", async () => {
    const { runtime } = createRuntime();
    const command = envelope(runtime);

    expect(command).toMatchObject({
      commandId: "cmd-print-001",
      commandType: "PRINT_RECEIPT",
      requiredCapability: "printer.receipt",
      source: "TEST",
      correlationId: "corr-001",
      idempotencyKey: "idem-print-001",
    });

    const first = await runtime.submit(command);
    const second = await runtime.submit({ ...command, commandId: "cmd-print-duplicate" });

    expect(first.status).toBe("SUCCESS");
    expect(second.commandId).toBe(first.commandId);
    expect(first.correlationId).toBe("corr-001");
  });

  it("rejects missing envelope fields, invalid command type, invalid payload, expired deadline, and invalid capability", async () => {
    const { runtime } = createRuntime();

    await expect(runtime.submit({ ...envelope(runtime), commandId: "", idempotencyKey: "idem-missing-command-id" })).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "INVALID_COMMAND",
    });
    await expect(runtime.submit(runtime.createCommand({
      request: { ...printRequest({ commandId: "cmd-invalid-type" }), commandType: "BAD_COMMAND" as never },
      source: "TEST",
      correlationId: "corr-invalid-type",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "INVALID_COMMAND",
    });
    await expect(runtime.submit({ ...envelope(runtime), commandId: "cmd-invalid-payload", idempotencyKey: "idem-invalid-payload", payload: [] as never })).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "INVALID_PAYLOAD",
    });
    await expect(runtime.submit({ ...envelope(runtime), commandId: "cmd-expired", idempotencyKey: "idem-expired", deadlineAt: "2026-01-01T00:00:00.000Z" })).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "INVALID_COMMAND",
    });
    await expect(runtime.submit({ ...envelope(runtime), commandId: "cmd-bad-cap", idempotencyKey: "idem-bad-cap", requiredCapability: "scanner.barcode_event" })).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "CAPABILITY_UNSUPPORTED",
    });
  });

  it("resolves Device Runtime failures distinctly", async () => {
    const unknown = createRuntime();
    await expect(unknown.runtime.submit(envelope(unknown.runtime, {
      request: printRequest({ commandId: "cmd-unknown-device", deviceId: "missing-device" }),
      correlationId: "corr-unknown-device",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "TARGET_NOT_FOUND",
    });

    const unassigned = createRuntime({ assignDevice: false });
    await expect(unassigned.runtime.submit(envelope(unassigned.runtime, {
      request: printRequest({ commandId: "cmd-unassigned" }),
      correlationId: "corr-unassigned",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "DEVICE_UNAVAILABLE",
      errorMessage: "Device command rejected: UNASSIGNED_DEVICE",
    });

    const unsupported = createRuntime({ assignDevice: false, deviceCapabilities: ["printer.cash_drawer_pulse"] });
    const printer = unsupported.deviceRuntime.registry.getByProviderLocalDeviceId("printer-sim-001")!;
    unsupported.deviceRuntime.registerSlot(createDeviceSlotReference({
      slotId: "receipt-printer",
      storeId: "STORE-A",
      terminalId: "terminal-001",
      expectedDeviceKind: "PRINTER",
      requiredCapabilities: ["printer.cash_drawer_pulse"],
    }));
    unsupported.deviceRuntime.assign({ slotId: "receipt-printer", physicalDeviceId: printer.physicalDeviceId });
    await expect(unsupported.runtime.submit(envelope(unsupported.runtime, {
      request: printRequest({ commandId: "cmd-capability-mismatch" }),
      correlationId: "corr-capability-mismatch",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "CAPABILITY_UNSUPPORTED",
    });
  });

  it("resolves Provider Runtime failures distinctly", async () => {
    const noProvider = createRuntime({ registerProvider: false });
    await expect(noProvider.runtime.submit(envelope(noProvider.runtime, {
      request: printRequest({ commandId: "cmd-provider-missing" }),
      correlationId: "corr-provider-missing",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "PROVIDER_NOT_FOUND",
    });

    const unavailable = createRuntime();
    unavailable.providerRegistry.disconnectActive();
    await expect(unavailable.runtime.submit(envelope(unavailable.runtime, {
      request: printRequest({ commandId: "cmd-provider-unavailable" }),
      correlationId: "corr-provider-unavailable",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "PROVIDER_UNAVAILABLE",
    });

    const missingCapability = createRuntime({
      providerCapabilities: ["printer.receipt", "scanner.barcode_event", "customer_display.snapshot"],
    });
    await expect(missingCapability.runtime.submit(missingCapability.runtime.createCommand({
      request: {
        ...printRequest({ commandId: "cmd-open-drawer" }),
        commandType: "OPEN_ATTACHED_CASH_DRAWER",
        idempotencyKey: "idem-open-drawer",
      },
      source: "TEST",
      correlationId: "corr-open-drawer",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "CAPABILITY_UNSUPPORTED",
    });
  });

  it("normalizes fake executor success, dispatch rejection, execution failure, and timeout", async () => {
    const success = createRuntime({ executor: new HrtFakeCommandExecutor("SUCCESS") });
    await expect(success.runtime.submit(envelope(success.runtime))).resolves.toMatchObject({
      status: "SUCCESS",
      lifecycleState: "SUCCEEDED",
      output: { fakeExecutor: true },
    });

    const reject = createRuntime({ executor: new HrtFakeCommandExecutor("REJECT") });
    await expect(reject.runtime.submit(envelope(reject.runtime, {
      request: printRequest({ commandId: "cmd-dispatch-reject", idempotencyKey: "idem-dispatch-reject" }),
      correlationId: "corr-dispatch-reject",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "DISPATCH_REJECTED",
      lifecycleState: "REJECTED",
    });

    const fail = createRuntime({ executor: new HrtFakeCommandExecutor("FAIL") });
    await expect(fail.runtime.submit(envelope(fail.runtime, {
      request: printRequest({ commandId: "cmd-execution-fail", idempotencyKey: "idem-execution-fail" }),
      correlationId: "corr-execution-fail",
    }))).resolves.toMatchObject({
      status: "FAILED",
      errorCode: "EXECUTION_FAILED",
      lifecycleState: "FAILED",
    });

    const timeout = createRuntime({ executor: new HrtFakeCommandExecutor("DELAY_SUCCESS", 20) });
    await expect(timeout.runtime.submit(envelope(timeout.runtime, {
      request: printRequest({ commandId: "cmd-execution-timeout", idempotencyKey: "idem-execution-timeout" }),
      correlationId: "corr-execution-timeout",
      timeoutMs: 1,
    }))).resolves.toMatchObject({
      status: "TIMED_OUT",
      errorCode: "EXECUTION_TIMEOUT",
      lifecycleState: "TIMED_OUT",
    });

    const missingExecutor = createRuntime();
    const noExecutorRuntime = new HrtCommandRuntime({
      deviceRuntime: missingExecutor.deviceRuntime,
      providerRegistry: missingExecutor.providerRegistry,
    });
    await expect(noExecutorRuntime.submit(envelope(noExecutorRuntime, {
      request: printRequest({ commandId: "cmd-no-executor", idempotencyKey: "idem-no-executor" }),
      correlationId: "corr-no-executor",
    }))).resolves.toMatchObject({
      status: "REJECTED",
      errorCode: "DISPATCH_REJECTED",
    });
  });

  it("records lifecycle history and protects illegal and terminal transitions", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.submit(envelope(runtime));

    expect(result.transitions.map((transition) => transition.to)).toEqual([
      "VALIDATING",
      "ACCEPTED",
      "DISPATCH_READY",
      "DISPATCHED",
      "EXECUTING",
      "SUCCEEDED",
    ]);

    const lifecycle = new HrtRuntimeCommandLifecycle();
    expect(() => lifecycle.transitionTo("SUCCEEDED", "skip")).toThrow("Illegal command lifecycle transition");
    lifecycle.transitionTo("VALIDATING", "begin");
    lifecycle.transitionTo("REJECTED", "invalid");
    expect(() => lifecycle.transitionTo("ACCEPTED", "retry")).toThrow("terminal state REJECTED");
  });

  it("separates cancel from failure and rejects repeated completion attempts", async () => {
    const fake = new HrtFakeCommandExecutor("DELAY_SUCCESS", 25);
    const { runtime } = createRuntime({ executor: fake });
    const command = envelope(runtime, {
      request: printRequest({ commandId: "cmd-cancel", idempotencyKey: "idem-cancel" }),
      correlationId: "corr-cancel",
    });
    const promise = runtime.submit(command);
    const cancelled = runtime.cancel(command.commandId, "USER_CANCELLED");
    const final = await promise;

    expect(cancelled).toMatchObject({ status: "CANCELLED", lifecycleState: "CANCELLED" });
    expect(final).toMatchObject({ status: "CANCELLED", lifecycleState: "CANCELLED" });
    expect(() => runtime.cancel(command.commandId, "SECOND_CANCEL")).toThrow("terminal state CANCELLED");
  });
});
