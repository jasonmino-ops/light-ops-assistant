import {
  SETUP_STAGE_ORDER,
  type SetupEvidence,
  type SetupFailureCode,
  type SetupStageAdapter,
  type StageResult,
} from './contracts'
import {
  createSoftwareProvisioningAdapters,
  type ProvisionAction,
  type SoftwareProvisioningSystem,
} from './softwareProvisioning'

export const ACTIVE_DRIVER_NAME = '80Normal' as const
export const DRIVER_CLASSIFICATION = 'EXTERNAL_INSTALLER' as const
export const DRIVER_REDISTRIBUTION = 'UNKNOWN' as const
export const MATCHING_DRIVER_INSTALLER = 'RongTaDriverInstall.exe' as const
export const KITCHEN_DISCOVERY_DEFERRED = 'DEFERRED_TO_KITCHEN_PRINTER_DISCOVERY_PHASE' as const

export type DriverDetectionSource =
  | 'WINDOWS_PRINT_MANAGEMENT'
  | 'WINDOWS_PRINT_DRIVER_REGISTRY'
  | 'NOT_FOUND'

export type DriverInspection = {
  ready: boolean
  expectedName: typeof ACTIVE_DRIVER_NAME
  detectedName: string | null
  version: string | null
  manufacturer: string | null
  detectionSource: DriverDetectionSource
  externalInstallerProvided: boolean
}

export type FrontUsbPrinterDetectionSource =
  | 'WINDOWS_PRINTER_PNP_METADATA'
  | 'WINDOWS_PRINTER_PORT_METADATA'

export type FrontUsbPrinterCandidate = {
  candidateId: string
  detectionSource: FrontUsbPrinterDetectionSource
}

export type FrontUsbPrinterInspection = {
  candidates: FrontUsbPrinterCandidate[]
  roleResolution: 'AUTO_RESOLVED' | 'USER_CONFIRM_REQUIRED' | 'NOT_FOUND'
  selectedCandidateId: string | null
  kitchenDiscovery: typeof KITCHEN_DISCOVERY_DEFERRED
}

export interface HardwareProvisioningSystem {
  inspectDriver(): Promise<DriverInspection>
  installExternalDriver(): Promise<ProvisionAction>
  inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection>
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

function errorType(error: unknown): SetupEvidence {
  return { errorType: error instanceof Error ? error.name : 'UnknownError' }
}

function driverEvidence(state: DriverInspection): SetupEvidence {
  return {
    expectedDriverName: state.expectedName,
    detectedDriverName: state.detectedName,
    version: state.version,
    manufacturer: state.manufacturer,
    detectionSource: state.detectionSource,
    driverState: state.ready ? 'READY' : 'EXTERNAL_DRIVER_REQUIRED',
    classification: DRIVER_CLASSIFICATION,
    redistribution: DRIVER_REDISTRIBUTION,
    matchingInstaller: MATCHING_DRIVER_INSTALLER,
    externalInstallerProvided: state.externalInstallerProvided,
  }
}

function printerEvidence(state: FrontUsbPrinterInspection): SetupEvidence {
  return {
    frontRole: '前台',
    candidateCount: state.candidates.length,
    candidateIdentifiers: state.candidates.map(({ candidateId }) => candidateId),
    detectionSources: [...new Set(state.candidates.map(({ detectionSource }) => detectionSource))],
    roleResolution: state.roleResolution,
    selectedCandidateId: state.selectedCandidateId,
    kitchenDiscovery: state.kitchenDiscovery,
    queueProvisioning: 'DEFERRED',
  }
}

export function createDriverProvisioningAdapter(system: HardwareProvisioningSystem): SetupStageAdapter {
  return {
    stage: 'driver',
    detect: async () => {
      try {
        const state = await system.inspectDriver()
        const evidence = driverEvidence(state)
        if (state.ready) return ready('Windows print driver 80Normal is ready', evidence)
        if (!state.externalInstallerProvided) {
          return blocked(
            'EXTERNAL_DRIVER_REQUIRED',
            'A legally supplied external RongTaDriverInstall.exe is required',
            true,
            evidence,
          )
        }
        return needsAction('External 80Normal driver installation is required', evidence)
      } catch (error) {
        return blocked('DRIVER_INSTALL_FAILED', 'Driver inspection failed', true, errorType(error))
      }
    },
    execute: async () => {
      try {
        const before = await system.inspectDriver()
        if (before.ready) {
          return ready('Windows print driver 80Normal was reused', {
            ...driverEvidence(before),
            installerInvoked: false,
          })
        }
        if (!before.externalInstallerProvided) {
          return blocked(
            'EXTERNAL_DRIVER_REQUIRED',
            'A legally supplied external RongTaDriverInstall.exe is required',
            true,
            driverEvidence(before),
          )
        }
        const action = await system.installExternalDriver()
        const after = await system.inspectDriver()
        if (action.verified && after.ready) {
          return ready('External 80Normal driver installation completed and verified', {
            ...driverEvidence(after),
            installerInvoked: action.changed,
          })
        }
        return blocked('DRIVER_INSTALL_FAILED', '80Normal was not available after external installation', true, {
          ...driverEvidence(after),
          installerInvoked: action.changed,
        })
      } catch (error) {
        return blocked('DRIVER_INSTALL_FAILED', 'External driver provisioning failed', true, errorType(error))
      }
    },
  }
}

async function resolveFrontUsbPrinter(system: HardwareProvisioningSystem): Promise<StageResult> {
  try {
    const state = await system.inspectFrontUsbPrinters()
    const evidence = printerEvidence(state)
    if (state.candidates.length === 1 && state.roleResolution === 'AUTO_RESOLVED') {
      return ready('One compatible USB thermal printer was resolved as the Front Printer candidate', evidence)
    }
    if (state.candidates.length > 1) {
      return blocked(
        'USER_CONFIRM_REQUIRED',
        'Multiple compatible USB printer candidates require physical Front Printer confirmation',
        true,
        evidence,
      )
    }
    return blocked('PRINTER_NOT_FOUND', 'No compatible USB Front Printer candidate was found', true, evidence)
  } catch (error) {
    return blocked('PRINTER_NOT_FOUND', 'Front USB Printer detection failed', true, errorType(error))
  }
}

export function createFrontUsbPrinterDetectionAdapter(system: HardwareProvisioningSystem): SetupStageAdapter {
  return {
    stage: 'printer-discovery',
    detect: async () => resolveFrontUsbPrinter(system),
    execute: async () => resolveFrontUsbPrinter(system),
  }
}

export function createHardwareProvisioningPhase1Adapters(
  softwareSystem: SoftwareProvisioningSystem,
  hardwareSystem: HardwareProvisioningSystem,
): SetupStageAdapter[] {
  const driver = createDriverProvisioningAdapter(hardwareSystem)
  const frontUsb = createFrontUsbPrinterDetectionAdapter(hardwareSystem)
  const adapters = createSoftwareProvisioningAdapters(softwareSystem).map((adapter) => {
    if (adapter.stage === 'driver') return driver
    if (adapter.stage === 'printer-discovery') return frontUsb
    return adapter
  })

  if (!SETUP_STAGE_ORDER.every((stage, index) => adapters[index]?.stage === stage)) {
    throw new Error('Hardware Phase 1 adapters do not match the frozen setup stage order')
  }
  return adapters
}
