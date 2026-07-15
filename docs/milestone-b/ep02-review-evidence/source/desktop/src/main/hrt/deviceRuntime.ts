import {
  HrtCommandRequestPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from "@eshop/hrt-contract";
import { HrtDeviceAssignmentRuntime, HrtAssignmentResult } from "./deviceAssignment";
import { evaluateDeviceCommandEligibility, HrtDeviceCommandGateResult } from "./deviceCommandGate";
import { HrtDeviceOwnershipRuntime } from "./deviceOwnership";
import { HrtDeviceRegistry, RegisteredHrtDevice } from "./deviceRegistry";
import { HrtDeviceScope, HrtDeviceSlotReference, scopeMatches } from "./deviceSlot";
import { HrtRuntimeDiagnostics } from "./runtimeDiagnostics";

const supportedDeviceKinds = new Set(["PRINTER", "SCANNER", "CUSTOMER_DISPLAY"]);

export interface HrtDeviceReferenceEligibility {
  accepted: boolean;
  reason?: "UNKNOWN_DEVICE" | "UNASSIGNED_DEVICE" | "OWNERSHIP_INVALID" | "STALE_PROVIDER_INSTANCE" | "INVALID_SCOPE";
}

export class HrtDeviceRuntime {
  readonly registry: HrtDeviceRegistry;
  readonly assignments: HrtDeviceAssignmentRuntime;
  readonly ownership: HrtDeviceOwnershipRuntime;
  private readonly slots = new Map<string, HrtDeviceSlotReference>();
  private activeProviderId: string | null = null;
  private activeProviderInstanceId: string | null = null;

  constructor(
    diagnostics: HrtRuntimeDiagnostics,
    registry = new HrtDeviceRegistry(),
  ) {
    this.registry = registry;
    this.assignments = new HrtDeviceAssignmentRuntime(diagnostics);
    this.ownership = new HrtDeviceOwnershipRuntime(diagnostics);
  }

  authorizeProvider(registration: HrtProviderRegistrationPayload): void {
    this.activeProviderId = registration.providerId;
    this.activeProviderInstanceId = registration.providerInstanceId;
  }

  invalidateProviderInstance(providerInstanceId: string, reason: string): RegisteredHrtDevice[] {
    const devices = this.registry.markStaleByProviderInstance(providerInstanceId, "STALE_PROVIDER");
    this.assignments.invalidateByProviderInstance(providerInstanceId, reason);
    for (const device of devices) {
      if (device.ownership) {
        this.registry.setOwnership(
          device.physicalDeviceId,
          this.ownership.invalidate(device.ownership, "STALE_PROVIDER", reason),
        );
      }
    }
    return devices;
  }

  registerSlot(slot: HrtDeviceSlotReference): void {
    if (!supportedDeviceKinds.has(slot.expectedDeviceKind)) {
      throw new Error("Device slot rejected: UNSUPPORTED_DEVICE_KIND");
    }
    this.slots.set(slot.slotId, slot);
  }

  listSlots(): HrtDeviceSlotReference[] {
    return [...this.slots.values()];
  }

  acceptHealthSnapshot(snapshot: HrtHealthSnapshotPayload): RegisteredHrtDevice[] {
    if (!this.activeProviderId || !this.activeProviderInstanceId) {
      throw new Error("Device Runtime provider is not authorized");
    }
    if (snapshot.providerInstanceId !== this.activeProviderInstanceId) {
      throw new Error("Device health rejected: STALE_PROVIDER_INSTANCE");
    }
    return snapshot.devices.map((entry) => {
      if (!entry.device.deviceId) {
        throw new Error("Device registration rejected: INVALID_PHYSICAL_IDENTITY");
      }
      if (!supportedDeviceKinds.has(entry.device.deviceKind)) {
        throw new Error("Device registration rejected: UNSUPPORTED_DEVICE_KIND");
      }
      const device = this.registry.upsert({
        providerId: this.activeProviderId!,
        providerInstanceId: snapshot.providerInstanceId,
        device: entry.device,
        capabilities: entry.capabilities,
        health: entry.health,
        now: snapshot.timestamp,
      });
      const ownership = this.ownership.create({
        physicalDeviceId: device.physicalDeviceId,
        providerId: this.activeProviderId!,
        providerInstanceId: snapshot.providerInstanceId,
        now: snapshot.timestamp,
      });
      this.registry.setOwnership(device.physicalDeviceId, ownership);
      return this.registry.get(device.physicalDeviceId)!;
    });
  }

  assign(args: { slotId: string; physicalDeviceId: string }): HrtAssignmentResult {
    const slot = this.slots.get(args.slotId);
    if (!slot) {
      return { accepted: false, reason: "UNKNOWN_SLOT" };
    }
    const device = this.registry.get(args.physicalDeviceId);
    if (!device) {
      return { accepted: false, reason: "UNKNOWN_DEVICE" };
    }
    if (device.device.deviceKind !== slot.expectedDeviceKind) {
      return { accepted: false, reason: "KIND_MISMATCH" };
    }
    if (!slot.requiredCapabilities.every((capability) => device.capabilities.includes(capability))) {
      return { accepted: false, reason: "CAPABILITY_MISMATCH" };
    }
    if (device.ownershipState !== "VALID" || device.providerInstanceId !== this.activeProviderInstanceId) {
      return { accepted: false, reason: "STALE_PROVIDER_INSTANCE" };
    }
    const result = this.assignments.assign({
      slot,
      physicalDeviceId: device.physicalDeviceId,
      providerId: device.providerId,
      providerInstanceId: device.providerInstanceId,
      scope: slot.scope,
      revision: slot.revision,
    });
    if (result.accepted && result.assignment) {
      this.registry.setAssignment({
        physicalDeviceId: device.physicalDeviceId,
        assignmentId: result.assignment.assignmentId,
        assignmentState: result.assignment.assignmentState,
        slotReference: slot,
      });
    }
    return result;
  }

  evaluateCommand(command: HrtCommandRequestPayload): HrtDeviceCommandGateResult {
    const device = this.registry.getByProviderLocalDeviceId(command.device.deviceId, this.activeProviderInstanceId ?? undefined)
      ?? this.registry.get(command.device.deviceId);
    return evaluateDeviceCommandEligibility({ command, device });
  }

  evaluateDeviceReference(args: {
    deviceId: string;
    providerInstanceId: string;
    scope: HrtDeviceScope;
  }): HrtDeviceReferenceEligibility {
    const device = this.registry.getByProviderLocalDeviceId(args.deviceId, args.providerInstanceId);
    if (!device?.ownership) {
      return { accepted: false, reason: "UNKNOWN_DEVICE" };
    }
    if (device.assignmentState !== "ASSIGNED" || !device.slotReference) {
      return { accepted: false, reason: "UNASSIGNED_DEVICE" };
    }
    const ownership = this.ownership.check(device.ownership, args.providerInstanceId, "COMMAND_ELIGIBILITY");
    if (!ownership.accepted) {
      return { accepted: false, reason: ownership.reason === "STALE_PROVIDER_INSTANCE" ? "STALE_PROVIDER_INSTANCE" : "OWNERSHIP_INVALID" };
    }
    if (!scopeMatches(device.slotReference.scope, args.scope)) {
      return { accepted: false, reason: "INVALID_SCOPE" };
    }
    return { accepted: true };
  }
}
