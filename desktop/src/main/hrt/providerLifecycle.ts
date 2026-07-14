export type HrtProviderLifecycleState =
  | "NEW"
  | "CONNECTING"
  | "REGISTERED"
  | "HANDSHAKING"
  | "READY"
  | "DEGRADED"
  | "DISCONNECTED"
  | "REJECTED"
  | "SHUTTING_DOWN"
  | "STOPPED";

export type HrtLifecycleTransitionReason =
  | "CONNECT_REQUESTED"
  | "REGISTRATION_ACCEPTED"
  | "HANDSHAKE_STARTED"
  | "HANDSHAKE_ACCEPTED"
  | "HANDSHAKE_REJECTED"
  | "DUPLICATE_REGISTRATION"
  | "CONFLICTING_PROVIDER"
  | "PROVIDER_RESTARTED"
  | "PROVIDER_DISCONNECTED"
  | "PROVIDER_RECONNECTED"
  | "PROVIDER_DEGRADED"
  | "SHUTDOWN_REQUESTED"
  | "PROVIDER_STOPPED"
  | "STALE_SESSION"
  | "SUPERVISION_MAX_RESTART_REACHED"
  | "MANUAL_RESET";

const allowedTransitions: Record<HrtProviderLifecycleState, ReadonlySet<HrtProviderLifecycleState>> = {
  NEW: new Set(["CONNECTING", "REGISTERED", "REJECTED", "STOPPED"]),
  CONNECTING: new Set(["REGISTERED", "DISCONNECTED", "REJECTED", "STOPPED"]),
  REGISTERED: new Set(["HANDSHAKING", "REJECTED", "DISCONNECTED", "STOPPED"]),
  HANDSHAKING: new Set(["READY", "REJECTED", "DISCONNECTED", "STOPPED"]),
  READY: new Set(["DEGRADED", "DISCONNECTED", "SHUTTING_DOWN", "STOPPED"]),
  DEGRADED: new Set(["READY", "DISCONNECTED", "SHUTTING_DOWN", "STOPPED"]),
  DISCONNECTED: new Set(["CONNECTING", "REGISTERED", "REJECTED", "STOPPED"]),
  REJECTED: new Set(["CONNECTING", "REGISTERED", "STOPPED"]),
  SHUTTING_DOWN: new Set(["STOPPED"]),
  STOPPED: new Set(["CONNECTING"]),
};

export interface HrtLifecycleTransition {
  previousState: HrtProviderLifecycleState;
  newState: HrtProviderLifecycleState;
  reason: HrtLifecycleTransitionReason;
  timestamp: string;
}

export class HrtProviderLifecycle {
  private currentState: HrtProviderLifecycleState = "NEW";
  private readonly transitions: HrtLifecycleTransition[] = [];

  state(): HrtProviderLifecycleState {
    return this.currentState;
  }

  transitionTo(newState: HrtProviderLifecycleState, reason: HrtLifecycleTransitionReason): HrtLifecycleTransition {
    if (newState === this.currentState) {
      throw new Error(`Illegal provider lifecycle transition: ${this.currentState} -> ${newState}`);
    }
    if (!allowedTransitions[this.currentState].has(newState)) {
      throw new Error(`Illegal provider lifecycle transition: ${this.currentState} -> ${newState}`);
    }
    const transition: HrtLifecycleTransition = {
      previousState: this.currentState,
      newState,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.currentState = newState;
    this.transitions.push(transition);
    return transition;
  }

  history(): HrtLifecycleTransition[] {
    return [...this.transitions];
  }
}

export function isReadyLifecycleState(state: HrtProviderLifecycleState): boolean {
  return state === "READY" || state === "DEGRADED";
}
