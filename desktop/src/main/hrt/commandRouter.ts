import {
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  assertValidCommandRequest,
  assertValidCommandResult,
} from "../../../../packages/hrt-contract/src";
import { HrtAuditEmitter } from "./auditEmitter";
import { HrtProviderClient } from "./providerClient";

export class HrtCommandRouter {
  constructor(
    private readonly provider: HrtProviderClient,
    private readonly audit: HrtAuditEmitter,
  ) {}

  async execute(command: HrtCommandRequestPayload): Promise<HrtCommandResultPayload> {
    assertValidCommandRequest(command);
    this.audit.emit("hrt.command.accepted", {
      commandId: command.commandId,
      commandType: command.commandType,
      deviceId: command.device.deviceId,
    });
    const result = await this.provider.execute(command);
    assertValidCommandResult(result);
    this.audit.emit("hrt.command.result", {
      commandId: result.commandId,
      outcome: result.outcome,
      effectBoundary: result.effectBoundary,
    });
    return result;
  }
}

