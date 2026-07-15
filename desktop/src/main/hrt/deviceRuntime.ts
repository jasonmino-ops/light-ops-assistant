import {
  HrtCommandRequestPayload,
  HrtDeviceEventPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from "@eshop/hrt-contract";
import { HrtDeviceAssignmentRuntime, HrtAssignmentResult } from "./deviceAssignment";
import { evaluateDeviceCommandEligibility, HrtDeviceCommandGateResult } from "./deviceCommandGate";
import { HrtDeviceOwnershipRuntime } from "./deviceOwnership";
import { HrtDeviceRegistry, RegisteredHrtDevice } from "./deviceRegistry";
import { HrtDeviceSlotReference, scopeMatches } from "./deviceSlot";
import { HrtRuntimeDiagnostics } from "./runtimeDiagnostics";

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

  acceptScannerEvent(event: HrtDeviceEventPayload): void {
    const device = this.registry.getByProviderLocalDeviceId(event.device.deviceId, event.providerInstanceId);
    if (!device?.ownership) {
      throw new Error("Scanner event rejected: UNKNOWN_DEVICE");
    }
    const ownership = this.ownership.check(device.ownership, event.providerInstanceId, "SCANNER_EVENT_SOURCE");
    if (!ownership.accepted) {
      throw new Error(`Scanner event rejected: ${ownership.reason}`);
    }
    if (!device.slotReference || !scopeMatches(device.slotReference.scope, event.scope)) {
      throw new Error("Scanner event rejected: INVALID_SCOPE");
    }
  }
}
