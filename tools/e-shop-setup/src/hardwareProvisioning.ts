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

export const DRIVER_CLASSIFICATION = 'EXTERNAL_INSTALLER' as const
export const DRIVER_REDISTRIBUTION = 'UNKNOWN' as const
export const KITCHEN_DISCOVERY_DEFERRED = 'DEFERRED_TO_KITCHEN_PRINTER_DISCOVERY_PHASE' as const

export const VERIFIED_DRIVER_CATALOG = [
  {
    id: 'RONGTA_80MM',
    vendor: 'Rongta',
    family: '80Normal',
    installedDriverNames: ['80Normal'],
    externalInstallerFilenames: ['RongTaDriverInstall.exe'],
    redistribution: DRIVER_REDISTRIBUTION,
  },
  {
    id: 'XPRINTER_80MM',
    vendor: 'Xprinter / 芯烨',
    family: '80mm series',
    installedDriverNames: ['Xprinter XP-N160II'],
    externalInstallerFilenames: [
      '芯烨80系列驱动精简版V2.1R.exe',
      '芯烨80系列产品驱动 V8.0.exe',
    ],
    redistribution: DRIVER_REDISTRIBUTION,
  },
] as const

export type VerifiedDriverFamilyId = (typeof VERIFIED_DRIVER_CATALOG)[number]['id']

export type DriverDetectionSource =
  | 'WINDOWS_PRINT_MANAGEMENT'
  | 'WINDOWS_PRINT_DRIVER_REGISTRY'
  | 'NOT_FOUND'

export type DriverInspection = {
  ready: boolean
  resolvedFamily: VerifiedDriverFamilyId | null
  resolutionSource: 'INSTALLED_DRIVER' | 'USB_DEVICE_METADATA' | 'UNRESOLVED'
  detectedName: string | null
  version: string | null
  manufacturer: string | null
  detectionSource: DriverDetectionSource
  payloadAvailable: boolean
}

export type FrontUsbPrinterDetectionSource =
  | 'WINDOWS_PRINTER_PNP_METADATA'
  | 'WINDOWS_PRINTER_PORT_METADATA'

export type FrontUsbPrinterCandidate = {
  candidateId: string
  detectionSource: FrontUsbPrinterDetectionSource
  driverFamily: VerifiedDriverFamilyId
}

export type FrontUsbPrinterInspection = {
  candidates: FrontUsbPrinterCandidate[]
  roleResolution: 'AUTO_RESOLVED' | 'USER_CONFIRM_REQUIRED' | 'NOT_FOUND'
  selectedCandidateId: string | null
  kitchenDiscovery: typeof KITCHEN_DISCOVERY_DEFERRED
}

export type KitchenNetworkDetectionSource =
  | 'WINDOWS_STANDARD_TCPIP_PORT'
  | 'WINDOWS_NETWORK_NEIGHBOR'
  | 'LOCAL_IPV4_SUBNET_PROBE'

export type KitchenNetworkPrinterCandidate = {
  endpoint: string
  port: 9100
  detectionSources: KitchenNetworkDetectionSource[]
  raw9100Reachable: true
  windowsPrinterPortAssociated: boolean
}

export type KitchenNetworkPrinterInspection = {
  candidates: KitchenNetworkPrinterCandidate[]
  roleResolution: 'AUTO_RESOLVED' | 'USER_CONFIRM_REQUIRED' | 'NOT_FOUND'
  selectedEndpoint: string | null
}

export interface HardwareProvisioningSystem {
  inspectDriver(): Promise<DriverInspection>
  installExternalDriver(family: VerifiedDriverFamilyId): Promise<ProvisionAction>
  inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection>
}

export interface KitchenNetworkDiscoverySystem {
  inspectKitchenNetworkPrinters(): Promise<KitchenNetworkPrinterInspection>
}

