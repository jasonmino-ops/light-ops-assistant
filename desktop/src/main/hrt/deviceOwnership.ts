import { HrtRuntimeDiagnostics } from "./runtimeDiagnostics";

export type HrtDeviceOwnershipState = "VALID" | "STALE_PROVIDER" | "INVALIDATED" | "UNKNOWN";

export interface HrtDeviceOwnership {
  physicalDeviceId: string;
  providerId: string;
  providerInstanceId: string;
  ownershipState: HrtDeviceOwnershipState;
  updatedAt: string;
  reason?: string;
}

export type HrtDeviceOwnershipSubject =
  | "DEVICE_REGISTRATION"
  | "DEVICE_HEALTH"
  | "COMMAND_ELIGIBILITY"
  | "DISPLAY_TARGET"
  | "COMMAND_RESULT_RELATION";

export interface HrtDeviceOwnershipCheck {
  accepted: boolean;
  reason: "ACCEPTED" | "UNKNOWN_DEVICE" | "STALE_PROVIDER_INSTANCE" | "OWNERSHIP_INVALID";
}

export class HrtDeviceOwnershipRuntime {
  constructor(private readonly diagnostics: HrtRuntimeDiagnostics) {}

  create(args: {
    physicalDeviceId: string;
    providerId: string;
    providerInstanceId: string;
    now?: string;
  }): HrtDeviceOwnership {
    return {
      physicalDeviceId: args.physicalDeviceId,
      providerId: args.providerId,
      providerInstanceId: args.providerInstanceId,
      ownershipState: "VALID",
      updatedAt: args.now ?? new Date().toISOString(),
    };
  }

  invalidate(
    ownership: HrtDeviceOwnership,
    state: Exclude<HrtDeviceOwnershipState, "VALID">,
    reason: string,
    now = new Date().toISOString(),
  ): HrtDeviceOwnership {
    const next = {
      ...ownership,
      ownershipState: state,
      updatedAt: now,
      reason,
    };
    this.diagnostics.emit({
      eventCode: "HRT_DEVICE_OWNERSHIP_INVALIDATED",
      severity: "WARN",
      providerId: ownership.providerId,
      providerInstanceId: ownership.providerInstanceId,
      reason,
      details: {
        physicalDeviceId: ownership.physicalDeviceId,
        ownershipState: state,
      },
    });
    return next;
  }

  check(
    ownership: HrtDeviceOwnership | undefined,
    providerInstanceId: string,
    subject: HrtDeviceOwnershipSubject,
  ): HrtDeviceOwnershipCheck {
    if (!ownership) {
      return { accepted: false, reason: "UNKNOWN_DEVICE" };
    }
    if (ownership.ownershipState !== "VALID") {
      this.auditRejected(ownership, subject, "OWNERSHIP_INVALID", providerInstanceId);
      return { accepted: false, reason: "OWNERSHIP_INVALID" };
    }
    if (ownership.providerInstanceId !== providerInstanceId) {
      this.auditRejected(ownership, subject, "STALE_PROVIDER_INSTANCE", providerInstanceId);
      return { accepted: false, reason: "STALE_PROVIDER_INSTANCE" };
    }
    return { accepted: true, reason: "ACCEPTED" };
  }

  private auditRejected(
    ownership: HrtDeviceOwnership,
    subject: HrtDeviceOwnershipSubject,
    reason: HrtDeviceOwnershipCheck["reason"],
    sourceProviderInstanceId: string,
  ): void {
    this.diagnostics.emit({
      eventCode: "HRT_DEVICE_STALE_INPUT_REJECTED",
      severity: "WARN",
      providerId: ownership.providerId,
      providerInstanceId: sourceProviderInstanceId,
      reason,
      details: {
        physicalDeviceId: ownership.physicalDeviceId,
        owningProviderInstanceId: ownership.providerInstanceId,
        subject,
      },
    });
  }
}
