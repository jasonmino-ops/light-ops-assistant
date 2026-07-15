import { HrtCapability, HrtDeviceKind } from "@eshop/hrt-contract";

export interface HrtDeviceScope {
  storeId: string;
  terminalId: string;
}

export interface HrtDeviceSlotReference {
  slotId: string;
  storeId: string;
  terminalId: string;
  expectedDeviceKind: HrtDeviceKind;
  requiredCapabilities: HrtCapability[];
  scope: HrtDeviceScope;
  sourceVersion?: string;
  revision?: string;
}

export function createDeviceSlotReference(args: {
  slotId: string;
  storeId: string;
  terminalId: string;
  expectedDeviceKind: HrtDeviceKind;
  requiredCapabilities: HrtCapability[];
  sourceVersion?: string;
  revision?: string;
}): HrtDeviceSlotReference {
  return {
    ...args,
    requiredCapabilities: [...args.requiredCapabilities],
    scope: {
      storeId: args.storeId,
      terminalId: args.terminalId,
    },
  };
}

export function scopeMatches(left: HrtDeviceScope, right: HrtDeviceScope): boolean {
  return left.storeId === right.storeId && left.terminalId === right.terminalId;
}
