import { HrtCapability, HrtCommandRequestPayload, HrtJsonValue } from "@eshop/hrt-contract";
import { HrtAuditEmitter } from "./auditEmitter";
import { HrtRuntimeCommandLifecycle } from "./commandLifecycle";
import {
  HrtCommandExecutorPort,
  HrtRuntimeCommandEnvelope,
  HrtRuntimeCommandFailure,
  HrtRuntimeCommandResult,
} from "./commandRuntimeTypes";
import { HrtDeviceRuntime } from "./deviceRuntime";
import { RegisteredHrtDevice } from "./deviceRegistry";
import { HrtProviderRegistry } from "./providerRegistry";
import { HrtProviderSession } from "./providerSession";

const commandRequirements: Record<
  HrtCommandRequestPayload["commandType"],
  { capability: HrtCapability }
> = {
  PRINT_RECEIPT: { capability: "printer.receipt" },
  OPEN_ATTACHED_CASH_DRAWER: { capability: "printer.cash_drawer_pulse" },
  SET_SCANNER_ENABLED: { capability: "scanner.barcode_event" },
  DISPLAY_SNAPSHOT: { capability: "customer_display.snapshot" },
  CLEAR_DISPLAY: { capability: "customer_display.snapshot" },
};

export interface HrtCommandRuntimeRecord {
  command: HrtRuntimeCommandEnvelope;
  lifecycle: HrtRuntimeCommandLifecycle;
  result?: HrtRuntimeCommandResult;
}

export class HrtCommandRuntime {
  private readonly records = new Map<string, HrtCommandRuntimeRecord>();
  private readonly completedByIdempotencyKey = new Map<string, HrtRuntimeCommandResult>();

  constructor(
    private readonly deps: {
      deviceRuntime: HrtDeviceRuntime;
      providerRegistry: HrtProviderRegistry;
      executor?: HrtCommandExecutorPort;
      audit?: HrtAuditEmitter;
    },
  ) {}

  createCommand(input: {
    request: HrtCommandRequestPayload;
    source?: HrtRuntimeCommandEnvelope["source"];
    correlationId: string;
    createdAt?: string;
    deadlineAt?: string;
    timeoutMs?: number;
    metadata?: Record<string, HrtJsonValue>;
  }): HrtRuntimeCommandEnvelope {
    return {
      commandId: input.request.commandId,
      commandType: input.request.commandType,
      target: input.request.device,
      requiredCapability: commandRequirements[input.request.commandType]?.capability,
      payload: input.request.params,
      metadata: input.metadata,
      source: input.source ?? "UNKNOWN",
      correlationId: input.correlationId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      deadlineAt: input.deadlineAt,
      timeoutMs: input.timeoutMs,
      idempotencyKey: input.request.idempotencyKey,
    };
  }

  record(commandId: string): HrtCommandRuntimeRecord | undefined {
    return this.records.get(commandId);
  }

  async submit(command: HrtRuntimeCommandEnvelope): Promise<HrtRuntimeCommandResult> {
    if (command.idempotencyKey) {
      const previous = this.completedByIdempotencyKey.get(command.idempotencyKey);
      if (previous) {
        return previous;
      }
    }

    const lifecycle = new HrtRuntimeCommandLifecycle();
    const record = { command, lifecycle };
    this.records.set(command.commandId, record);

    try {
      lifecycle.transitionTo("VALIDATING", "COMMAND_RECEIVED");
      const validationFailure = this.validateEnvelope(command);
      if (validationFailure) {
        return this.reject(record, validationFailure);
      }

      const legacyCommand = this.toLegacyCommand(command);
      const deviceResult = this.resolveDevice(legacyCommand, command);
      if (deviceResult.failure) {
        return this.reject(record, deviceResult.failure, deviceResult.device);
      }

      const providerResult = this.resolveProvider(command.requiredCapability, deviceResult.device!);
      if (providerResult.failure) {
        return this.reject(record, providerResult.failure, deviceResult.device);
      }

      lifecycle.transitionTo("ACCEPTED", "VALIDATION_ACCEPTED");
      lifecycle.transitionTo("DISPATCH_READY", "DEVICE_PROVIDER_ELIGIBLE");

      if (!this.deps.executor) {
        return this.reject(record, {
          code: "DISPATCH_REJECTED",
          category: "DISPATCH",
          message: "Command executor is not configured",
        }, deviceResult.device, providerResult.provider);
      }

      lifecycle.transitionTo("DISPATCHED", "DISPATCH_PORT_CALLED");
      const executorResult = await this.dispatchWithTimeout(command, legacyCommand, providerResult.provider!, deviceResult.device!);

      if (lifecycle.state() === "CANCELLED") {
        return this.result(record, "CANCELLED", {
          code: "COMMAND_CANCELLED",
          category: "CANCELLED",
          message: "Command cancelled",
        }, deviceResult.device, providerResult.provider);
      }

      if (!executorResult.accepted || executorResult.status === "REJECTED") {
        lifecycle.transitionTo("REJECTED", "DISPATCH_REJECTED_NORMALIZED");
        return this.result(record, "REJECTED", executorResult.failure ?? {
          code: "DISPATCH_REJECTED",
          category: "DISPATCH",
          message: "Dispatch rejected",
        }, deviceResult.device, providerResult.provider, executorResult.effectBoundary, executorResult.output);
      }

      lifecycle.transitionTo("EXECUTING", "EXECUTOR_ACCEPTED");

      if (executorResult.status === "TIMED_OUT") {
        return this.complete(record, "TIMED_OUT", executorResult.failure ?? {
          code: "EXECUTION_TIMEOUT",
          category: "EXECUTION",
          message: "Execution timed out",
        }, deviceResult.device, providerResult.provider, executorResult.effectBoundary, executorResult.output);
      }

      if (executorResult.status === "FAILED") {
        return this.complete(record, "FAILED", executorResult.failure ?? {
          code: "EXECUTION_FAILED",
          category: "EXECUTION",
          message: "Execution failed",
        }, deviceResult.device, providerResult.provider, executorResult.effectBoundary, executorResult.output);
      }

      return this.complete(record, "SUCCESS", undefined, deviceResult.device, providerResult.provider, executorResult.effectBoundary, executorResult.output);
    } catch (error) {
      return this.failInternal(record, error);
    }
  }

