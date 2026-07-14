import { HrtHealthSnapshotPayload } from "@eshop/hrt-contract";
import { HrtDeviceRegistry } from "./deviceRegistry";
import { HrtProviderClient } from "./providerClient";

export class HrtHealthEngine {
  constructor(
    private readonly provider: HrtProviderClient,
    private readonly registry: HrtDeviceRegistry,
  ) {}

  refresh(): HrtHealthSnapshotPayload {
    const snapshot = this.provider.healthSnapshot();
    for (const device of snapshot.devices) {
      this.registry.upsert(device);
    }
    return snapshot;
  }
}
