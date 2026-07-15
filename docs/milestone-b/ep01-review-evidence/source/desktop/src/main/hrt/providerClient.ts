import {
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from "@eshop/hrt-contract";

export interface HrtProviderClient {
  register(): HrtProviderRegistrationPayload;
  execute(command: HrtCommandRequestPayload): Promise<HrtCommandResultPayload> | HrtCommandResultPayload;
  healthSnapshot(): HrtHealthSnapshotPayload;
}
