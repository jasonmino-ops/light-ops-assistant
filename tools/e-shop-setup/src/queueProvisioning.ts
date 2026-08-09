import {
  SETUP_STAGE_ORDER,
  type SetupEvidence,
  type SetupStageAdapter,
  type StageResult,
} from './contracts'
import {
  VERIFIED_DRIVER_CATALOG,
  createHardwareProvisioningPhase2Adapters,
  type FrontUsbQueueTargetProvider,
  type HardwareProvisioningPhase2System,
  type ResolvedFrontUsbQueueTarget,
  type VerifiedDriverFamilyId,
} from './hardwareProvisioning'
import type { ProvisionAction, SoftwareProvisioningSystem } from './softwareProvisioning'

export const LOGICAL_QUEUE_NAMES = Object.freeze({
  front: '前台',
  kitchen: '厨房',
})

export type QueueProvisioningInput = {
  frontCandidateId: string
  frontDriverFamily: VerifiedDriverFamilyId
  frontDriverName: string
  frontPortName: string
  kitchenEndpoint: string
}

export type HardwareProvisioningPhase3System = HardwareProvisioningPhase2System & FrontUsbQueueTargetProvider

export type QueueMappingInspection = {
  exists: boolean
  mappingCorrect: boolean
}

export type QueueProvisioningInspection = {
  ready: boolean
  inputResolved: boolean
  driverReady: boolean
  driverFamily: VerifiedDriverFamilyId | null
  portProvisionable: boolean
  front: QueueMappingInspection
  kitchen: QueueMappingInspection & {
    portReady: boolean
  }
}

export interface QueueProvisioningSystem {
  inspectQueues(input: QueueProvisioningInput): Promise<QueueProvisioningInspection>
  provisionQueues(input: QueueProvisioningInput): Promise<ProvisionAction>
}

type QueueInputProvider = () => QueueProvisioningInput | null

function ready(message: string, evidence: SetupEvidence): StageResult {
  return { status: 'READY', failureCode: null, message, retryable: false, evidence }
}

function needsAction(message: string, evidence: SetupEvidence): StageResult {
  return { status: 'NEEDS_ACTION', failureCode: null, message, retryable: true, evidence }
}

function blocked(message: string, evidence: SetupEvidence): StageResult {
  return {
    status: 'BLOCKED',
    failureCode: 'QUEUE_PROVISION_FAILED',
    message,
    retryable: true,
    evidence,
  }
}

function errorEvidence(error: unknown): SetupEvidence {
  return { errorType: error instanceof Error ? error.name : 'UnknownError' }
}

function queueEvidence(
  input: QueueProvisioningInput,
  state: QueueProvisioningInspection,
): SetupEvidence {
  return {
    logicalQueues: [LOGICAL_QUEUE_NAMES.front, LOGICAL_QUEUE_NAMES.kitchen],
    discoveryInput: {
      frontCandidateId: input.frontCandidateId,
      frontDriverFamily: input.frontDriverFamily,
      kitchenEndpoint: input.kitchenEndpoint,
    },
    inputResolved: state.inputResolved,
    driverReady: state.driverReady,
    driverFamily: state.driverFamily,
    frontQueue: {
      name: LOGICAL_QUEUE_NAMES.front,
      exists: state.front.exists,
      mappingCorrect: state.front.mappingCorrect,
    },
    kitchenQueue: {
      name: LOGICAL_QUEUE_NAMES.kitchen,
      exists: state.kitchen.exists,
      mappingCorrect: state.kitchen.mappingCorrect,
      raw9100PortReady: state.kitchen.portReady,
    },
    portProvisionable: state.portProvisionable,
    unrelatedPrintersModified: false,
  }
}

export function queueInputFromDiscoveryResult(
  result: StageResult | null,
  frontTarget: ResolvedFrontUsbQueueTarget | null,
): QueueProvisioningInput | null {
  if (result?.status !== 'READY') return null
  const frontCandidateId = result.evidence.selectedCandidateId
  const driverFamilies = result.evidence.driverFamilies
  const kitchenEndpoint = result.evidence.selectedKitchenEndpoint
  if (
    typeof frontCandidateId !== 'string' ||
    !/^front-usb-[a-f0-9]{16}$/.test(frontCandidateId) ||
    !Array.isArray(driverFamilies) ||
    driverFamilies.length !== 1 ||
    typeof driverFamilies[0] !== 'string' ||
    typeof kitchenEndpoint !== 'string' ||
    !frontTarget ||
    frontTarget.candidateId !== frontCandidateId
  ) {
    return null
  }
  const frontDriverFamily = VERIFIED_DRIVER_CATALOG.find(({ id }) => id === driverFamilies[0])?.id
  if (
    !frontDriverFamily ||
    frontTarget.driverFamily !== frontDriverFamily ||
    frontTarget.driverName.length === 0 ||
    frontTarget.portName.length === 0
  ) return null
  return {
    frontCandidateId,
    frontDriverFamily,
    frontDriverName: frontTarget.driverName,
    frontPortName: frontTarget.portName,
    kitchenEndpoint,
  }
}

