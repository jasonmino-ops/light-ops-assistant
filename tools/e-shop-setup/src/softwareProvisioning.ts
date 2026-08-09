import {
  SETUP_STAGE_ORDER,
  type SetupEvidence,
  type SetupFailureCode,
  type SetupStageAdapter,
  type StageResult,
} from './contracts'
import { createDeferredAdapter } from './phase1Adapters'

export const SOFTWARE_PROVISIONING_READY = 'SOFTWARE_PROVISIONING_READY'
export const HARDWARE_PROVISIONING_DEFERRED = 'DEFERRED_TO_HARDWARE_PROVISIONING_PHASE'

export type DesktopInspection = {
  installed: boolean
  version: string | null
  expectedVersion: string
  executablePresent: boolean
  runtimeRunning: boolean
}

export type QzInspection = {
  installed: boolean
  version: string | null
  expectedVersion: '2.2.6'
  running: boolean
  port8181Ready: boolean
  port8182Ready: boolean
}

export type CertificateInspection = {
  ready: boolean
  managerStatus: 'NOT_INSTALLED' | 'OK' | 'NEEDS_UPDATE' | 'MISCONFIGURED'
  packageValid: boolean
  fingerprintMatch: boolean
  overrideConfigured: boolean
  qzAccepted: boolean
  publicFingerprint: string | null
}

export type PreflightInspection = {
  platform: NodeJS.Platform
  architecture: string
  administrator: boolean | null
  cloudReachable: boolean | null
  printSpoolerRunning: boolean | null
  freeDiskBytes: number | null
  requiredDiskBytes: number
  desktop: DesktopInspection | null
  qz: QzInspection | null
  certificate: CertificateInspection | null
}

export type ProvisionAction = {
  changed: boolean
  verified: boolean
}

export interface SoftwareProvisioningSystem {
  inspectPreflight(): Promise<PreflightInspection>
  inspectDesktop(): Promise<DesktopInspection>
  installDesktop(): Promise<ProvisionAction>
  ensureDesktopRunning(): Promise<boolean>
  inspectQz(): Promise<QzInspection>
  installQz(): Promise<ProvisionAction>
  ensureQzRunning(): Promise<boolean>
  inspectCertificate(): Promise<CertificateInspection>
  provisionCertificate(): Promise<ProvisionAction>
}

function ready(message: string, evidence: SetupEvidence): StageResult {
  return { status: 'READY', failureCode: null, message, retryable: false, evidence }
}

function needsAction(message: string, evidence: SetupEvidence): StageResult {
  return { status: 'NEEDS_ACTION', failureCode: null, message, retryable: true, evidence }
}

function blocked(
  failureCode: SetupFailureCode,
  message: string,
  retryable: boolean,
  evidence: SetupEvidence,
): StageResult {
  return { status: 'BLOCKED', failureCode, message, retryable, evidence }
}

function desktopEvidence(state: DesktopInspection): SetupEvidence {
  return {
    installed: state.installed,
    version: state.version,
    expectedVersion: state.expectedVersion,
    executablePresent: state.executablePresent,
    runtimeRunning: state.runtimeRunning,
  }
}

function qzEvidence(state: QzInspection): SetupEvidence {
  return {
    installed: state.installed,
    version: state.version,
    expectedVersion: state.expectedVersion,
    running: state.running,
    port8181Ready: state.port8181Ready,
    port8182Ready: state.port8182Ready,
  }
}

function certificateEvidence(state: CertificateInspection): SetupEvidence {
  return {
    managerStatus: state.managerStatus,
    packageValid: state.packageValid,
    fingerprintMatch: state.fingerprintMatch,
    overrideConfigured: state.overrideConfigured,
    qzAccepted: state.qzAccepted,
    publicFingerprint: state.publicFingerprint,
  }
}

function errorType(error: unknown): SetupEvidence {
  return { errorType: error instanceof Error ? error.name : 'UnknownError' }
}

