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

export type CoordinatedPrintResult =
  | SharedExecutionResult
  | { status: "V2_FALLBACK_REQUIRED" }
  | { status: "AUTHORITY_REJECTED"; reason: string; mode: "ADMISSION_CLOSED" | "FENCED" }
  | { status: "MODE_BLOCKED" };

export class LocalFirstPrintCoordinator<TPayload> {
  public constructor(
    private readonly authority: AuthorityAdmissionPort,
    private readonly sharedCore: SharedExecutionPort<TPayload>,
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

    return this.sharedCore.execute({
      identity: input.identity,
      endpointKey: input.endpointKey,
      payload: input.payload,
    });
  }
}