export type HardwareProvisioningPhase2System = HardwareProvisioningSystem & KitchenNetworkDiscoverySystem

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
    catalogFamilies: VERIFIED_DRIVER_CATALOG.map(({ id }) => id),
    resolvedFamily: state.resolvedFamily,
    resolutionSource: state.resolutionSource,
    detectedDriverName: state.detectedName,
    version: state.version,
    manufacturer: state.manufacturer,
    detectionSource: state.detectionSource,
    driverState: state.ready ? 'READY' : 'EXTERNAL_DRIVER_REQUIRED',
    classification: DRIVER_CLASSIFICATION,
    redistribution: DRIVER_REDISTRIBUTION,
    payloadAvailable: state.payloadAvailable,
  }
}

function printerEvidence(state: FrontUsbPrinterInspection): SetupEvidence {
  return {
    frontRole: '前台',
    candidateCount: state.candidates.length,
    candidateIdentifiers: state.candidates.map(({ candidateId }) => candidateId),
    driverFamilies: [...new Set(state.candidates.map(({ driverFamily }) => driverFamily))],
    detectionSources: [...new Set(state.candidates.map(({ detectionSource }) => detectionSource))],
    roleResolution: state.roleResolution,
    selectedCandidateId: state.selectedCandidateId,
    kitchenDiscovery: state.kitchenDiscovery,
    queueProvisioning: 'DEFERRED',
  }
}

