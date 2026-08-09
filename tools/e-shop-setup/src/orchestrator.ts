import { randomUUID } from 'node:crypto'

import {
  SETUP_STAGE_ORDER,
  type GlobalRuntimeState,
  type MerchantBindingStatus,
  type SetupCheckpoint,
  type SetupCheckpointStore,
  type SetupFailureCode,
  type SetupLogger,
  type SetupRunResult,
  type SetupStage,
  type SetupStageAdapter,
  type StageResult,
} from './contracts'

const UNEXPECTED_FAILURE_BY_STAGE: Record<SetupStage, SetupFailureCode> = {
  preflight: 'PREFLIGHT_FAILED',
  desktop: 'DESKTOP_INSTALL_FAILED',
  qz: 'QZ_INSTALL_FAILED',
  certificate: 'CERTIFICATE_CONFIG_FAILED',
  driver: 'DRIVER_INSTALL_FAILED',
  'printer-discovery': 'PRINTER_NOT_FOUND',
  queue: 'QUEUE_PROVISION_FAILED',
  'runtime-health': 'HEALTH_CHECK_FAILED',
}

function emptyCheckpoint(): SetupCheckpoint {
  return {
    schema: 'eshop.setup.checkpoint.v1',
    updatedAt: new Date(0).toISOString(),
    globalState: 'BLOCKED',
    stages: {},
  }
}

function unexpectedFailure(stage: SetupStage, error: unknown): StageResult {
  return {
    status: 'BLOCKED',
    failureCode: UNEXPECTED_FAILURE_BY_STAGE[stage],
    message: `Unexpected ${stage} adapter failure`,
    retryable: true,
    evidence: {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    },
  }
}

function calculateGlobalState(
  stageResults: Partial<Record<SetupStage, StageResult>>,
  bindingStatus: MerchantBindingStatus,
): GlobalRuntimeState {
  if (!SETUP_STAGE_ORDER.every((stage) => stageResults[stage]?.status === 'READY')) return 'BLOCKED'
  if (bindingStatus === 'VALID') return 'READY_FOR_BUSINESS'
  if (bindingStatus === 'NOT_BOUND' || bindingStatus === 'WAITING') return 'READY_FOR_BINDING'
  return 'BLOCKED'
}

function validateAdapters(adapters: readonly SetupStageAdapter[]): Map<SetupStage, SetupStageAdapter> {
  const byStage = new Map<SetupStage, SetupStageAdapter>()
  for (const adapter of adapters) {
    if (byStage.has(adapter.stage)) throw new Error(`duplicate setup adapter: ${adapter.stage}`)
    byStage.set(adapter.stage, adapter)
  }
  for (const stage of SETUP_STAGE_ORDER) {
    if (!byStage.has(stage)) throw new Error(`missing setup adapter: ${stage}`)
  }
  if (byStage.size !== SETUP_STAGE_ORDER.length) throw new Error('unexpected setup adapter registered')
  return byStage
}

export class EShopSetupOrchestrator {
  private readonly adapters: Map<SetupStage, SetupStageAdapter>

  constructor(
    adapters: readonly SetupStageAdapter[],
    private readonly checkpointStore: SetupCheckpointStore,
    private readonly logger: SetupLogger,
  ) {
    this.adapters = validateAdapters(adapters)
  }

  async run(bindingStatus: MerchantBindingStatus): Promise<SetupRunResult> {
    const runId = randomUUID()
    let checkpoint: SetupCheckpoint
    try {
      checkpoint = (await this.checkpointStore.load()) ?? emptyCheckpoint()
    } catch (error) {
      checkpoint = emptyCheckpoint()
      const failed = unexpectedFailure('preflight', error)
      checkpoint.stages.preflight = failed
      const startedAt = new Date().toISOString()
      await this.logger.write({
        runId,
        stage: 'preflight',
        event: 'START',
        startedAt,
        endedAt: null,
        result: null,
        failureCode: null,
        retryable: null,
        evidenceSummary: {},
      })
      await this.writeStageLog(runId, 'preflight', startedAt, failed)
      return { runId, state: 'BLOCKED', stoppedAt: 'preflight', stageResults: checkpoint.stages }
    }

    for (const stage of SETUP_STAGE_ORDER) {
      const adapter = this.adapters.get(stage)!
      const startedAt = new Date().toISOString()
      await this.logger.write({
        runId,
        stage,
        event: 'START',
        startedAt,
        endedAt: null,
        result: null,
        failureCode: null,
        retryable: null,
        evidenceSummary: {},
      })

      let result: StageResult
      try {
        const context = {
          runId,
          bindingStatus,
          previousResult: checkpoint.stages[stage] ?? null,
        }
        const detected = await adapter.detect(context)
        result = detected.status === 'NEEDS_ACTION'
          ? await adapter.execute(context)
          : detected
        if (result.status === 'NEEDS_ACTION') {
          result = unexpectedFailure(stage, new Error('adapter execute returned NEEDS_ACTION'))
        }
      } catch (error) {
        result = unexpectedFailure(stage, error)
      }

      checkpoint.stages[stage] = result
      // A prior checkpoint may contain READY results for downstream stages. Keep the
      // global state BLOCKED until this run has re-detected every stage, especially
      // runtime-health after Merchant Binding changes.
      checkpoint.globalState = stage === 'runtime-health' && result.status === 'READY'
        ? calculateGlobalState(checkpoint.stages, bindingStatus)
        : 'BLOCKED'
      checkpoint.updatedAt = new Date().toISOString()

      try {
        await this.checkpointStore.save(checkpoint)
      } catch (error) {
        result = unexpectedFailure(stage, error)
        checkpoint.stages[stage] = result
        checkpoint.globalState = 'BLOCKED'
      }

      await this.writeStageLog(runId, stage, startedAt, result)
      if (result.status !== 'READY') {
        return { runId, state: 'BLOCKED', stoppedAt: stage, stageResults: checkpoint.stages }
      }
    }

    const state = checkpoint.globalState
    return { runId, state, stoppedAt: state === 'BLOCKED' ? 'runtime-health' : null, stageResults: checkpoint.stages }
  }

  private async writeStageLog(
    runId: string,
    stage: SetupStage,
    startedAt: string,
    result: StageResult,
  ): Promise<void> {
    await this.logger.write({
      runId,
      stage,
      event: 'END',
      startedAt,
      endedAt: new Date().toISOString(),
      result: result.status,
      failureCode: result.failureCode,
      retryable: result.retryable,
      evidenceSummary: result.evidence,
    })
  }
}
