import {
  HrtCapability,
  HrtCommandRequestPayload,
  HrtEffectBoundary,
  HrtJsonValue,
} from "@eshop/hrt-contract";
import { RegisteredHrtDevice } from "./deviceRegistry";
import { HrtProviderSession } from "./providerSession";
import { HrtRuntimeCommandState, HrtRuntimeCommandTransition } from "./commandLifecycle";

export type HrtCommandSource = "POS" | "SYSTEM" | "TEST" | "UNKNOWN";

export interface HrtRuntimeCommandEnvelope {
  commandId: string;
  commandType: HrtCommandRequestPayload["commandType"];
  target: HrtCommandRequestPayload["device"];
  requiredCapability: HrtCapability;
  payload: Record<string, HrtJsonValue>;
  metadata?: Record<string, HrtJsonValue>;
  source: HrtCommandSource;
  correlationId: string;
  createdAt: string;
  deadlineAt?: string;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export type HrtCommandFailureCode =
  | "INVALID_COMMAND"
  | "INVALID_PAYLOAD"
  | "TARGET_NOT_FOUND"
  | "DEVICE_UNAVAILABLE"
  | "CAPABILITY_UNSUPPORTED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "DISPATCH_REJECTED"
  | "EXECUTION_TIMEOUT"
  | "EXECUTION_FAILED"
  | "INVALID_STATE_TRANSITION"
  | "INTERNAL_RUNTIME_ERROR"
  | "COMMAND_CANCELLED";

export type HrtCommandFailureCategory =
  | "VALIDATION"
  | "TARGET"
  | "DEVICE"
  | "PROVIDER"
  | "DISPATCH"
  | "EXECUTION"
  | "LIFECYCLE"
  | "INTERNAL"
  | "CANCELLED";

export type HrtRuntimeCommandResultStatus =
  | "SUCCESS"
  | "REJECTED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED";

export interface HrtRuntimeCommandFailure {
  code: HrtCommandFailureCode;
  category: HrtCommandFailureCategory;
  message: string;
}

export interface HrtRuntimeCommandResult {
  commandId: string;
  status: HrtRuntimeCommandResultStatus;
  errorCode?: HrtCommandFailureCode;
  errorCategory?: HrtCommandFailureCategory;
  errorMessage?: string;
  timestamp: string;
  providerId?: string;
  providerInstanceId?: string;
  deviceId?: string;
  physicalDeviceId?: string;
  correlationId?: string;
  output?: Record<string, HrtJsonValue>;
  effectBoundary?: HrtEffectBoundary;
  lifecycleState: HrtRuntimeCommandState;
  transitions: HrtRuntimeCommandTransition[];
}

export interface HrtCommandDispatchRequest {
  command: HrtRuntimeCommandEnvelope;
  legacyCommand: HrtCommandRequestPayload;
  provider: HrtProviderSession;
  device: RegisteredHrtDevice;
}

export interface HrtCommandExecutorResult {
  accepted: boolean;
  status: HrtRuntimeCommandResultStatus;
  effectBoundary: HrtEffectBoundary;
  providerInstanceId: string;
  output?: Record<string, HrtJsonValue>;
  failure?: HrtRuntimeCommandFailure;
}

export interface HrtCommandExecutorPort {
  dispatch(request: HrtCommandDispatchRequest): Promise<HrtCommandExecutorResult>;
}
