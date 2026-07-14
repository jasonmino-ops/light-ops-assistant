import {
  HRT_CONTRACT_VERSION,
  HRT_PROVIDER_COMPATIBILITY_MATRIX,
  HrtCompatibilityResultPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
  evaluateCompatibility,
} from "@eshop/hrt-contract";
import { HrtProviderLifecycle } from "./providerLifecycle";
import { createProviderSession, HrtProviderSession, markSessionStale } from "./providerSession";
import { HrtRuntimeDiagnostics } from "./runtimeDiagnostics";

export type HrtProviderRegistrationDecision =
  | "ACCEPTED_FIRST_REGISTRATION"
  | "REJECTED_DUPLICATE_SAME_INSTANCE"
  | "ACCEPTED_RESTART_NEW_INSTANCE"
  | "REJECTED_CONFLICTING_PROVIDER"
  | "REJECTED_INCOMPATIBLE";

export interface HrtProviderRegistrationResult {
  decision: HrtProviderRegistrationDecision;
  session?: HrtProviderSession;
  staleSession?: HrtProviderSession;
  compatibility?: HrtCompatibilityResultPayload;
  reason?: string;
}

export class HrtProviderRegistry {
  private activeSessionValue: HrtProviderSession | null = null;
  private readonly staleSessionsValue: HrtProviderSession[] = [];
  private readonly rejectedSessionsValue: HrtProviderSession[] = [];
  private lastHandshakeValue: HrtCompatibilityResultPayload | null = null;
  private lastRejectionValue: string | null = null;
  private lastDisconnectAtValue: string | null = null;

  constructor(
    private readonly lifecycle: HrtProviderLifecycle,
    private readonly diagnostics: HrtRuntimeDiagnostics,
  ) {}

  register(registration: HrtProviderRegistrationPayload): HrtProviderRegistrationResult {
    const now = new Date().toISOString();
    const session = createProviderSession(registration, now);

    if (registration.providerId !== HRT_PROVIDER_COMPATIBILITY_MATRIX.providerId) {
      return this.reject(session, "CONFLICTING_PROVIDER", "REJECTED_CONFLICTING_PROVIDER");
    }

    if (registration.contractVersion !== HRT_CONTRACT_VERSION) {
      return this.reject(session, "CONTRACT_VERSION_MISMATCH", "REJECTED_INCOMPATIBLE");
    }

    const compatibility = evaluateCompatibility(registration, [
      ...HRT_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities,
    ]);
    session.compatibility = compatibility;
    this.lastHandshakeValue = compatibility;
    if (compatibility.status !== "COMPATIBLE") {
      return this.reject(session, compatibility.reason, "REJECTED_INCOMPATIBLE", compatibility);
    }

    if (!this.activeSessionValue) {
      this.lifecycle.transitionTo("REGISTERED", "REGISTRATION_ACCEPTED");
      session.handshakeState = "IN_PROGRESS";
      session.handshakeStartedAt = now;
      this.lifecycle.transitionTo("HANDSHAKING", "HANDSHAKE_STARTED");
      session.handshakeState = "ACCEPTED";
      session.lifecycleState = "READY";
      session.readyAt = now;
      session.ownershipValid = true;
      this.lifecycle.transitionTo("READY", "HANDSHAKE_ACCEPTED");
      this.activeSessionValue = session;
      this.auditAccepted(session, "HRT_PROVIDER_REGISTRATION_ACCEPTED");
      return { decision: "ACCEPTED_FIRST_REGISTRATION", session, compatibility };
    }

    if (this.activeSessionValue.providerId !== registration.providerId) {
      return this.reject(session, "CONFLICTING_PROVIDER", "REJECTED_CONFLICTING_PROVIDER", compatibility);
    }

    if (this.activeSessionValue.providerInstanceId === registration.providerInstanceId) {
      return this.reject(session, "DUPLICATE_REGISTRATION", "REJECTED_DUPLICATE_SAME_INSTANCE", compatibility);
    }

    const staleSession = markSessionStale(this.activeSessionValue, now);
    this.staleSessionsValue.push(staleSession);
    try {
      this.lifecycle.transitionTo("DISCONNECTED", "PROVIDER_RESTARTED");
      this.lifecycle.transitionTo("REGISTERED", "REGISTRATION_ACCEPTED");
      this.lifecycle.transitionTo("HANDSHAKING", "HANDSHAKE_STARTED");
      this.lifecycle.transitionTo("READY", "HANDSHAKE_ACCEPTED");
    } catch {
      // Registry state is still authoritative; diagnostics preserve the restart evidence.
    }
    this.diagnostics.emit({
      eventCode: "HRT_PROVIDER_STALE_INSTANCE_MARKED",
      severity: "WARN",
      providerId: staleSession.providerId,
      providerInstanceId: staleSession.providerInstanceId,
      sessionId: staleSession.sessionId,
      lifecycleState: "DISCONNECTED",
      reason: "PROVIDER_RESTARTED",
    });
    session.handshakeState = "IN_PROGRESS";
    session.handshakeStartedAt = now;
    session.handshakeState = "ACCEPTED";
    session.lifecycleState = "READY";
    session.readyAt = now;
    session.ownershipValid = true;
    this.activeSessionValue = session;
    this.auditAccepted(session, "HRT_PROVIDER_RESTART_ACCEPTED");
    return {
      decision: "ACCEPTED_RESTART_NEW_INSTANCE",
      session,
      staleSession,
      compatibility,
    };
  }

