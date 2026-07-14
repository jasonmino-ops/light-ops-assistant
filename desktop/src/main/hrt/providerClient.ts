import {
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from "../../../../packages/hrt-contract/src";

export interface HrtProviderClient {
  register(): HrtProviderRegistrationPayload;
  execute(command: HrtCommandRequestPayload): Promise<HrtCommandResultPayload> | HrtCommandResultPayload;
  healthSnapshot(): HrtHealthSnapshotPayload;
}

