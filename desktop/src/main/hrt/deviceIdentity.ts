import { HrtCapability, HrtDeviceKind, HrtDeviceRef } from "@eshop/hrt-contract";

export type HrtDeviceIdentityStability = "STABLE" | "PROVIDER_LOCAL" | "RUNTIME_DERIVED";
export type HrtDeviceIdentitySource = "HEALTH_SNAPSHOT" | "DEVICE_REGISTRATION" | "SIMULATOR" | "TEST_FIXTURE";
export type HrtDeviceRegistrationState = "UNKNOWN" | "DISCOVERED" | "REGISTERED" | "STALE" | "REMOVED";

export interface HrtPhysicalDeviceIdentity {
  physicalDeviceId: string;
  providerId: string;
  providerInstanceId: string;
  deviceKind: HrtDeviceKind;
  providerLocalDeviceId: string;
  identityStability: HrtDeviceIdentityStability;
  identityEvidence: Record<string, string>;
  capabilities: HrtCapability[];
  discoveredAt: string;
  lastSeenAt: string;
  source: HrtDeviceIdentitySource;
}

export function physicalDeviceIdFor(args: {
  providerId: string;
  deviceKind: HrtDeviceKind;
  providerLocalDeviceId: string;
}): string {
  return `${args.providerId}:${args.deviceKind}:${args.providerLocalDeviceId}`;
}

export function createPhysicalDeviceIdentity(args: {
  providerId: string;
  providerInstanceId: string;
  device: HrtDeviceRef;
  capabilities: HrtCapability[];
  source: HrtDeviceIdentitySource;
  now?: string;
}): HrtPhysicalDeviceIdentity {
  const now = args.now ?? new Date().toISOString();
  return {
    physicalDeviceId: physicalDeviceIdFor({
      providerId: args.providerId,
      deviceKind: args.device.deviceKind,
      providerLocalDeviceId: args.device.deviceId,
    }),
    providerId: args.providerId,
    providerInstanceId: args.providerInstanceId,
    deviceKind: args.device.deviceKind,
    providerLocalDeviceId: args.device.deviceId,
    identityStability: "PROVIDER_LOCAL",
    identityEvidence: {
      providerLocalDeviceId: args.device.deviceId,
      deviceKind: args.device.deviceKind,
    },
    capabilities: [...args.capabilities],
    discoveredAt: now,
    lastSeenAt: now,
    source: args.source,
  };
}
