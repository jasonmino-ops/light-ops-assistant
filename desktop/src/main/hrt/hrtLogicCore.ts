import {
  HRT_CONTRACT_VERSION,
  HRT_PROVIDER_COMPATIBILITY_MATRIX,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtProviderRegistrationPayload,
  HrtProviderState,
  evaluateCompatibility,
} from "@eshop/hrt-contract";
import { HrtAuditEmitter } from "./auditEmitter";
import { HrtCommandRouter } from "./commandRouter";
import { HrtDeviceRegistry } from "./deviceRegistry";
import { HrtHealthEngine } from "./healthEngine";
import { HrtProviderClient } from "./providerClient";

export class HrtLogicCore {
  readonly audit = new HrtAuditEmitter();
  readonly registry = new HrtDeviceRegistry();
  readonly router: HrtCommandRouter;
  readonly health: HrtHealthEngine;
  private providerState: HrtProviderState = "NEW";
  private providerRegistration: HrtProviderRegistrationPayload | null = null;

  constructor(private readonly provider: HrtProviderClient) {
    this.router = new HrtCommandRouter(provider, this.audit);
    this.health = new HrtHealthEngine(provider, this.registry);
  }

  registerProvider(): HrtProviderRegistrationPayload {
    const registration = this.provider.register();
    if (
      this.providerRegistration?.providerInstanceId === registration.providerInstanceId &&
      this.providerState === "READY"
    ) {
      this.providerState = "REJECTED";
      this.audit.emit("hrt.provider.rejected", {
        reason: "DUPLICATE_REGISTRATION",
        providerInstanceId: registration.providerInstanceId,
      });
      throw new Error("Duplicate provider registration");
    }
    if (registration.contractVersion !== HRT_CONTRACT_VERSION) {
      this.providerState = "REJECTED";
      this.audit.emit("hrt.provider.rejected", {
        reason: "CONTRACT_VERSION_MISMATCH",
        providerContractVersion: registration.contractVersion,
      });
      throw new Error("Provider contract version mismatch");
    }
    const compatibility = evaluateCompatibility(registration, [
      ...HRT_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities,
    ]);
    if (compatibility.status !== "COMPATIBLE") {
      this.providerState = "REJECTED";
      this.audit.emit("hrt.provider.rejected", {
        reason: compatibility.reason,
        providerInstanceId: registration.providerInstanceId,
        missingCapabilities: compatibility.missingCapabilities,
      });
      throw new Error(`Provider compatibility rejected: ${compatibility.reason}`);
    }
    if (
      this.providerRegistration &&
      this.providerRegistration.providerInstanceId !== registration.providerInstanceId
    ) {
      this.registry.clear();
      this.audit.emit("hrt.provider.restart", {
        previousProviderInstanceId: this.providerRegistration.providerInstanceId,
        providerInstanceId: registration.providerInstanceId,
      });
    }
    this.providerRegistration = registration;
    this.providerState = "READY";
    this.audit.emit("hrt.provider.ready", {
      providerId: registration.providerId,
      providerInstanceId: registration.providerInstanceId,
      capabilities: registration.supportedCapabilities,
    });
    this.health.refresh();
    return registration;
  }

  state(): HrtProviderState {
    return this.providerState;
  }

  registration(): HrtProviderRegistrationPayload | null {
    return this.providerRegistration;
  }

  async execute(command: HrtCommandRequestPayload): Promise<HrtCommandResultPayload> {
    if (this.providerState !== "READY") {
      throw new Error("Provider is not READY");
    }
    if (!this.providerRegistration) {
      throw new Error("Provider registration is missing");
    }
    const result = await this.router.execute(command);
    if (result.providerInstanceId !== this.providerRegistration.providerInstanceId) {
      this.audit.emit("hrt.command.rejected", {
        reason: "STALE_PROVIDER_INSTANCE",
        commandId: command.commandId,
        providerInstanceId: result.providerInstanceId,
      });
      throw new Error("Stale provider instance");
    }
    return result;
  }
}
