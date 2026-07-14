import {
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtProviderRegistrationPayload,
  HrtProviderState,
} from "@eshop/hrt-contract";
import { HrtAuditEmitter } from "./auditEmitter";
import { HrtCommandRouter } from "./commandRouter";
import { HrtDeviceRegistry } from "./deviceRegistry";
import { HrtHealthEngine } from "./healthEngine";
import { HrtProviderHealthModel } from "./providerHealth";
import { HrtProviderLifecycle } from "./providerLifecycle";
import { HrtProviderOwnership } from "./providerOwnership";
import { HrtProviderRegistry } from "./providerRegistry";
import { HrtProviderClient } from "./providerClient";
import { HrtProviderSupervision, HrtProviderSupervisionPolicy } from "./providerSupervision";
import { HrtRuntimeDiagnostics, HrtRuntimeHealthSummary } from "./runtimeDiagnostics";

export class HrtLogicCore {
  readonly audit = new HrtAuditEmitter();
  readonly diagnostics = new HrtRuntimeDiagnostics();
  readonly lifecycle = new HrtProviderLifecycle((transition) => {
    this.diagnostics.emit({
      eventCode: "HRT_PROVIDER_ILLEGAL_TRANSITION",
      severity: "ERROR",
      previousState: transition.previousState,
      newState: transition.newState,
      lifecycleState: transition.previousState,
      reason: transition.reason,
    });
  });
  readonly registry = new HrtDeviceRegistry();
  readonly providerRegistry = new HrtProviderRegistry(this.lifecycle, this.diagnostics);
  readonly ownership = new HrtProviderOwnership(this.diagnostics);
  readonly supervision: HrtProviderSupervision;
  readonly providerHealth = new HrtProviderHealthModel();
  readonly router: HrtCommandRouter;
  readonly health: HrtHealthEngine;
  private readonly inFlightCommandIds = new Set<string>();

  constructor(
    private readonly provider: HrtProviderClient,
    supervisionPolicy?: HrtProviderSupervisionPolicy,
  ) {
    this.supervision = new HrtProviderSupervision(supervisionPolicy);
    this.router = new HrtCommandRouter(provider, this.audit);
    this.health = new HrtHealthEngine(provider, this.registry);
  }

  registerProvider(): HrtProviderRegistrationPayload {
    const registration = this.provider.register();
    const result = this.providerRegistry.register(registration);
    if (result.decision === "REJECTED_DUPLICATE_SAME_INSTANCE") {
      this.audit.emit("hrt.provider.rejected", {
        reason: "DUPLICATE_REGISTRATION",
        providerInstanceId: registration.providerInstanceId,
      });
      throw new Error("Duplicate provider registration");
    }
    if (result.decision === "REJECTED_CONFLICTING_PROVIDER") {
      throw new Error("Conflicting provider registration");
    }
    if (result.decision === "REJECTED_INCOMPATIBLE") {
      if (result.reason === "CONTRACT_VERSION_MISMATCH") {
        this.audit.emit("hrt.provider.rejected", {
          reason: "CONTRACT_VERSION_MISMATCH",
          providerContractVersion: registration.contractVersion,
        });
        throw new Error("Provider contract version mismatch");
      }
      throw new Error(`Provider compatibility rejected: ${result.reason}`);
    }
    if (!result.session) {
      throw new Error("Provider registration failed");
    }
    if (result.staleSession) {
      this.ownership.invalidate("PROVIDER_RESTARTED", result.staleSession.providerInstanceId);
      this.providerHealth.markProviderStale(result.staleSession.providerInstanceId);
      this.registry.clear();
      this.audit.emit("hrt.provider.restart", {
        previousProviderInstanceId: result.staleSession.providerInstanceId,
        providerInstanceId: registration.providerInstanceId,
      });
    }
    this.ownership.authorize(result.session.providerInstanceId);
    this.supervision.markHealthy();
    this.audit.emit("hrt.provider.ready", {
      providerId: registration.providerId,
      providerInstanceId: registration.providerInstanceId,
      capabilities: registration.supportedCapabilities,
    });
    this.refreshHealth();
    return registration;
  }

  state(): HrtProviderState {
    const state = this.lifecycle.state();
    if (state === "CONNECTING") {
      return "NEW";
    }
    if (state === "DEGRADED") {
      return "READY";
    }
    if (state === "STOPPED") {
      return "SHUTDOWN";
    }
    return state as HrtProviderState;
  }

