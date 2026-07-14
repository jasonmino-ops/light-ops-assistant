import {
  HRT_CONTRACT_VERSION,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtProviderRegistrationPayload,
  HrtProviderState,
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
    if (registration.contractVersion !== HRT_CONTRACT_VERSION) {
      this.providerState = "REJECTED";
      this.audit.emit("hrt.provider.rejected", {
        reason: "CONTRACT_VERSION_MISMATCH",
        providerContractVersion: registration.contractVersion,
      });
      throw new Error("Provider contract version mismatch");
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
    return this.router.execute(command);
  }
}
