export const SETUP_STAGE_ORDER = [
  'preflight',
  'desktop',
  'qz',
  'certificate',
  'driver',
  'printer-discovery',
  'queue',
  'runtime-health',
] as const

export type SetupStage = (typeof SETUP_STAGE_ORDER)[number]

export const SETUP_FAILURE_CODES = [
  'UNSUPPORTED_WINDOWS',
  'ADMIN_REQUIRED',
  'PREFLIGHT_FAILED',
  'CLOUD_OFFLINE',
  'DESKTOP_INSTALL_FAILED',
  'QZ_INSTALL_FAILED',
  'CERTIFICATE_CONFIG_FAILED',
  'EXTERNAL_DRIVER_REQUIRED',
  'DRIVER_INSTALL_FAILED',
  'PRINTER_NOT_FOUND',
  'USER_CONFIRM_REQUIRED',
  'QUEUE_PROVISION_FAILED',
  'HEALTH_CHECK_FAILED',
] as const

export type SetupFailureCode = (typeof SETUP_FAILURE_CODES)[number]

export type StageStatus = 'READY' | 'NEEDS_ACTION' | 'BLOCKED'

export type GlobalRuntimeState = 'BLOCKED' | 'READY_FOR_BINDING' | 'READY_FOR_BUSINESS'

export type MerchantBindingStatus = 'NOT_BOUND' | 'WAITING' | 'VALID' | 'INVALID'

export type SetupEvidenceValue =
  | string
  | number
  | boolean
  | null
  | SetupEvidenceValue[]
  | { [key: string]: SetupEvidenceValue }

export type SetupEvidence = Record<string, SetupEvidenceValue>

export type StageResult = {
  status: StageStatus
  failureCode: SetupFailureCode | null
  message: string
  retryable: boolean
  evidence: SetupEvidence
}

export type SetupCheckpoint = {
  schema: 'eshop.setup.checkpoint.v1'
  updatedAt: string
  globalState: GlobalRuntimeState
  stages: Partial<Record<SetupStage, StageResult>>
}

export type SetupStageContext = {
  runId: string
  bindingStatus: MerchantBindingStatus
  previousResult: StageResult | null
}

export type SetupStageAdapter = {
  readonly stage: SetupStage
  detect(context: SetupStageContext): Promise<StageResult>
  execute(context: SetupStageContext): Promise<StageResult>
}

export type SetupRunResult = {
  runId: string
  state: GlobalRuntimeState
  stoppedAt: SetupStage | null
  stageResults: Partial<Record<SetupStage, StageResult>>
}

export interface SetupCheckpointStore {
  load(): Promise<SetupCheckpoint | null>
  save(checkpoint: SetupCheckpoint): Promise<void>
}

export type SetupStageLogEntry = {
  runId: string
  stage: SetupStage
  event: 'START' | 'END'
  startedAt: string
  endedAt: string | null
  result: StageStatus | null
  failureCode: SetupFailureCode | null
  retryable: boolean | null
  evidenceSummary: SetupEvidence
}

export interface SetupLogger {
  write(entry: SetupStageLogEntry): Promise<void>
}
