import {
  HrtCommandDispatchRequest,
  HrtCommandExecutorPort,
  HrtCommandExecutorResult,
} from "./commandRuntimeTypes";

export type HrtFakeCommandExecutorMode = "SUCCESS" | "REJECT" | "FAIL" | "TIMEOUT" | "DELAY_SUCCESS";

export class HrtFakeCommandExecutor implements HrtCommandExecutorPort {
  constructor(
    private mode: HrtFakeCommandExecutorMode = "SUCCESS",
    private readonly delayMs = 0,
  ) {}

  setMode(mode: HrtFakeCommandExecutorMode): void {
    this.mode = mode;
  }

  async dispatch(request: HrtCommandDispatchRequest): Promise<HrtCommandExecutorResult> {
    if (this.delayMs > 0 || this.mode === "DELAY_SUCCESS") {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs || 25));
    }

    if (this.mode === "REJECT") {
      return {
        accepted: false,
        status: "REJECTED",
        effectBoundary: "NOT_CROSSED",
        providerInstanceId: request.provider.providerInstanceId,
        failure: {
          code: "DISPATCH_REJECTED",
          category: "DISPATCH",
          message: "Fake executor rejected dispatch",
        },
      };
    }

    if (this.mode === "FAIL") {
      return {
        accepted: true,
        status: "FAILED",
        effectBoundary: "CROSSING_UNKNOWN",
        providerInstanceId: request.provider.providerInstanceId,
        failure: {
          code: "EXECUTION_FAILED",
          category: "EXECUTION",
          message: "Fake executor failed execution",
        },
      };
    }

    if (this.mode === "TIMEOUT") {
      return {
        accepted: true,
        status: "TIMED_OUT",
        effectBoundary: "CROSSING_UNKNOWN",
        providerInstanceId: request.provider.providerInstanceId,
        failure: {
          code: "EXECUTION_TIMEOUT",
          category: "EXECUTION",
          message: "Fake executor timed out",
        },
      };
    }

    return {
      accepted: true,
      status: "SUCCESS",
      effectBoundary: "CROSSED",
      providerInstanceId: request.provider.providerInstanceId,
      output: { fakeExecutor: true },
    };
  }
}