function kitchenPrinterEvidence(state: KitchenNetworkPrinterInspection): SetupEvidence {
  return {
    kitchenRole: '厨房',
    kitchenCandidateCount: state.candidates.length,
    kitchenCandidates: state.candidates.map((candidate) => ({
      endpoint: candidate.endpoint,
      detectionSources: candidate.detectionSources,
      raw9100Reachable: candidate.raw9100Reachable,
      windowsPrinterPortAssociated: candidate.windowsPrinterPortAssociated,
    })),
    kitchenRoleResolution: state.roleResolution,
    selectedKitchenEndpoint: state.selectedEndpoint,
    userManualIpInputRequired: false,
    printerPortCreation: 'DEFERRED',
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
        if (state.ready) return ready('A Verified Driver Catalog family is installed and ready', evidence)
        if (!state.resolvedFamily) {
          return blocked(
            'EXTERNAL_DRIVER_REQUIRED',
            'The detected printer does not match a Verified Driver Catalog family; install its official driver and retry',
            true,
            evidence,
          )
        }
        if (!state.payloadAvailable) {
          return blocked(
            'EXTERNAL_DRIVER_REQUIRED',
            'A legally supplied external driver payload is required for the resolved Verified Driver family',
            true,
            evidence,
          )
        }
        return needsAction('Verified external driver installation is required', evidence)
      } catch (error) {
        return blocked('DRIVER_INSTALL_FAILED', 'Driver inspection failed', true, errorType(error))
      }
    },
    execute: async () => {
      try {
        const before = await system.inspectDriver()
        if (before.ready) {
          return ready('The existing Verified Driver Catalog family was reused', {
            ...driverEvidence(before),
            installerInvoked: false,
          })
        }
        if (!before.resolvedFamily || !before.payloadAvailable) {
          return blocked(
            'EXTERNAL_DRIVER_REQUIRED',
            'A verified family and legally supplied external driver payload are required',
            true,
            driverEvidence(before),
          )
        }
        const selectedFamily = before.resolvedFamily
        const action = await system.installExternalDriver(selectedFamily)
        const after = await system.inspectDriver()
        if (action.verified && after.ready && after.resolvedFamily === selectedFamily) {
          return ready('Verified external driver installation completed and verified', {
            ...driverEvidence(after),
            selectedInstallerFamily: selectedFamily,
            installerInvoked: action.changed,
          })
        }
        return blocked('DRIVER_INSTALL_FAILED', 'The resolved Verified Driver family was not ready after installation', true, {
          ...driverEvidence(after),
          selectedInstallerFamily: selectedFamily,
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

async function resolveKitchenNetworkPrinter(system: KitchenNetworkDiscoverySystem): Promise<StageResult> {
  try {
    const state = await system.inspectKitchenNetworkPrinters()
    const evidence = kitchenPrinterEvidence(state)
    if (state.candidates.length === 1 && state.roleResolution === 'AUTO_RESOLVED') {
      return ready('One reachable Network RAW 9100 printer was resolved as the Kitchen Printer candidate', evidence)
    }
    if (state.candidates.length > 1) {
      return blocked(
        'USER_CONFIRM_REQUIRED',
        'Multiple reachable Network RAW 9100 candidates require physical Kitchen Printer confirmation',
        true,
        evidence,
      )
    }
    return blocked('PRINTER_NOT_FOUND', 'No reachable Network RAW 9100 Kitchen Printer candidate was found', true, evidence)
  } catch (error) {
    return blocked('PRINTER_NOT_FOUND', 'Kitchen Network Printer detection failed', true, errorType(error))
  }
}

export function createKitchenNetworkPrinterDetectionAdapter(system: KitchenNetworkDiscoverySystem): SetupStageAdapter {
  return {
    stage: 'printer-discovery',
    detect: async () => resolveKitchenNetworkPrinter(system),
    execute: async () => resolveKitchenNetworkPrinter(system),
  }
}

async function resolveFrontAndKitchenPrinters(system: HardwareProvisioningPhase2System): Promise<StageResult> {
  try {
    const [front, kitchen] = await Promise.all([
      system.inspectFrontUsbPrinters(),
      system.inspectKitchenNetworkPrinters(),
    ])
    const evidence: SetupEvidence = {
      ...printerEvidence(front),
      ...kitchenPrinterEvidence(kitchen),
      kitchenDiscovery: 'IMPLEMENTED',
    }
    if (front.candidates.length === 0 || kitchen.candidates.length === 0) {
      return blocked('PRINTER_NOT_FOUND', 'A required Front or Kitchen Printer candidate was not found', true, evidence)
    }
    if (front.candidates.length > 1 || kitchen.candidates.length > 1) {
      return blocked(
        'USER_CONFIRM_REQUIRED',
        'Multiple printer candidates require physical role confirmation',
        true,
        evidence,
      )
    }
    if (front.roleResolution === 'AUTO_RESOLVED' && kitchen.roleResolution === 'AUTO_RESOLVED') {
      return ready('Front USB and Kitchen Network printer candidates were resolved', evidence)
    }
    return blocked('PRINTER_NOT_FOUND', 'Printer role resolution was incomplete', true, evidence)
  } catch (error) {
    return blocked('PRINTER_NOT_FOUND', 'Printer discovery failed', true, errorType(error))
  }
}

export function createHardwarePrinterDiscoveryAdapter(system: HardwareProvisioningPhase2System): SetupStageAdapter {
  return {
    stage: 'printer-discovery',
    detect: async () => resolveFrontAndKitchenPrinters(system),
    execute: async () => resolveFrontAndKitchenPrinters(system),
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

export function createHardwareProvisioningPhase2Adapters(
  softwareSystem: SoftwareProvisioningSystem,
  hardwareSystem: HardwareProvisioningPhase2System,
): SetupStageAdapter[] {
  const driver = createDriverProvisioningAdapter(hardwareSystem)
  const printerDiscovery = createHardwarePrinterDiscoveryAdapter(hardwareSystem)
  const adapters = createSoftwareProvisioningAdapters(softwareSystem).map((adapter) => {
    if (adapter.stage === 'driver') return driver
    if (adapter.stage === 'printer-discovery') return printerDiscovery
    return adapter
  })

  if (!SETUP_STAGE_ORDER.every((stage, index) => adapters[index]?.stage === stage)) {
    throw new Error('Hardware Phase 2 adapters do not match the frozen setup stage order')
  }
  return adapters
}