  cancel(commandId: string, reason = "COMMAND_CANCELLED"): HrtRuntimeCommandResult {
    const record = this.records.get(commandId);
    if (!record) {
      throw new Error("Command not found");
    }
    record.lifecycle.transitionTo("CANCELLED", reason);
    return this.result(record, "CANCELLED", {
      code: "COMMAND_CANCELLED",
      category: "CANCELLED",
      message: reason,
    });
  }

  private validateEnvelope(command: HrtRuntimeCommandEnvelope): HrtRuntimeCommandFailure | null {
    if (!command.commandId || !command.commandType || !command.target?.deviceId || !command.requiredCapability || !command.correlationId || !command.createdAt) {
      return { code: "INVALID_COMMAND", category: "VALIDATION", message: "Command envelope is missing required fields" };
    }
    if (!commandRequirements[command.commandType]) {
      return { code: "INVALID_COMMAND", category: "VALIDATION", message: "Unsupported command type" };
    }
    if (command.payload === null || typeof command.payload !== "object" || Array.isArray(command.payload)) {
      return { code: "INVALID_PAYLOAD", category: "VALIDATION", message: "Command payload must be an object" };
    }
    if (command.requiredCapability !== commandRequirements[command.commandType].capability) {
      return { code: "CAPABILITY_UNSUPPORTED", category: "VALIDATION", message: "Required capability does not match command type" };
    }
    if (command.deadlineAt && Date.parse(command.deadlineAt) <= Date.now()) {
      return { code: "INVALID_COMMAND", category: "VALIDATION", message: "Command deadline has expired" };
    }
    if (command.timeoutMs !== undefined && (!Number.isFinite(command.timeoutMs) || command.timeoutMs <= 0)) {
      return { code: "INVALID_COMMAND", category: "VALIDATION", message: "Command timeout must be positive" };
    }
    return null;
  }

  private resolveDevice(legacyCommand: HrtCommandRequestPayload, command: HrtRuntimeCommandEnvelope): {
    device?: RegisteredHrtDevice;
    failure?: HrtRuntimeCommandFailure;
  } {
    const device = this.deps.deviceRuntime.registry.get(command.target.deviceId);
    const eligibility = this.deps.deviceRuntime.evaluateCommand(legacyCommand);
    if (!eligibility.accepted) {
      const code = eligibility.reason === "UNKNOWN_DEVICE"
        ? "TARGET_NOT_FOUND"
        : eligibility.reason === "CAPABILITY_MISMATCH" || eligibility.reason === "KIND_MISMATCH"
          ? "CAPABILITY_UNSUPPORTED"
          : "DEVICE_UNAVAILABLE";
      return {
        device,
        failure: {
          code,
          category: code === "TARGET_NOT_FOUND" ? "TARGET" : code === "CAPABILITY_UNSUPPORTED" ? "DEVICE" : "DEVICE",
          message: `Device command rejected: ${eligibility.reason}`,
        },
      };
    }
    return { device: device ?? this.deps.deviceRuntime.registry.getByProviderLocalDeviceId(command.target.deviceId) };
  }

  private resolveProvider(requiredCapability: HrtCapability, device: RegisteredHrtDevice): {
    provider?: HrtProviderSession;
    failure?: HrtRuntimeCommandFailure;
  } {
    const provider = this.deps.providerRegistry.activeSession();
    if (!provider) {
      return { failure: { code: "PROVIDER_NOT_FOUND", category: "PROVIDER", message: "Provider is not registered" } };
    }
    if (provider.providerId !== device.providerId || provider.providerInstanceId !== device.providerInstanceId) {
      return { provider, failure: { code: "PROVIDER_UNAVAILABLE", category: "PROVIDER", message: "Device provider does not match active provider" } };
    }
    if (provider.lifecycleState !== "READY" || provider.connectionState !== "CONNECTED" || !provider.ownershipValid) {
      return { provider, failure: { code: "PROVIDER_UNAVAILABLE", category: "PROVIDER", message: "Provider is not ready" } };
    }
    if (!provider.capabilities.includes(requiredCapability)) {
      return { provider, failure: { code: "CAPABILITY_UNSUPPORTED", category: "PROVIDER", message: "Provider does not declare required capability" } };
    }
    return { provider };
  }