  activeSession(): HrtProviderSession | null {
    return this.activeSessionValue;
  }

  staleSessions(): HrtProviderSession[] {
    return [...this.staleSessionsValue];
  }

  rejectedSessions(): HrtProviderSession[] {
    return [...this.rejectedSessionsValue];
  }

  lastHandshake(): HrtCompatibilityResultPayload | null {
    return this.lastHandshakeValue;
  }

  lastRejection(): string | null {
    return this.lastRejectionValue;
  }

  lastDisconnectAt(): string | null {
    return this.lastDisconnectAtValue;
  }

  acceptHealth(snapshot: HrtHealthSnapshotPayload): void {
    if (!this.activeSessionValue || this.activeSessionValue.providerInstanceId !== snapshot.providerInstanceId) {
      return;
    }
    this.activeSessionValue = {
      ...this.activeSessionValue,
      lastHealth: snapshot,
      lastActivityAt: snapshot.timestamp,
    };
  }

  disconnectActive(reason = "PROVIDER_DISCONNECTED"): HrtProviderSession | null {
    if (!this.activeSessionValue) {
      return null;
    }
    const now = new Date().toISOString();
    this.activeSessionValue = {
      ...this.activeSessionValue,
      connectionState: "DISCONNECTED",
      lifecycleState: "DISCONNECTED",
      disconnectedAt: now,
      lastActivityAt: now,
      ownershipValid: false,
    };
    this.lastDisconnectAtValue = now;
    this.lifecycle.transitionTo("DISCONNECTED", "PROVIDER_DISCONNECTED");
    this.diagnostics.emit({
      eventCode: "HRT_PROVIDER_DISCONNECTED",
      severity: "WARN",
      providerId: this.activeSessionValue.providerId,
      providerInstanceId: this.activeSessionValue.providerInstanceId,
      sessionId: this.activeSessionValue.sessionId,
      lifecycleState: "DISCONNECTED",
      reason,
    });
    return this.activeSessionValue;
  }

  shutdownActive(): HrtProviderSession | null {
    if (!this.activeSessionValue) {
      return null;
    }
    const now = new Date().toISOString();
    if (this.lifecycle.state() === "DISCONNECTED") {
      this.lifecycle.transitionTo("STOPPED", "PROVIDER_STOPPED");
    } else {
      this.lifecycle.transitionTo("SHUTTING_DOWN", "SHUTDOWN_REQUESTED");
      this.lifecycle.transitionTo("STOPPED", "PROVIDER_STOPPED");
    }
    this.activeSessionValue = {
      ...this.activeSessionValue,
      connectionState: "DISCONNECTED",
      lifecycleState: "STOPPED",
      stoppedAt: now,
      lastActivityAt: now,
      ownershipValid: false,
    };
    this.diagnostics.emit({
      eventCode: "HRT_PROVIDER_STOPPED",
      severity: "INFO",
      providerId: this.activeSessionValue.providerId,
      providerInstanceId: this.activeSessionValue.providerInstanceId,
      sessionId: this.activeSessionValue.sessionId,
      lifecycleState: "STOPPED",
      reason: "PROVIDER_STOPPED",
    });
    return this.activeSessionValue;
  }

  private reject(
    session: HrtProviderSession,
    reason: string,
    decision: HrtProviderRegistrationDecision,
    compatibility?: HrtCompatibilityResultPayload,
  ): HrtProviderRegistrationResult {
    session.connectionState = "DISCONNECTED";
    session.handshakeState = "REJECTED";
    session.lifecycleState = "REJECTED";
    session.rejectionReason = reason;
    session.compatibility = compatibility;
    session.ownershipValid = false;
    this.rejectedSessionsValue.push(session);
    this.lastRejectionValue = reason;
    if (this.lifecycle.state() !== "REJECTED") {
      try {
        this.lifecycle.transitionTo("REJECTED", decision === "REJECTED_DUPLICATE_SAME_INSTANCE" ? "DUPLICATE_REGISTRATION" : "HANDSHAKE_REJECTED");
      } catch {
        // Rejections can occur after READY; registry records them without forcing an invalid global transition.
      }
    }
    this.diagnostics.emit({
      eventCode: "HRT_PROVIDER_REGISTRATION_REJECTED",
      severity: "ERROR",
      providerId: session.providerId,
      providerInstanceId: session.providerInstanceId,
      sessionId: session.sessionId,
      lifecycleState: "REJECTED",
      reason,
      details: { decision },
    });
    return { decision, session, compatibility, reason };
  }

  private auditAccepted(session: HrtProviderSession, eventCode: string): void {
    this.diagnostics.emit({
      eventCode,
      severity: "INFO",
      providerId: session.providerId,
      providerInstanceId: session.providerInstanceId,
      sessionId: session.sessionId,
      lifecycleState: "READY",
      reason: "HANDSHAKE_ACCEPTED",
      details: {
        providerVersion: session.providerVersion,
        contractVersion: session.contractVersion,
        capabilities: session.capabilities,
      },
    });
  }
}
