import {
  HrtCompatibilityResultPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from "@eshop/hrt-contract";
import { HrtProviderLifecycleState } from "./providerLifecycle";

export type HrtConnectionState = "DISCONNECTED" | "CONNECTED";
export type HrtHandshakeState = "NOT_STARTED" | "IN_PROGRESS" | "ACCEPTED" | "REJECTED";

export interface HrtProviderSession {
  sessionId: string;
  providerId: string;
  providerInstanceId: string;
  providerVersion: string;
  contractVersion: string;
  capabilities: HrtProviderRegistrationPayload["supportedCapabilities"];
  capabilityDescriptors: HrtProviderRegistrationPayload["capabilityDescriptors"];
  platform: HrtProviderRegistrationPayload["platform"];
  process: HrtProviderRegistrationPayload["process"];
  connectionState: HrtConnectionState;
  handshakeState: HrtHandshakeState;
  lifecycleState: HrtProviderLifecycleState;
  createdAt: string;
  registeredAt?: string;
  handshakeStartedAt?: string;
  readyAt?: string;
  disconnectedAt?: string;
  stoppedAt?: string;
  lastActivityAt: string;
  lastHealth?: HrtHealthSnapshotPayload;
  rejectionReason?: string;
  compatibility?: HrtCompatibilityResultPayload;
  ownershipValid: boolean;
  stale: boolean;
}

export function createProviderSession(
  registration: HrtProviderRegistrationPayload,
  now = new Date().toISOString(),
): HrtProviderSession {
  return {
    sessionId: `${registration.providerId}:${registration.providerInstanceId}:${registration.process.startedAt}`,
    providerId: registration.providerId,
    providerInstanceId: registration.providerInstanceId,
    providerVersion: registration.providerVersion,
    contractVersion: registration.contractVersion,
    capabilities: [...registration.supportedCapabilities],
    capabilityDescriptors: [...registration.capabilityDescriptors],
    platform: registration.platform,
    process: registration.process,
    connectionState: "CONNECTED",
    handshakeState: "NOT_STARTED",
    lifecycleState: "REGISTERED",
    createdAt: now,
    registeredAt: now,
    lastActivityAt: now,
    ownershipValid: false,
    stale: false,
  };
}

export function markSessionStale(session: HrtProviderSession, now = new Date().toISOString()): HrtProviderSession {
  return {
    ...session,
    connectionState: "DISCONNECTED",
    lifecycleState: "DISCONNECTED",
    disconnectedAt: session.disconnectedAt ?? now,
    lastActivityAt: now,
    ownershipValid: false,
    stale: true,
  };
}