export function createSoftwareProvisioningAdapters(system: SoftwareProvisioningSystem): SetupStageAdapter[] {
  const preflight: SetupStageAdapter = {
    stage: 'preflight',
    detect: async () => {
      try {
        const state = await system.inspectPreflight()
        const evidence: SetupEvidence = {
          platform: state.platform,
          architecture: state.architecture,
          administrator: state.administrator,
          cloudReachable: state.cloudReachable,
          printSpoolerRunning: state.printSpoolerRunning,
          freeDiskBytes: state.freeDiskBytes,
          requiredDiskBytes: state.requiredDiskBytes,
          existingDesktopVersion: state.desktop?.version ?? null,
          existingQzVersion: state.qz?.version ?? null,
          existingCertificateStatus: state.certificate?.managerStatus ?? null,
        }
        if (state.platform !== 'win32' || state.architecture !== 'x64') {
          return blocked('UNSUPPORTED_WINDOWS', 'E-Shop V1 Setup requires Windows x64', false, evidence)
        }
        if (state.administrator !== true) {
          return blocked('ADMIN_REQUIRED', 'Administrator privileges are required', true, evidence)
        }
        if (state.cloudReachable !== true) {
          return blocked('CLOUD_OFFLINE', 'E-Shop Cloud is not reachable', true, evidence)
        }
        if (state.printSpoolerRunning !== true || state.freeDiskBytes === null || state.freeDiskBytes < state.requiredDiskBytes) {
          return blocked('PREFLIGHT_FAILED', 'Windows preflight requirements are not ready', true, evidence)
        }
        return ready('Windows software provisioning preflight passed', evidence)
      } catch (error) {
        return blocked('PREFLIGHT_FAILED', 'Preflight inspection failed', true, errorType(error))
      }
    },
    execute: async () => blocked('PREFLIGHT_FAILED', 'Preflight is detect-only', true, {}),
  }

  const desktop: SetupStageAdapter = {
    stage: 'desktop',
    detect: async () => {
      try {
        const state = await system.inspectDesktop()
        const evidence = desktopEvidence(state)
        return state.installed && state.version === state.expectedVersion && state.executablePresent && state.runtimeRunning
          ? ready('E-Shop Desktop is installed and running', evidence)
          : needsAction('E-Shop Desktop requires install, repair, or startup', evidence)
      } catch (error) {
        return blocked('DESKTOP_INSTALL_FAILED', 'Desktop inspection failed', true, errorType(error))
      }
    },
    execute: async () => {
      try {
        const before = await system.inspectDesktop()
        let changed = false
        if (!before.installed || before.version !== before.expectedVersion || !before.executablePresent) {
          changed = (await system.installDesktop()).changed
        }
        const started = await system.ensureDesktopRunning()
        const after = await system.inspectDesktop()
        const verified = started && after.installed && after.version === after.expectedVersion && after.executablePresent && after.runtimeRunning
        return verified
          ? ready(changed ? 'E-Shop Desktop installed and verified' : 'E-Shop Desktop reused and verified', {
              ...desktopEvidence(after),
              installInvoked: changed,
            })
          : blocked('DESKTOP_INSTALL_FAILED', 'Desktop runtime verification failed', true, {
              ...desktopEvidence(after),
              installInvoked: changed,
            })
      } catch (error) {
        return blocked('DESKTOP_INSTALL_FAILED', 'Desktop provisioning failed', true, errorType(error))
      }
    },
  }

  const qz: SetupStageAdapter = {
    stage: 'qz',
    detect: async () => {
      try {
        const state = await system.inspectQz()
        const evidence = qzEvidence(state)
        return state.installed && state.version === state.expectedVersion && state.running && state.port8181Ready && state.port8182Ready
          ? ready('QZ Tray 2.2.6 is installed and ready', evidence)
          : needsAction('QZ Tray requires install, repair, or startup', evidence)
      } catch (error) {
        return blocked('QZ_INSTALL_FAILED', 'QZ inspection failed', true, errorType(error))
      }
    },
    execute: async () => {
      try {
        const before = await system.inspectQz()
        let changed = false
        if (!before.installed || before.version !== before.expectedVersion) {
          changed = (await system.installQz()).changed
        }
        const started = await system.ensureQzRunning()
        const after = await system.inspectQz()
        const verified = started && after.installed && after.version === after.expectedVersion && after.running && after.port8181Ready && after.port8182Ready
        return verified
          ? ready(changed ? 'QZ Tray 2.2.6 installed and verified' : 'QZ Tray 2.2.6 reused and verified', {
              ...qzEvidence(after),
              installInvoked: changed,
            })
          : blocked('QZ_INSTALL_FAILED', 'QZ runtime verification failed', true, {
              ...qzEvidence(after),
              installInvoked: changed,
            })
      } catch (error) {
        return blocked('QZ_INSTALL_FAILED', 'QZ provisioning failed', true, errorType(error))
      }
    },
  }

  const certificate: SetupStageAdapter = {
    stage: 'certificate',
    detect: async () => {
      try {
        const state = await system.inspectCertificate()
        return state.ready
          ? ready('E-Shop public trust material is configured and accepted by QZ', {
              ...certificateEvidence(state),
              softwareState: SOFTWARE_PROVISIONING_READY,
            })
          : needsAction('E-Shop certificate trust requires install or repair', certificateEvidence(state))
      } catch (error) {
        return blocked('CERTIFICATE_CONFIG_FAILED', 'Certificate inspection failed', true, errorType(error))
      }
    },
    execute: async () => {
      try {
        const action = await system.provisionCertificate()
        const after = await system.inspectCertificate()
        return action.verified && after.ready
          ? ready(action.changed ? 'E-Shop public trust material provisioned' : 'E-Shop certificate trust reused', {
              ...certificateEvidence(after),
              provisionInvoked: action.changed,
              softwareState: SOFTWARE_PROVISIONING_READY,
            })
          : blocked('CERTIFICATE_CONFIG_FAILED', 'Certificate trust verification failed', true, {
              ...certificateEvidence(after),
              provisionInvoked: action.changed,
            })
      } catch (error) {
        return blocked('CERTIFICATE_CONFIG_FAILED', 'Certificate provisioning failed', true, errorType(error))
      }
    },
  }

  const adapters: SetupStageAdapter[] = [
    preflight,
    desktop,
    qz,
    certificate,
    createDeferredAdapter('driver', {
      classification: 'EXTERNAL_INSTALLER',
      redistribution: 'UNKNOWN',
    }, HARDWARE_PROVISIONING_DEFERRED),
    createDeferredAdapter('printer-discovery', {
      frontRole: '前台',
      kitchenRole: '厨房',
      networkScanImplemented: false,
    }, HARDWARE_PROVISIONING_DEFERRED),
    createDeferredAdapter('queue', {
      logicalQueues: ['前台', '厨房'],
      provisioningImplemented: false,
    }, HARDWARE_PROVISIONING_DEFERRED),
    createDeferredAdapter('runtime-health', {
      healthContractImplemented: false,
    }, HARDWARE_PROVISIONING_DEFERRED),
  ]

  if (!SETUP_STAGE_ORDER.every((stage, index) => adapters[index]?.stage === stage)) {
    throw new Error('Software provisioning adapters do not match the frozen setup stage order')
  }
  return adapters
}