  private async dispatchWithTimeout(
    command: HrtRuntimeCommandEnvelope,
    legacyCommand: HrtCommandRequestPayload,
    provider: HrtProviderSession,
    device: RegisteredHrtDevice,
  ) {
    const dispatch = this.deps.executor!.dispatch({ command, legacyCommand, provider, device });
    const timeoutMs = command.timeoutMs;
    if (!timeoutMs) {
      return dispatch;
    }
    return Promise.race([
      dispatch,
      new Promise<Awaited<ReturnType<HrtCommandExecutorPort["dispatch"]>>>((resolve) => {
        setTimeout(() => resolve({
          accepted: true,
          status: "TIMED_OUT",
          effectBoundary: "CROSSING_UNKNOWN",
          providerInstanceId: provider.providerInstanceId,
          failure: {
            code: "EXECUTION_TIMEOUT",
            category: "EXECUTION",
            message: "Command execution exceeded timeout",
          },
        }), timeoutMs);
      }),
    ]);
  }

  private reject(
    record: HrtCommandRuntimeRecord,
    failure: HrtRuntimeCommandFailure,
    device?: RegisteredHrtDevice,
    provider?: HrtProviderSession,
  ): HrtRuntimeCommandResult {
    record.lifecycle.transitionTo("REJECTED", failure.code);
    return this.result(record, "REJECTED", failure, device, provider, "NOT_CROSSED");
  }

  private complete(
    record: HrtCommandRuntimeRecord,
    status: HrtRuntimeCommandResult["status"],
    failure?: HrtRuntimeCommandFailure,
    device?: RegisteredHrtDevice,
    provider?: HrtProviderSession,
    effectBoundary: HrtRuntimeCommandResult["effectBoundary"] = "CROSSED",
    output?: Record<string, HrtJsonValue>,
  ): HrtRuntimeCommandResult {
    const nextState = status === "SUCCESS" ? "SUCCEEDED" : status;
    record.lifecycle.transitionTo(nextState, failure?.code ?? "EXECUTION_SUCCEEDED");
    return this.result(record, status, failure, device, provider, effectBoundary, output);
  }

  private result(
    record: HrtCommandRuntimeRecord,
    status: HrtRuntimeCommandResult["status"],
    failure?: HrtRuntimeCommandFailure,
    device?: RegisteredHrtDevice,
    provider?: HrtProviderSession,
    effectBoundary?: HrtRuntimeCommandResult["effectBoundary"],
    output?: Record<string, HrtJsonValue>,
  ): HrtRuntimeCommandResult {
    const result: HrtRuntimeCommandResult = {
      commandId: record.command.commandId,
      status,
      errorCode: failure?.code,
      errorCategory: failure?.category,
      errorMessage: failure?.message,
      timestamp: new Date().toISOString(),
      providerId: provider?.providerId ?? device?.providerId,
      providerInstanceId: provider?.providerInstanceId ?? device?.providerInstanceId,
      deviceId: record.command.target?.deviceId,
      physicalDeviceId: device?.physicalDeviceId,
      correlationId: record.command.correlationId,
      output,
      effectBoundary,
      lifecycleState: record.lifecycle.state(),
      transitions: record.lifecycle.history(),
    };
    record.result = result;
    if (record.command.idempotencyKey && record.lifecycle.isTerminal()) {
      this.completedByIdempotencyKey.set(record.command.idempotencyKey, result);
    }
    this.deps.audit?.emit("hrt.command.runtime.result", {
      commandId: result.commandId,
      correlationId: result.correlationId,
      status: result.status,
      errorCode: result.errorCode,
      providerId: result.providerId,
      providerInstanceId: result.providerInstanceId,
      deviceId: result.deviceId,
      lifecycleState: result.lifecycleState,
    });
    return result;
  }

  private failInternal(record: HrtCommandRuntimeRecord, error: unknown): HrtRuntimeCommandResult {
    if (!record.lifecycle.isTerminal()) {
      try {
        record.lifecycle.transitionTo("FAILED", "INTERNAL_RUNTIME_ERROR");
      } catch {
        // Preserve original lifecycle state if the error was an illegal terminal mutation.
      }
    }
    return this.result(record, "FAILED", {
      code: "INTERNAL_RUNTIME_ERROR",
      category: "INTERNAL",
      message: error instanceof Error ? error.message : "Internal runtime error",
    });
  }

  private toLegacyCommand(command: HrtRuntimeCommandEnvelope): HrtCommandRequestPayload {
    return {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey ?? command.commandId,
      device: command.target,
      commandType: command.commandType,
      params: command.payload,
    };
  }
}
