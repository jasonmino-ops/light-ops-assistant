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
    validateExecution: () => Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    onDurableBarrier: (record: { executionId: string; printJobId: string }) => Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
  }): Promise<SharedExecutionResult>;
}

export interface ExecutionModePort {
  current(): "V2_ACTIVE" | "V2_DRAINING" | "V3_ACTIVE" | "V3_DRAINING" | "BLOCKED_UNKNOWN";
}

export interface ExecutionOutboxPort {
  enqueue(input: { batchId: string; executionId: string; printJobId: string; source: PrintIntentSource; role: "FRONT" | "KITCHEN"; ownerEpoch: number; outcome: "CROSSED" | "FAILED_NOT_CROSSED" | "CROSSING_UNKNOWN"; reportable: boolean }): Promise<void>;
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
    private readonly mode: ExecutionModePort,
  ) {}

  public execute(input: {
    mode: V3ExecutionMode;
    source: PrintIntentSource;
    role: "FRONT" | "KITCHEN";
    authority: ExecutionAuthority;
    identity: SharedPrintIdentity;
    endpointKey: string;
    payload: TPayload;
  }): Promise<CoordinatedPrintResult> {
    const currentMode = this.mode.current();
    if (currentMode === "V2_ACTIVE") {
      return Promise.resolve({ status: "V2_FALLBACK_REQUIRED" });
    }
    if (currentMode !== "V3_ACTIVE") {
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
    source: PrintIntentSource;
    role: "FRONT" | "KITCHEN";
    identity: SharedPrintIdentity;
    endpointKey: string;
    payload: TPayload;
  }): Promise<CoordinatedPrintResult> {
    const execution = await this.sharedCore.execute({
      identity: input.identity,
      endpointKey: input.endpointKey,
      payload: input.payload,
      validateExecution: async () => {
        if (this.mode.current() !== "V3_ACTIVE") {
          return { ok: false, error: { code: "MODE_NOT_V3_ACTIVE", message: "V3 execution mode is no longer active." } };
        }
        const decision = this.authority.canAdmit(input.authority);
        return decision.allowed
          ? { ok: true, value: undefined }
          : { ok: false, error: { code: `AUTHORITY_${decision.mode}`, message: decision.reason } };
      },
      onDurableBarrier: async (record) => {
        try {
          await this.outbox.enqueue({
            batchId: input.authority.batchId,
            executionId: record.executionId,
            printJobId: record.printJobId,
            source: input.source,
            role: input.role,
            ownerEpoch: input.authority.ownerEpoch,
            outcome: "CROSSING_UNKNOWN",
            reportable: false,
          });
          return { ok: true, value: undefined };
        } catch {
          return { ok: false, error: { code: "OUTBOX_DURABILITY_FAILURE", message: "Unable to persist crossing report." } };
        }
      },
    });
    if (execution.status === "REJECTED") return execution;
    const reportableStatus = execution.status === "NOT_EXECUTED" ? execution.record.state : execution.status;
    if (reportableStatus !== "CROSSED" && reportableStatus !== "FAILED_NOT_CROSSED" && reportableStatus !== "CROSSING_UNKNOWN") {
      return execution;
    }
    try {
      await this.outbox.enqueue({
        batchId: input.authority.batchId,
        executionId: execution.record.executionId,
        printJobId: execution.record.printJobId,
        source: input.source,
        role: input.role,
        ownerEpoch: input.authority.ownerEpoch,
        outcome: reportableStatus,
        reportable: true,
      });
      return execution;
    } catch {
      return { status: "EXECUTION_RECORDED_REPORT_PENDING", execution };
    }
  }
}
