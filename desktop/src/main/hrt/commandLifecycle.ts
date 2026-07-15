export type HrtRuntimeCommandState =
  | "CREATED"
  | "VALIDATING"
  | "REJECTED"
  | "ACCEPTED"
  | "DISPATCH_READY"
  | "DISPATCHED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED";

export interface HrtRuntimeCommandTransition {
  from: HrtRuntimeCommandState;
  to: HrtRuntimeCommandState;
  reason: string;
  timestamp: string;
}

const terminalStates = new Set<HrtRuntimeCommandState>([
  "REJECTED",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
]);

const allowedTransitions: Record<HrtRuntimeCommandState, HrtRuntimeCommandState[]> = {
  CREATED: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["DISPATCH_READY", "CANCELLED"],
  DISPATCH_READY: ["DISPATCHED", "REJECTED", "CANCELLED"],
  DISPATCHED: ["EXECUTING", "REJECTED", "FAILED", "TIMED_OUT", "CANCELLED"],
  EXECUTING: ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"],
  REJECTED: [],
  SUCCEEDED: [],
  FAILED: [],
  TIMED_OUT: [],
  CANCELLED: [],
};

export class HrtRuntimeCommandLifecycle {
  private currentStateValue: HrtRuntimeCommandState = "CREATED";
  private readonly transitionsValue: HrtRuntimeCommandTransition[] = [];

  state(): HrtRuntimeCommandState {
    return this.currentStateValue;
  }

  history(): HrtRuntimeCommandTransition[] {
    return [...this.transitionsValue];
  }

  isTerminal(): boolean {
    return terminalStates.has(this.currentStateValue);
  }

  transitionTo(nextState: HrtRuntimeCommandState, reason: string, now = new Date().toISOString()): HrtRuntimeCommandTransition {
    if (terminalStates.has(this.currentStateValue)) {
      throw new Error(`Illegal command lifecycle transition: terminal state ${this.currentStateValue}`);
    }
    if (!allowedTransitions[this.currentStateValue].includes(nextState)) {
      throw new Error(`Illegal command lifecycle transition: ${this.currentStateValue} -> ${nextState}`);
    }
    const transition = {
      from: this.currentStateValue,
      to: nextState,
      reason,
      timestamp: now,
    };
    this.currentStateValue = nextState;
    this.transitionsValue.push(transition);
    return transition;
  }
}
