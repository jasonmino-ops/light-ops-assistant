export type SharedLedgerState =
  | "NOT_CROSSED"
  | "CROSSING_UNKNOWN"
  | "CROSSED"
  | "FAILED_NOT_CROSSED"
  | "CANCELLED";

export type SharedLedgerRecord = {
  printJobId: string;
  executionId: string;
  state: SharedLedgerState;
  stateVersion: number;
  physicalCompletionKnown: false;
};

export type SharedExecutionPermit = {
  printJobId: string;
  executionId: string;
  stateVersion: number;
};

type PortError = { code: string; message: string };
export type PortResult<T> = { ok: true; value: T } | { ok: false; error: PortError };

export type SharedPrintIdentity = {
  printJobId: string;
  requestHash: string;
  rendererVersion: string;
  expiresAt: string;
};

export interface SharedPrintingLedgerPort {
  accept(input: SharedPrintIdentity): Promise<PortResult<{
    kind: "CREATED" | "EXISTING";
    record: SharedLedgerRecord;
  }>>;
  beginCrossing(guard: {
    printJobId: string;
    expectedExecutionId: string;
    expectedStateVersion: number;
  }): Promise<PortResult<{ record: SharedLedgerRecord; executionPermit: SharedExecutionPermit }>>;
  confirmNotCrossed(proof: {
    executionPermit: SharedExecutionPermit;
    zeroBytesSent: true;
    lastErrorCode?: string;
  }): Promise<PortResult<SharedLedgerRecord>>;
  markCrossed(proof: {
    printJobId: string;
    expectedExecutionId: string;
    expectedStateVersion: number;
    allBytesWritten: true;
    flushAndFinConfirmed: true;
  }): Promise<PortResult<SharedLedgerRecord>>;
}

export type EffectBoundaryResult =
  | { outcome: "NOT_CROSSED"; zeroBytesSent: true; errorCode?: string }
  | { outcome: "CROSSED"; allBytesWritten: true; flushAndFinConfirmed: true }
  | { outcome: "UNKNOWN"; reason: string };

export interface PrintingEffectBoundary<TPayload> {
  cross(input: {
    identity: SharedPrintIdentity;
    executionPermit: SharedExecutionPermit;
    endpointKey: string;
    payload: TPayload;
    validateExecution: ExecutionSafetyCheck;
  }): Promise<EffectBoundaryResult>;
}

export type ExecutionSafetyCheck = () => Promise<PortResult<void>> | PortResult<void>;
export type DurableBarrierObserver = (record: SharedLedgerRecord) => Promise<PortResult<void>>;
export interface EndpointMutexPort {
  runExclusive<T>(endpointKey: string, operation: () => Promise<T>): Promise<T>;
}

export type SharedExecutionResult =
  | { status: "CROSSED" | "FAILED_NOT_CROSSED"; record: SharedLedgerRecord }
  | { status: "CROSSING_UNKNOWN"; record: SharedLedgerRecord; reason: string }
  | { status: "NOT_EXECUTED"; record: SharedLedgerRecord; reason: "EXISTING_NON_EXECUTABLE" }
  | { status: "REJECTED"; error: PortError };

function guard(record: SharedLedgerRecord) {
  return {
    printJobId: record.printJobId,
    expectedExecutionId: record.executionId,
    expectedStateVersion: record.stateVersion,
  };
}

export class SharedPrintingCore<TPayload> {
  private readonly endpointTails = new Map<string, Promise<void>>();

  public constructor(
    private readonly ledger: SharedPrintingLedgerPort,
    private readonly boundary: PrintingEffectBoundary<TPayload>,
    private readonly endpointMutex: EndpointMutexPort,
  ) {}

  public async execute(input: {
    identity: SharedPrintIdentity;
    endpointKey: string;
    payload: TPayload;
    validateExecution: ExecutionSafetyCheck;
    onDurableBarrier: DurableBarrierObserver;
  }): Promise<SharedExecutionResult> {
    if (typeof input.endpointKey !== "string" || input.endpointKey.length === 0) {
      return {
        status: "REJECTED",
        error: { code: "SHARED_CORE_INVALID_ENDPOINT", message: "endpointKey is required." },
      };
    }

    const previous = this.endpointTails.get(input.endpointKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.endpointTails.set(input.endpointKey, tail);

    await previous.catch(() => undefined);
    try {
      return await this.endpointMutex.runExclusive(input.endpointKey, () => this.executeAtEndpoint(input));
    } finally {
      release();
      if (this.endpointTails.get(input.endpointKey) === tail) {
        this.endpointTails.delete(input.endpointKey);
      }
    }
  }

  private async executeAtEndpoint(input: {
    identity: SharedPrintIdentity;
    endpointKey: string;
    payload: TPayload;
    validateExecution: ExecutionSafetyCheck;
    onDurableBarrier: DurableBarrierObserver;
  }): Promise<SharedExecutionResult> {
    const admission = await input.validateExecution();
    if (!admission.ok) return { status: "REJECTED", error: admission.error };
    const accepted = await this.ledger.accept(input.identity);
    if (!accepted.ok) return { status: "REJECTED", error: accepted.error };

    if (accepted.value.record.state !== "NOT_CROSSED") {
      return {
        status: "NOT_EXECUTED",
        record: accepted.value.record,
        reason: "EXISTING_NON_EXECUTABLE",
      };
    }

    const crossing = await this.ledger.beginCrossing(guard(accepted.value.record));
    if (!crossing.ok) return { status: "REJECTED", error: crossing.error };

    const reportedUnknown = await input.onDurableBarrier(crossing.value.record);
    if (!reportedUnknown.ok) {
      return { status: "CROSSING_UNKNOWN", record: crossing.value.record, reason: "OUTBOX_DURABILITY_FAILURE" };
    }
    const effectAdmission = await input.validateExecution();
    if (!effectAdmission.ok) {
      return { status: "CROSSING_UNKNOWN", record: crossing.value.record, reason: "EXECUTION_AUTHORITY_REVOKED" };
    }

    let outcome: EffectBoundaryResult;
    try {
      outcome = await this.boundary.cross({
        identity: input.identity,
        executionPermit: crossing.value.executionPermit,
        endpointKey: input.endpointKey,
        payload: input.payload,
        validateExecution: input.validateExecution,
      });
    } catch {
      return {
        status: "CROSSING_UNKNOWN",
        record: crossing.value.record,
        reason: "BOUNDARY_THROW",
      };
    }

    if (outcome.outcome === "UNKNOWN") {
      return {
        status: "CROSSING_UNKNOWN",
        record: crossing.value.record,
        reason: outcome.reason,
      };
    }

    if (outcome.outcome === "NOT_CROSSED") {
      const completed = await this.ledger.confirmNotCrossed({
        executionPermit: crossing.value.executionPermit,
        zeroBytesSent: true,
        ...(outcome.errorCode === undefined ? {} : { lastErrorCode: outcome.errorCode }),
      });
      return completed.ok
        ? { status: "FAILED_NOT_CROSSED", record: completed.value }
        : { status: "REJECTED", error: completed.error };
    }

    const completed = await this.ledger.markCrossed({
      ...guard(crossing.value.record),
      allBytesWritten: true,
      flushAndFinConfirmed: true,
    });
    return completed.ok
      ? { status: "CROSSED", record: completed.value }
      : { status: "REJECTED", error: completed.error };
  }
}
