import { HrtProviderHealth } from "@eshop/hrt-contract";
import { HrtLifecycleTransitionReason, HrtProviderLifecycleState } from "./providerLifecycle";

export type HrtDiagnosticSeverity = "INFO" | "WARN" | "ERROR";

export interface HrtRuntimeDiagnosticEvent {
  eventCode: string;
  severity: HrtDiagnosticSeverity;
  timestamp: string;
  providerId?: string;
  providerInstanceId?: string;
  sessionId?: string;
  lifecycleState?: HrtProviderLifecycleState;
  previousState?: HrtProviderLifecycleState;
  newState?: HrtProviderLifecycleState;
  correlationId?: string;
  reason?: string;
  redactedDetails: Record<string, unknown>;
}

export interface HrtRuntimeHealthSummary {
  providerLifecycleState: HrtProviderLifecycleState;
  providerCompatibility: "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";
  providerSupervisionState: string;
  providerLastHealth: HrtProviderHealth | "UNKNOWN";
  staleInstanceCount: number;
  restartAttempts: number;
  ownershipValid: boolean;
  diagnosticReason?: string;
}

const sensitiveKeyPattern = /(secret|token|password|privateKey|authorization|cookie)/i;

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    redacted[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : value;
  }
  return redacted;
}

export class HrtRuntimeDiagnostics {
  private readonly events: HrtRuntimeDiagnosticEvent[] = [];

  emit(event: Omit<HrtRuntimeDiagnosticEvent, "timestamp" | "redactedDetails"> & {
    details?: Record<string, unknown>;
  }): HrtRuntimeDiagnosticEvent {
    const diagnostic: HrtRuntimeDiagnosticEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      redactedDetails: redactDetails(event.details ?? {}),
    };
    this.events.push(diagnostic);
    return diagnostic;
  }

  lifecycleTransition(args: {
    providerId?: string;
    providerInstanceId?: string;
    sessionId?: string;
    previousState: HrtProviderLifecycleState;
    newState: HrtProviderLifecycleState;
    reason: HrtLifecycleTransitionReason;
  }): void {
    this.emit({
      eventCode: "HRT_PROVIDER_LIFECYCLE_TRANSITION",
      severity: "INFO",
      providerId: args.providerId,
      providerInstanceId: args.providerInstanceId,
      sessionId: args.sessionId,
      lifecycleState: args.newState,
      previousState: args.previousState,
      newState: args.newState,
      reason: args.reason,
    });
  }

  list(): HrtRuntimeDiagnosticEvent[] {
    return [...this.events];
  }
}