export function createQueueProvisioningAdapter(
  system: QueueProvisioningSystem,
  inputProvider: QueueInputProvider,
): SetupStageAdapter {
  return {
    stage: 'queue',
    detect: async () => {
      const input = inputProvider()
      if (!input) return blocked('READY printer-discovery evidence is required', { discoveryInputReady: false })
      try {
        const state = await system.inspectQueues(input)
        const evidence = queueEvidence(input, state)
        if (!state.inputResolved) return blocked('Resolved discovery targets could not be mapped to Windows', evidence)
        if (!state.driverReady) return blocked('The Verified Driver Catalog family is not ready', evidence)
        if (state.ready) return ready('Logical Front and Kitchen queues are correctly mapped and reused', evidence)
        if (!state.portProvisionable) return blocked('A safe RAW 9100 port mapping could not be selected', evidence)
        return needsAction('Logical Front and Kitchen queues require provisioning or repair', evidence)
      } catch (error) {
        return blocked('Queue inspection failed', errorEvidence(error))
      }
    },
    execute: async () => {
      const input = inputProvider()
      if (!input) return blocked('READY printer-discovery evidence is required', { discoveryInputReady: false })
      try {
        const before = await system.inspectQueues(input)
        if (!before.inputResolved || !before.driverReady || !before.portProvisionable) {
          return blocked('Queue prerequisites are not ready', queueEvidence(input, before))
        }
        if (before.ready) {
          return ready('Logical Front and Kitchen queues were reused', {
            ...queueEvidence(input, before),
            provisioningInvoked: false,
          })
        }
        const action = await system.provisionQueues(input)
        const after = await system.inspectQueues(input)
        if (action.verified && after.ready) {
          return ready('Logical Front and Kitchen queues were provisioned and verified', {
            ...queueEvidence(input, after),
            provisioningInvoked: action.changed,
          })
        }
        return blocked('Queue verification failed after provisioning', {
          ...queueEvidence(input, after),
          provisioningInvoked: action.changed,
        })
      } catch (error) {
        return blocked('Queue provisioning failed', errorEvidence(error))
      }
    },
  }
}

export function createHardwareProvisioningPhase3Adapters(
  softwareSystem: SoftwareProvisioningSystem,
  hardwareSystem: HardwareProvisioningPhase3System,
  queueSystem: QueueProvisioningSystem,
): SetupStageAdapter[] {
  let currentDiscoveryResult: StageResult | null = null
  const phase2 = createHardwareProvisioningPhase2Adapters(softwareSystem, hardwareSystem)
  const discovery = phase2.find(({ stage }) => stage === 'printer-discovery')!
  const capture = (result: StageResult): StageResult => {
    currentDiscoveryResult = result.status === 'READY' ? result : null
    return result
  }
  const discoveryWithHandoff: SetupStageAdapter = {
    stage: 'printer-discovery',
    detect: async (context) => capture(await discovery.detect(context)),
    execute: async (context) => capture(await discovery.execute(context)),
  }
  const queue = createQueueProvisioningAdapter(
    queueSystem,
    () => {
      const candidateId = currentDiscoveryResult?.evidence.selectedCandidateId
      const target = typeof candidateId === 'string'
        ? hardwareSystem.getResolvedFrontQueueTarget(candidateId)
        : null
      return queueInputFromDiscoveryResult(currentDiscoveryResult, target)
    },
  )
  const adapters = phase2.map((adapter) => {
    if (adapter.stage === 'printer-discovery') return discoveryWithHandoff
    if (adapter.stage === 'queue') return queue
    return adapter
  })

  if (!SETUP_STAGE_ORDER.every((stage, index) => adapters[index]?.stage === stage)) {
    throw new Error('Hardware Phase 3 adapters do not match the frozen setup stage order')
  }
  return adapters
}
