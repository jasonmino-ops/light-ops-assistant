import type { AuthorityDecision, ExecutionAuthority } from "./executionAuthority";
import type { SharedExecutionResult, SharedPrintIdentity } from "./sharedPrintingCore";

export type PrintIntentSource =
  | "LOCAL_DESKTOP"
  | "CLOUD_H5"
  | "CLOUD_THIRD_PARTY"
  | "CLOUD_REMOTE_REPRINT";

export type V3ExecutionMode = "V2_ACTIVE" | "V3_ACTIVE" | "BLOCKED_UNKNOWN";

export interface AuthorityAdmissionPort {
  canAdmit(authority: ExecutionAuthority): AuthorityDecision;
}

export interface SharedExecutionPort<TPayload> {
  execute(input: {
    identity: SharedPrintIdentity;
    endpointKey: string;
    payload: TPayload;
  }): Promise<SharedExecutionResult>;
}

export interface ExecutionOutboxPort {
  enqueue(input: { executionId: string; printJobId: string; ownerEpoch: number; outcome: "CROSSED" | "FAILED_NOT_CROSSED" | "CROSSING_UNKNOWN" }): Promise<void>;
}

export type CoordinatedPrintResult =
  | SharedExecutionResult
  | { status: "V2_FALLBACK_REQUIRED" }
  | { status: "AUTHORITY_REJECTED"; reason: string; mode: "ADMISSION_CLOSED" | "FENCED" }
  | { status: "MODE_BLOCKED" }
  | { status: "EXECUTION_RECORDED_REPORT_PENDING"; execution: SharedExecutionResult };

export class LocalFirstPrintCoordinator<TPayload> {
  public constructor(
    private readonly authority: AuthorityAdmissionPort,
    private readonly sharedCore: SharedExecutionPort<TPayload>,
    private readonly outbox: ExecutionOutboxPort,
  ) {}

  public execute(input: {
    mode: V3ExecutionMode;
    source: PrintIntentSource;
    authority: ExecutionAuthority;
    identity: SharedPrintIdentity;
    endpointKey: string;
    payload: TPayload;
  }): Promise<CoordinatedPrintResult> {
    if (input.mode === "V2_ACTIVE") {
      return Promise.resolve({ status: "V2_FALLBACK_REQUIRED" });
    }
    if (input.mode !== "V3_ACTIVE") {
      return Promise.resolve({ status: "MODE_BLOCKED" });
    }

    const admission = this.authority.canAdmit(input.authority);
    if (!admission.allowed) {
      return Promise.resolve({
        status: "AUTHORITY_REJECTED",
        reason: admission.reason,
        mode: admission.mode,
      });
    }

    return this.executeAndRecord(input);
  }

  private async executeAndRecord(input: {
    authority: ExecutionAuthority;
    identity: SharedPrintIdentity;
    endpointKey: string;
    payload: TPayload;
  }): Promise<CoordinatedPrintResult> {
    const execution = await this.sharedCore.execute({
      identity: input.identity,
      endpointKey: input.endpointKey,
      payload: input.payload,
    });
    if (execution.status !== "CROSSED" && execution.status !== "FAILED_NOT_CROSSED" && execution.status !== "CROSSING_UNKNOWN") {
      return execution;
    }
    try {
      await this.outbox.enqueue({
        executionId: execution.record.executionId,
        printJobId: execution.record.printJobId,
        ownerEpoch: input.authority.ownerEpoch,
        outcome: execution.status,
      });
      return execution;
    } catch {
      return { status: "EXECUTION_RECORDED_REPORT_PENDING", execution };
    }
  }
}
