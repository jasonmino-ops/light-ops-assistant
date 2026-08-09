import {
  SETUP_STAGE_ORDER,
  type SetupFailureCode,
  type SetupStage,
  type SetupStageAdapter,
  type StageResult,
} from './contracts'

export const REUSED_EXISTING_ASSETS = Object.freeze({
  desktop: 'Existing formal E-Shop Desktop installer and electron-builder flow',
  qz: 'QZ Tray 2.2.6 runtime and existing QZ integration assets',
  certificate: 'E-Shop Certificate Manager 0.1.1 and formal public trust material',
  setupKit: 'LightOps-POS-Setup-Kit field checklist and troubleshooting references',
  runtimeHealth: 'Existing Desktop runtime health and structured logging conventions',
})

export const PHASE_1_INTERNAL_STATUS = 'NOT_IMPLEMENTED_FOR_PHASE_1'

const PLACEHOLDER_FAILURE: Record<Exclude<SetupStage, 'preflight'>, SetupFailureCode | null> = {
  desktop: null,
  qz: null,
  certificate: null,
  driver: null,
  'printer-discovery': null,
  queue: null,
  'runtime-health': null,
}

function pending(
  stage: SetupStage,
  evidence: StageResult['evidence'],
  implementationStatus = PHASE_1_INTERNAL_STATUS,
): StageResult {
  return {
    status: 'NEEDS_ACTION',
    failureCode: null,
    message: `${stage} requires its Phase 2 provisioning adapter`,
    retryable: false,
    evidence: { implementationStatus, ...evidence },
  }
}

function deferred(
  stage: Exclude<SetupStage, 'preflight'>,
  evidence: StageResult['evidence'],
  implementationStatus = PHASE_1_INTERNAL_STATUS,
): StageResult {
  return {
    status: 'BLOCKED',
    failureCode: PLACEHOLDER_FAILURE[stage],
    message: implementationStatus,
    retryable: false,
    evidence: { implementationStatus, ...evidence },
  }
}

export function createDeferredAdapter(
  stage: Exclude<SetupStage, 'preflight'>,
  evidence: StageResult['evidence'],
  implementationStatus = PHASE_1_INTERNAL_STATUS,
): SetupStageAdapter {
  return {
    stage,
    detect: async () => pending(stage, evidence, implementationStatus),
    execute: async () => deferred(stage, evidence, implementationStatus),
  }
}

const preflightAdapter: SetupStageAdapter = {
  stage: 'preflight',
  detect: async () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return {
        status: 'BLOCKED',
        failureCode: 'UNSUPPORTED_WINDOWS',
        message: 'E-Shop V1 Setup requires Windows x64',
        retryable: false,
        evidence: { platform: process.platform, architecture: process.arch },
      }
    }
    return pending('preflight', {
      requiredChecks: [
        'administrator',
        'network',
        'print-spooler',
        'disk-space',
        'existing-runtime-state',
      ],
    })
  },
  execute: async () => ({
    status: 'BLOCKED',
    failureCode: 'PREFLIGHT_FAILED',
    message: PHASE_1_INTERNAL_STATUS,
    retryable: false,
    evidence: { implementationStatus: PHASE_1_INTERNAL_STATUS },
  }),
}

export function createPhase1Adapters(): SetupStageAdapter[] {
  const adapters: SetupStageAdapter[] = [
    preflightAdapter,
    createDeferredAdapter('desktop', { existingAsset: REUSED_EXISTING_ASSETS.desktop }),
    createDeferredAdapter('qz', { version: '2.2.6', existingAsset: REUSED_EXISTING_ASSETS.qz }),
    createDeferredAdapter('certificate', { existingAsset: REUSED_EXISTING_ASSETS.certificate }),
    createDeferredAdapter('driver', {
      classification: 'EXTERNAL_INSTALLER',
      redistribution: 'UNKNOWN',
      expectedDriver: '80Normal',
      matchingInstaller: 'RongTaDriverInstall.exe',
    }),
    createDeferredAdapter('printer-discovery', {
      frontRole: '前台',
      kitchenRole: '厨房',
      networkScanImplemented: false,
    }),
    createDeferredAdapter('queue', { logicalQueues: ['前台', '厨房'], provisioningImplemented: false }),
    createDeferredAdapter('runtime-health', {
      existingAsset: REUSED_EXISTING_ASSETS.runtimeHealth,
      healthContractImplemented: false,
    }),
  ]
  if (!SETUP_STAGE_ORDER.every((stage, index) => adapters[index]?.stage === stage)) {
    throw new Error('Phase 1 adapters do not match the frozen setup stage order')
  }
  return adapters
}
