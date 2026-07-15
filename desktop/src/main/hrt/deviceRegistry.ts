import { HrtCapability, HrtDeviceHealth, HrtDeviceKind, HrtDeviceRef } from "@eshop/hrt-contract";
import {
  createPhysicalDeviceIdentity,
  HrtDeviceRegistrationState,
  HrtPhysicalDeviceIdentity,
} from "./deviceIdentity";
import { HrtDeviceAssignmentState } from "./deviceAssignment";
import { HrtDeviceHealthView, createDeviceHealthView } from "./deviceHealth";
import { HrtDeviceOwnership, HrtDeviceOwnershipState } from "./deviceOwnership";
import { HrtDeviceSlotReference } from "./deviceSlot";

export interface RegisteredHrtDevice {
  device: HrtDeviceRef;
  capabilities: HrtCapability[];
  health: HrtDeviceHealth;
  physicalIdentity: HrtPhysicalDeviceIdentity;
  physicalDeviceId: string;
  providerId: string;
  providerInstanceId: string;
  registrationState: HrtDeviceRegistrationState;
  assignmentState: HrtDeviceAssignmentState;
  ownershipState: HrtDeviceOwnershipState;
  healthState: HrtDeviceHealth;
  healthView: HrtDeviceHealthView;
  stale: boolean;
  slotReference?: HrtDeviceSlotReference;
  assignmentId?: string;
  ownership?: HrtDeviceOwnership;
}

export interface RegisterHrtDeviceInput {
  providerId: string;
  providerInstanceId: string;
  device: HrtDeviceRef;
  capabilities: HrtCapability[];
  health: HrtDeviceHealth;
  now?: string;
}

export class HrtDeviceRegistry {
  private readonly devices = new Map<string, RegisteredHrtDevice>();
  private readonly physicalIdByProviderLocalId = new Map<string, string>();

  upsert(device: RegisterHrtDeviceInput | Pick<RegisteredHrtDevice, "device" | "capabilities" | "health">): RegisteredHrtDevice {
    const input = this.normalizeInput(device);
    const now = input.now ?? new Date().toISOString();
    const physicalIdentity = createPhysicalDeviceIdentity({
      providerId: input.providerId,
      providerInstanceId: input.providerInstanceId,
      device: input.device,
      capabilities: input.capabilities,
      source: "HEALTH_SNAPSHOT",
      now,
    });
    const current = this.devices.get(physicalIdentity.physicalDeviceId);
    const next: RegisteredHrtDevice = {
      ...current,
      device: input.device,
      capabilities: [...input.capabilities],
      health: input.health,
      physicalIdentity: current
        ? {
            ...current.physicalIdentity,
            providerInstanceId: input.providerInstanceId,
            capabilities: [...input.capabilities],
            lastSeenAt: now,
          }
        : physicalIdentity,
      physicalDeviceId: physicalIdentity.physicalDeviceId,
      providerId: input.providerId,
      providerInstanceId: input.providerInstanceId,
      registrationState: "REGISTERED",
      assignmentState: current?.assignmentState ?? "UNASSIGNED",
      ownershipState: current?.ownershipState ?? "VALID",
      healthState: input.health,
      healthView: createDeviceHealthView({
        health: input.health,
        sourceProviderInstanceId: input.providerInstanceId,
        lastUpdatedAt: now,
        stale: false,
      }),
      stale: false,
      slotReference: current?.slotReference,
      assignmentId: current?.assignmentId,
      ownership: current?.ownership,
    };
    this.devices.set(next.physicalDeviceId, next);
    this.physicalIdByProviderLocalId.set(this.providerLocalKey(input.providerInstanceId, input.device.deviceId), next.physicalDeviceId);
    return next;
  }

  setOwnership(physicalDeviceId: string, ownership: HrtDeviceOwnership): RegisteredHrtDevice | undefined {
    const current = this.devices.get(physicalDeviceId);
    if (!current) {
      return undefined;
    }
    const next = {
      ...current,
      ownership,
      ownershipState: ownership.ownershipState,
    };
    this.devices.set(physicalDeviceId, next);
    return next;
  }

