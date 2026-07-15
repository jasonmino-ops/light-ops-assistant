import { HrtDeviceHealth } from "@eshop/hrt-contract";

export interface HrtDeviceHealthView {
  health: HrtDeviceHealth;
  sourceProviderInstanceId: string;
  lastUpdatedAt: string;
  stale: boolean;
}

export function createDeviceHealthView(args: {
  health: HrtDeviceHealth;
  sourceProviderInstanceId: string;
  lastUpdatedAt: string;
  stale?: boolean;
}): HrtDeviceHealthView {
  return {
    health: args.health,
    sourceProviderInstanceId: args.sourceProviderInstanceId,
    lastUpdatedAt: args.lastUpdatedAt,
    stale: args.stale ?? false,
  };
}