  registration(): HrtProviderRegistrationPayload | null {
    const session = this.providerRegistry.activeSession();
    if (!session) {
      return null;
    }
    return {
      providerId: session.providerId,
      providerInstanceId: session.providerInstanceId,
      providerVersion: session.providerVersion,
      contractVersion: session.contractVersion,
      supportedCapabilities: session.capabilities,
      capabilityDescriptors: session.capabilityDescriptors,
      platform: session.platform,
      process: session.process,
    };
  }

  refreshHealth() {
    const snapshot = this.provider.healthSnapshot();
    const ownership = this.ownership.checkHealthSnapshot(snapshot);
    if (!ownership.accepted) {
      this.audit.emit("hrt.health.rejected", {
        reason: ownership.reason,
        providerInstanceId: snapshot.providerInstanceId,
      });
      throw new Error(`Health snapshot rejected: ${ownership.reason}`);
    }
    this.providerHealth.accept(snapshot);
    this.providerRegistry.acceptHealth(snapshot);
    for (const device of snapshot.devices) {
      this.registry.upsert(device);
    }
    return snapshot;
  }

  disconnectProvider(nowMs = Date.now()): void {
    const active = this.providerRegistry.activeSession();
    if (!active) {
      return;
    }
    this.ownership.invalidate("PROVIDER_DISCONNECTED", active.providerInstanceId);
    if (active.connectionState !== "DISCONNECTED") {
      this.providerRegistry.disconnectActive();
    }
    const decision = this.supervision.onDisconnect(nowMs);
    this.diagnostics.emit({
      eventCode: decision.reason === "MAX_RESTART_REACHED" ? "HRT_PROVIDER_MAX_RESTART_REACHED" : "HRT_PROVIDER_RESTART_BACKOFF",
      severity: decision.reason === "MAX_RESTART_REACHED" ? "ERROR" : "WARN",
      providerId: active.providerId,
      providerInstanceId: active.providerInstanceId,
      sessionId: active.sessionId,
      lifecycleState: decision.reason === "MAX_RESTART_REACHED" ? "STOPPED" : "DISCONNECTED",
      reason: decision.reason,
      details: {
        restartAttempt: decision.restartAttempt,
        backoffMs: decision.backoffMs,
        inFlightCommandIds: [...this.inFlightCommandIds],
      },
    });
    if (decision.reason === "MAX_RESTART_REACHED") {
      this.providerRegistry.shutdownActive();
    }
  }

  shutdownProvider(): void {
    const active = this.providerRegistry.activeSession();
    if (active) {
      this.ownership.invalidate("PROVIDER_SHUTDOWN", active.providerInstanceId);
    }
    this.providerRegistry.shutdownActive();
  }

  runtimeHealth(): HrtRuntimeHealthSummary {
    const active = this.providerRegistry.activeSession();
    return {
      providerLifecycleState: this.lifecycle.state(),
      providerCompatibility: active?.compatibility?.status ?? this.providerRegistry.lastHandshake()?.status ?? "UNKNOWN",
      providerSupervisionState: this.supervision.state(),
      providerLastHealth: this.providerHealth.view().providerHealth,
      staleInstanceCount: this.providerRegistry.staleSessions().length,
      restartAttempts: this.supervision.restartAttempts(),
      ownershipValid: this.ownership.isValid(),
      diagnosticReason: this.providerRegistry.lastRejection() ?? undefined,
    };
  }

  async execute(command: HrtCommandRequestPayload): Promise<HrtCommandResultPayload> {
    if (this.lifecycle.state() !== "READY" || !this.ownership.isValid()) {
      throw new Error("Provider is not READY");
    }
    const activeSession = this.providerRegistry.activeSession();
    if (!activeSession) {
      throw new Error("Provider registration is missing");
    }
    this.inFlightCommandIds.add(command.commandId);
    let result: HrtCommandResultPayload;
    try {
      result = await this.router.execute(command);
    } finally {
      this.inFlightCommandIds.delete(command.commandId);
    }
    const ownership = this.ownership.checkCommandResult(result);
    if (!ownership.accepted) {
      this.audit.emit("hrt.command.rejected", {
        reason: ownership.reason,
        commandId: command.commandId,
        providerInstanceId: result.providerInstanceId,
      });
      throw new Error("Stale provider instance");
    }
    return result;
  }
}
