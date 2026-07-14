import { HrtCapability, HrtDeviceHealth, HrtDeviceRef } from "@eshop/hrt-contract";

export interface RegisteredHrtDevice {
  device: HrtDeviceRef;
  capabilities: HrtCapability[];
  health: HrtDeviceHealth;
}

export class HrtDeviceRegistry {
  private readonly devices = new Map<string, RegisteredHrtDevice>();

  upsert(device: RegisteredHrtDevice): void {
    this.devices.set(device.device.deviceId, device);
  }

  get(deviceId: string): RegisteredHrtDevice | undefined {
    return this.devices.get(deviceId);
  }

  list(): RegisteredHrtDevice[] {
    return [...this.devices.values()];
  }
}