  setAssignment(args: {
    physicalDeviceId: string;
    assignmentId?: string;
    assignmentState: HrtDeviceAssignmentState;
    slotReference?: HrtDeviceSlotReference;
  }): RegisteredHrtDevice | undefined {
    const current = this.devices.get(args.physicalDeviceId);
    if (!current) {
      return undefined;
    }
    const next = {
      ...current,
      assignmentId: args.assignmentId,
      assignmentState: args.assignmentState,
      slotReference: args.slotReference,
    };
    this.devices.set(args.physicalDeviceId, next);
    return next;
  }

  markStaleByProviderInstance(providerInstanceId: string, reason: "STALE_PROVIDER" | "INVALIDATED" = "STALE_PROVIDER"): RegisteredHrtDevice[] {
    const staleDevices: RegisteredHrtDevice[] = [];
    for (const device of this.devices.values()) {
      if (device.providerInstanceId !== providerInstanceId) {
        continue;
      }
      const next: RegisteredHrtDevice = {
        ...device,
        registrationState: "STALE",
        assignmentState: device.assignmentState === "ASSIGNED" ? "AWAITING_REBIND" : device.assignmentState,
        ownershipState: reason,
        healthView: {
          ...device.healthView,
          stale: true,
        },
        stale: true,
      };
      this.devices.set(device.physicalDeviceId, next);
      staleDevices.push(next);
    }
    return staleDevices;
  }

  get(deviceId: string): RegisteredHrtDevice | undefined {
    return this.devices.get(deviceId) ?? this.getByProviderLocalDeviceId(deviceId);
  }

  getByProviderLocalDeviceId(deviceId: string, providerInstanceId?: string): RegisteredHrtDevice | undefined {
    if (providerInstanceId) {
      const physicalDeviceId = this.physicalIdByProviderLocalId.get(this.providerLocalKey(providerInstanceId, deviceId));
      return physicalDeviceId ? this.devices.get(physicalDeviceId) : undefined;
    }
    return [...this.devices.values()].find((device) => device.device.deviceId === deviceId);
  }

  getBySlot(slotId: string): RegisteredHrtDevice | undefined {
    return [...this.devices.values()].find((device) => device.slotReference?.slotId === slotId);
  }

  list(): RegisteredHrtDevice[] {
    return [...this.devices.values()];
  }

  listByKind(deviceKind: HrtDeviceKind): RegisteredHrtDevice[] {
    return this.list().filter((device) => device.device.deviceKind === deviceKind);
  }

  listByCapability(capability: HrtCapability): RegisteredHrtDevice[] {
    return this.list().filter((device) => device.capabilities.includes(capability));
  }

  listByProviderInstance(providerInstanceId: string): RegisteredHrtDevice[] {
    return this.list().filter((device) => device.providerInstanceId === providerInstanceId);
  }

  listUnassigned(): RegisteredHrtDevice[] {
    return this.list().filter((device) => device.assignmentState !== "ASSIGNED");
  }

  listStale(): RegisteredHrtDevice[] {
    return this.list().filter((device) => device.stale);
  }

  clear(): void {
    this.devices.clear();
    this.physicalIdByProviderLocalId.clear();
  }

  private normalizeInput(
    device: RegisterHrtDeviceInput | Pick<RegisteredHrtDevice, "device" | "capabilities" | "health">,
  ): RegisterHrtDeviceInput {
    if ("providerId" in device && "providerInstanceId" in device) {
      return device;
    }
    return {
      providerId: "unknown-provider",
      providerInstanceId: "unknown-provider-instance",
      device: device.device,
      capabilities: device.capabilities,
      health: device.health,
    };
  }

  private providerLocalKey(providerInstanceId: string, deviceId: string): string {
    return `${providerInstanceId}:${deviceId}`;
  }
}
