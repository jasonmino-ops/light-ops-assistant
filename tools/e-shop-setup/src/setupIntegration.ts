import {
  SETUP_STAGE_ORDER,
  type MerchantBindingStatus,
  type SetupEvidence,
  type SetupStage,
  type SetupStageAdapter,
  type SetupStageContext,
  type StageResult,
} from './contracts'
import type { SoftwareProvisioningSystem } from './softwareProvisioning'
import {
  createHardwareProvisioningPhase3Adapters,
  type HardwareProvisioningPhase3System,
  type QueueProvisioningSystem,
} from './queueProvisioning'

const HEALTH_PREREQUISITE_STAGES = SETUP_STAGE_ORDER.filter(
  (stage): stage is Exclude<SetupStage, 'runtime-health'> => stage !== 'runtime-health',
)

type CurrentRunResults = Partial<Record<SetupStage, StageResult>>

function evidenceRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function healthEvidence(
  results: CurrentRunResults,
  bindingStatus: MerchantBindingStatus,
): SetupEvidence {
  const preflight = results.preflight
  const discovery = results['printer-discovery']
  const queue = results.queue
  const frontQueue = evidenceRecord(queue?.evidence.frontQueue)
  const kitchenQueue = evidenceRecord(queue?.evidence.kitchenQueue)

  return {
    desktop: results.desktop?.status === 'READY' ? 'READY' : 'BLOCKED',
    qz: results.qz?.status === 'READY' ? 'READY' : 'BLOCKED',
    certificate: results.certificate?.status === 'READY' ? 'READY' : 'BLOCKED',
    driver: results.driver?.status === 'READY' ? 'READY' : 'BLOCKED',
    frontPrinter: discovery?.status === 'READY' && typeof discovery.evidence.selectedCandidateId === 'string'
      ? 'READY'
      : 'BLOCKED',
    kitchenPrinter: discovery?.status === 'READY' && typeof discovery.evidence.selectedKitchenEndpoint === 'string'
      ? 'READY'
      : 'BLOCKED',
    frontQueue: queue?.status === 'READY' && frontQueue?.mappingCorrect === true ? 'READY' : 'BLOCKED',
    kitchenQueue: queue?.status === 'READY' &&
      kitchenQueue?.mappingCorrect === true &&
      kitchenQueue.raw9100PortReady === true
      ? 'READY'
      : 'BLOCKED',
    cloud: preflight?.status === 'READY' && preflight.evidence.cloudReachable === true ? 'ONLINE' : 'OFFLINE',
    merchantBinding: bindingStatus,
  }
}

function runtimeReady(evidence: SetupEvidence): boolean {
  return (
    evidence.desktop === 'READY' &&
    evidence.qz === 'READY' &&
    evidence.certificate === 'READY' &&
    evidence.driver === 'READY' &&
    evidence.frontPrinter === 'READY' &&
    evidence.kitchenPrinter === 'READY' &&
    evidence.frontQueue === 'READY' &&
    evidence.kitchenQueue === 'READY' &&
    evidence.cloud === 'ONLINE'
  )
}

export function createRuntimeHealthAdapter(
  currentResults: () => CurrentRunResults,
): SetupStageAdapter {
  const inspect = async ({ bindingStatus }: SetupStageContext): Promise<StageResult> => {
    const results = currentResults()
    const evidence = healthEvidence(results, bindingStatus)
    const allPrerequisitesReady = HEALTH_PREREQUISITE_STAGES.every(
      (stage) => results[stage]?.status === 'READY',
    )

    if (!allPrerequisitesReady || !runtimeReady(evidence)) {
      return {
        status: 'BLOCKED',
        failureCode: 'HEALTH_CHECK_FAILED',
        message: 'One or more required E-Shop V1 Runtime health conditions are not ready',
        retryable: true,
        evidence,
      }
    }
    if (bindingStatus === 'INVALID') {
      return {
        status: 'BLOCKED',
        failureCode: 'HEALTH_CHECK_FAILED',
        message: 'Merchant Binding is invalid',
        retryable: true,
        evidence,
      }
    }

    return {
      status: 'READY',
      failureCode: null,
      message: bindingStatus === 'VALID'
        ? 'Runtime Health recheck passed with a valid Merchant Binding'
        : 'Runtime Health passed; Merchant Binding may now be completed',
      retryable: false,
      evidence,
    }
  }

  return {
    stage: 'runtime-health',
    detect: inspect,
    execute: inspect,
  }
}

export function createIntegratedSetupAdapters(
  softwareSystem: SoftwareProvisioningSystem,
  hardwareSystem: HardwareProvisioningPhase3System,
  queueSystem: QueueProvisioningSystem,
): SetupStageAdapter[] {
  const phase3 = createHardwareProvisioningPhase3Adapters(softwareSystem, hardwareSystem, queueSystem)
  const currentResults: CurrentRunResults = {}
  let currentRunId: string | null = null

  const capture = (stage: SetupStage, context: SetupStageContext, result: StageResult): StageResult => {
    if (currentRunId !== context.runId) {
      for (const key of SETUP_STAGE_ORDER) delete currentResults[key]
      currentRunId = context.runId
    }
    currentResults[stage] = result
    return result
  }

  const adapters = phase3.map((adapter): SetupStageAdapter => {
    if (adapter.stage === 'runtime-health') {
      return createRuntimeHealthAdapter(() => currentResults)
    }
    return {
      stage: adapter.stage,
      detect: async (context) => capture(adapter.stage, context, await adapter.detect(context)),
      execute: async (context) => capture(adapter.stage, context, await adapter.execute(context)),
    }
  })

  if (!SETUP_STAGE_ORDER.every((stage, index) => adapters[index]?.stage === stage)) {
    throw new Error('Integrated adapters do not match the frozen setup stage order')
  }
  return adapters
}
