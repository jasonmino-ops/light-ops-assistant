import { HrtDeviceHealth, HrtHealthSnapshotPayload, HrtProviderHealth } from "@eshop/hrt-contract";

export interface HrtProviderHealthView {
  providerHealth: HrtProviderHealth | "UNKNOWN";
  providerInstanceId?: string;
  timestamp?: string;
  devices: Array<{
    deviceId: string;
    deviceKind: string;
    health: HrtDeviceHealth;
    sourceProviderInstanceId: string;
    lastUpdatedAt: string;
    stale: boolean;
  }>;
}

export class HrtProviderHealthModel {
  private lastSnapshot: HrtHealthSnapshotPayload | null = null;
  private staleProviderInstanceIds = new Set<string>();

  accept(snapshot: HrtHealthSnapshotPayload): void {
    this.lastSnapshot = snapshot;
  }

  markProviderStale(providerInstanceId: string): void {
    this.staleProviderInstanceIds.add(providerInstanceId);
  }

  view(): HrtProviderHealthView {
    if (!this.lastSnapshot) {
      return {
        providerHealth: "UNKNOWN",
        devices: [],
      };
    }
    const snapshot = this.lastSnapshot;
    return {
      providerHealth: snapshot.providerHealth,
      providerInstanceId: snapshot.providerInstanceId,
      timestamp: snapshot.timestamp,
      devices: snapshot.devices.map((entry) => ({
        deviceId: entry.device.deviceId,
        deviceKind: entry.device.deviceKind,
        health: entry.health,
        sourceProviderInstanceId: snapshot.providerInstanceId,
        lastUpdatedAt: snapshot.timestamp,
        stale: this.staleProviderInstanceIds.has(snapshot.providerInstanceId),
      })),
    };
  }
}
