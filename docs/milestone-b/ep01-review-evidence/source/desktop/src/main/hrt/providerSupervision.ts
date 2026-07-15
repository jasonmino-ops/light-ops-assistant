export type HrtProviderSupervisionState = "IDLE" | "HEALTHY" | "BACKING_OFF" | "DEGRADED" | "STOPPED";

export interface HrtProviderSupervisionPolicy {
  initialBackoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  maxRestartAttempts: number;
  restartWindowMs: number;
}

export interface HrtRestartDecision {
  supervisionState: HrtProviderSupervisionState;
  restartAllowed: boolean;
  restartAttempt: number;
  backoffMs: number;
  reason: "RESTART_SCHEDULED" | "MAX_RESTART_REACHED" | "MANUAL_RESET";
}

export const defaultProviderSupervisionPolicy: HrtProviderSupervisionPolicy = {
  initialBackoffMs: 500,
  backoffMultiplier: 2,
  maxBackoffMs: 5000,
  maxRestartAttempts: 3,
  restartWindowMs: 60000,
};

export class HrtProviderSupervision {
  private stateValue: HrtProviderSupervisionState = "IDLE";
  private restartAttemptsValue = 0;
  private firstRestartAtMs: number | null = null;
  private lastBackoffMsValue = 0;

  constructor(private readonly policy: HrtProviderSupervisionPolicy = defaultProviderSupervisionPolicy) {}

  state(): HrtProviderSupervisionState {
    return this.stateValue;
  }

  restartAttempts(): number {
    return this.restartAttemptsValue;
  }

  lastBackoffMs(): number {
    return this.lastBackoffMsValue;
  }

  markHealthy(): void {
    this.stateValue = "HEALTHY";
  }

  onDisconnect(nowMs: number): HrtRestartDecision {
    if (this.firstRestartAtMs === null || nowMs - this.firstRestartAtMs > this.policy.restartWindowMs) {
      this.firstRestartAtMs = nowMs;
      this.restartAttemptsValue = 0;
    }
    this.restartAttemptsValue += 1;
    if (this.restartAttemptsValue > this.policy.maxRestartAttempts) {
      this.stateValue = "STOPPED";
      this.lastBackoffMsValue = 0;
      return {
        supervisionState: this.stateValue,
        restartAllowed: false,
        restartAttempt: this.restartAttemptsValue,
        backoffMs: 0,
        reason: "MAX_RESTART_REACHED",
      };
    }
    this.lastBackoffMsValue = Math.min(
      this.policy.initialBackoffMs * this.policy.backoffMultiplier ** (this.restartAttemptsValue - 1),
      this.policy.maxBackoffMs,
    );
    this.stateValue = this.restartAttemptsValue === this.policy.maxRestartAttempts ? "DEGRADED" : "BACKING_OFF";
    return {
      supervisionState: this.stateValue,
      restartAllowed: true,
      restartAttempt: this.restartAttemptsValue,
      backoffMs: this.lastBackoffMsValue,
      reason: "RESTART_SCHEDULED",
    };
  }

  manualReset(): HrtRestartDecision {
    this.restartAttemptsValue = 0;
    this.firstRestartAtMs = null;
    this.lastBackoffMsValue = 0;
    this.stateValue = "IDLE";
    return {
      supervisionState: this.stateValue,
      restartAllowed: true,
      restartAttempt: 0,
      backoffMs: 0,
      reason: "MANUAL_RESET",
    };
  }
}
