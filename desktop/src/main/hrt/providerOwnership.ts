import {
  HrtCommandResultPayload,
  HrtCustomerDisplaySnapshotPayload,
  HrtDeviceEventPayload,
  HrtHealthSnapshotPayload,
} from "@eshop/hrt-contract";
import { HrtRuntimeDiagnostics } from "./runtimeDiagnostics";

export type HrtOwnershipSubject = "COMMAND_RESULT" | "SCANNER_EVENT" | "DISPLAY_RESPONSE" | "HEALTH_SNAPSHOT" | "DEVICE_REGISTRATION";

export interface HrtOwnershipCheck {
  accepted: boolean;
  reason: "ACCEPTED" | "NO_ACTIVE_INSTANCE" | "STALE_PROVIDER_INSTANCE" | "OWNERSHIP_INVALID";
}

export class HrtProviderOwnership {
  private authoritativeProviderInstanceId: string | null = null;
  private ownershipValid = false;

  constructor(private readonly diagnostics: HrtRuntimeDiagnostics) {}

  authorize(providerInstanceId: string): void {
    this.authoritativeProviderInstanceId = providerInstanceId;
    this.ownershipValid = true;
  }

  invalidate(reason: string, providerInstanceId = this.authoritativeProviderInstanceId ?? undefined): void {
    this.ownershipValid = false;
    this.diagnostics.emit({
      eventCode: "HRT_PROVIDER_OWNERSHIP_INVALIDATED",
      severity: "WARN",
      providerInstanceId,
      reason,
    });
  }

  activeProviderInstanceId(): string | null {
    return this.authoritativeProviderInstanceId;
  }

  isValid(): boolean {
    return this.ownershipValid;
  }

  check(providerInstanceId: string, subject: HrtOwnershipSubject): HrtOwnershipCheck {
    if (!this.authoritativeProviderInstanceId) {
      return { accepted: false, reason: "NO_ACTIVE_INSTANCE" };
    }
    if (!this.ownershipValid) {
      this.auditRejected(subject, providerInstanceId, "OWNERSHIP_INVALID");
      return { accepted: false, reason: "OWNERSHIP_INVALID" };
    }
    if (providerInstanceId !== this.authoritativeProviderInstanceId) {
      this.auditRejected(subject, providerInstanceId, "STALE_PROVIDER_INSTANCE");
      return { accepted: false, reason: "STALE_PROVIDER_INSTANCE" };
    }
    return { accepted: true, reason: "ACCEPTED" };
  }

  checkCommandResult(result: HrtCommandResultPayload): HrtOwnershipCheck {
    return this.check(result.providerInstanceId, "COMMAND_RESULT");
  }

  checkScannerEvent(event: HrtDeviceEventPayload): HrtOwnershipCheck {
    return this.check(event.providerInstanceId, "SCANNER_EVENT");
  }

  checkDisplaySnapshot(snapshot: HrtCustomerDisplaySnapshotPayload): HrtOwnershipCheck {
    return this.check(snapshot.providerInstanceId, "DISPLAY_RESPONSE");
  }

  checkHealthSnapshot(snapshot: HrtHealthSnapshotPayload): HrtOwnershipCheck {
    return this.check(snapshot.providerInstanceId, "HEALTH_SNAPSHOT");
  }

  private auditRejected(subject: HrtOwnershipSubject, providerInstanceId: string, reason: HrtOwnershipCheck["reason"]): void {
    this.diagnostics.emit({
      eventCode: "HRT_PROVIDER_STALE_INSTANCE_REJECTED",
      severity: "WARN",
      providerInstanceId,
      reason,
      details: { subject },
    });
  }
}
