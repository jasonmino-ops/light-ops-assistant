import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EShopSetupOrchestrator,
  FileSetupCheckpointStore,
  JsonLinesSetupLogger,
  SETUP_FAILURE_CODES,
  SETUP_STAGE_ORDER,
  createPhase1Adapters,
  type MerchantBindingStatus,
  type SetupCheckpoint,
  type SetupCheckpointStore,
  type SetupLogger,
  type SetupStage,
  type SetupStageAdapter,
  type SetupStageLogEntry,
  type StageResult,
} from '../tools/e-shop-setup/src'

const ready = (message = 'ready'): StageResult => ({
  status: 'READY',
  failureCode: null,
  message,
  retryable: false,
  evidence: { ready: true },
})

const needsAction = (): StageResult => ({
  status: 'NEEDS_ACTION',
  failureCode: null,
  message: 'action required',
  retryable: false,
  evidence: {},
})

class MemoryCheckpointStore implements SetupCheckpointStore {
  value: SetupCheckpoint | null = null

  async load(): Promise<SetupCheckpoint | null> {
    return this.value ? structuredClone(this.value) : null
  }

  async save(checkpoint: SetupCheckpoint): Promise<void> {
    this.value = structuredClone(checkpoint)
  }
}

class MemoryLogger implements SetupLogger {
  readonly entries: SetupStageLogEntry[] = []

  async write(entry: SetupStageLogEntry): Promise<void> {
    this.entries.push(structuredClone(entry))
  }
}

function adapters(options?: {
  execute?: (stage: SetupStage, attempt: number, bindingStatus: MerchantBindingStatus) => StageResult
  executionOrder?: SetupStage[]
  provisioned?: Set<SetupStage>
  executeCount?: Map<SetupStage, number>
}): SetupStageAdapter[] {
  const provisioned = options?.provisioned ?? new Set<SetupStage>()
  const counts = options?.executeCount ?? new Map<SetupStage, number>()
  return SETUP_STAGE_ORDER.map((stage) => ({
    stage,
    detect: async () => provisioned.has(stage) ? ready('detected ready') : needsAction(),
    execute: async ({ bindingStatus }) => {
      options?.executionOrder?.push(stage)
      const attempt = (counts.get(stage) ?? 0) + 1
      counts.set(stage, attempt)
      const result = options?.execute?.(stage, attempt, bindingStatus) ?? ready('provisioned')
      if (result.status === 'READY') provisioned.add(stage)
      return result
    },
  }))
}

async function testFixedStageOrder(): Promise<void> {
  const order: SetupStage[] = []
  const logger = new MemoryLogger()
  const result = await new EShopSetupOrchestrator(
    adapters({ executionOrder: order }),
    new MemoryCheckpointStore(),
    logger,
  ).run('NOT_BOUND')

  assert.deepEqual(order, [...SETUP_STAGE_ORDER])
  assert.deepEqual(createPhase1Adapters().map(({ stage }) => stage), [...SETUP_STAGE_ORDER])
  assert.equal(logger.entries.length, SETUP_STAGE_ORDER.length * 2)
  for (const [index, stage] of SETUP_STAGE_ORDER.entries()) {
    assert.equal(logger.entries[index * 2]?.stage, stage)
    assert.equal(logger.entries[index * 2]?.event, 'START')
    assert.equal(logger.entries[index * 2 + 1]?.stage, stage)
    assert.equal(logger.entries[index * 2 + 1]?.event, 'END')
  }
  assert.equal(result.state, 'READY_FOR_BINDING')
}

async function testFailureStopsLaterStages(): Promise<void> {
  const order: SetupStage[] = []
  const result = await new EShopSetupOrchestrator(
    adapters({
      executionOrder: order,
      execute: (stage) => stage === 'qz'
        ? {
            status: 'BLOCKED',
            failureCode: 'QZ_INSTALL_FAILED',
            message: 'qz failed',
            retryable: true,
            evidence: { service: 'qz' },
          }
        : ready(),
    }),
    new MemoryCheckpointStore(),
    new MemoryLogger(),
  ).run('NOT_BOUND')

  assert.deepEqual(order, ['preflight', 'desktop', 'qz'])
  assert.equal(result.state, 'BLOCKED')
  assert.equal(result.stoppedAt, 'qz')
}

async function testRetryAndIdempotentResume(): Promise<void> {
  const store = new MemoryCheckpointStore()
  const provisioned = new Set<SetupStage>()
  const counts = new Map<SetupStage, number>()
  const setupAdapters = adapters({
    provisioned,
    executeCount: counts,
    execute: (stage, attempt) => stage === 'qz' && attempt === 1
      ? {
          status: 'BLOCKED',
          failureCode: 'QZ_INSTALL_FAILED',
          message: 'temporary qz failure',
          retryable: true,
          evidence: { attempt },
        }
      : ready(),
  })
  const orchestrator = new EShopSetupOrchestrator(setupAdapters, store, new MemoryLogger())

  const first = await orchestrator.run('WAITING')
  assert.equal(first.state, 'BLOCKED')
  assert.equal(first.stageResults.qz?.retryable, true)
  const second = await orchestrator.run('WAITING')
  assert.equal(second.state, 'READY_FOR_BINDING')
  assert.equal(counts.get('preflight'), 1)
  assert.equal(counts.get('desktop'), 1)
  assert.equal(counts.get('qz'), 2)
  assert.equal(counts.get('runtime-health'), 1)
}

async function testCompletionStates(): Promise<void> {
  const waiting = await new EShopSetupOrchestrator(
    adapters(),
    new MemoryCheckpointStore(),
    new MemoryLogger(),
  ).run('NOT_BOUND')
  assert.equal(waiting.state, 'READY_FOR_BINDING')

  const business = await new EShopSetupOrchestrator(
    adapters({
      execute: (stage, _attempt, bindingStatus) => {
        if (stage === 'runtime-health') {
          assert.equal(bindingStatus, 'VALID')
          return ready('binding valid and health passed')
        }
        return ready()
      },
    }),
    new MemoryCheckpointStore(),
    new MemoryLogger(),
  ).run('VALID')
  assert.equal(business.state, 'READY_FOR_BUSINESS')

  const invalid = await new EShopSetupOrchestrator(
    adapters(),
    new MemoryCheckpointStore(),
    new MemoryLogger(),
  ).run('INVALID')
  assert.equal(invalid.state, 'BLOCKED')
}

async function testHealthMustPassForBusiness(): Promise<void> {
  const result = await new EShopSetupOrchestrator(
    adapters({
      execute: (stage) => stage === 'runtime-health'
        ? {
            status: 'BLOCKED',
            failureCode: 'HEALTH_CHECK_FAILED',
            message: 'health failed',
            retryable: true,
            evidence: { health: 'failed' },
          }
        : ready(),
    }),
    new MemoryCheckpointStore(),
    new MemoryLogger(),
  ).run('VALID')

  assert.equal(result.state, 'BLOCKED')
  assert.equal(result.stoppedAt, 'runtime-health')
}

async function testSensitiveDataExcludedFromLogs(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'eshop-setup-log-test-'))
  const logPath = join(directory, 'setup.log.jsonl')
  try {
    const logger = new JsonLinesSetupLogger(logPath)
    await logger.write({
      runId: 'safe-run-id',
      stage: 'preflight',
      event: 'END',
      startedAt: '2026-08-09T00:00:00.000Z',
      endedAt: '2026-08-09T00:00:01.000Z',
      result: 'BLOCKED',
      failureCode: 'PREFLIGHT_FAILED',
      retryable: true,
      evidenceSummary: {
        summary: 'authorization=do-not-log token=also-hidden safe-summary',
        privateKey: 'private-material',
        token: 'token-material',
        cookie: 'cookie-material',
        credential: 'credential-material',
        claimSecret: 'claim-material',
        deviceSecret: 'device-material',
        launchTicket: 'launch-material',
        safe: 'kept',
      },
    })
    const text = await readFile(logPath, 'utf8')
    for (const forbidden of [
      'do-not-log',
      'also-hidden',
      'private-material',
      'token-material',
      'cookie-material',
      'credential-material',
      'claim-material',
      'device-material',
      'launch-material',
    ]) {
      assert.doesNotMatch(text, new RegExp(forbidden))
    }
    assert.match(text, /safe-summary/)
    assert.match(text, /"safe":"kept"/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function testFileCheckpointResume(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'eshop-setup-checkpoint-test-'))
  const checkpointPath = join(directory, 'setup-checkpoint-v1.json')
  const counts = new Map<SetupStage, number>()
  const checkpointAwareAdapters: SetupStageAdapter[] = SETUP_STAGE_ORDER.map((stage) => ({
    stage,
    detect: async ({ previousResult }) => previousResult?.status === 'READY' ? ready('checkpoint verified') : needsAction(),
    execute: async () => {
      counts.set(stage, (counts.get(stage) ?? 0) + 1)
      return ready('first run provisioned')
    },
  }))

  try {
    const first = await new EShopSetupOrchestrator(
      checkpointAwareAdapters,
      new FileSetupCheckpointStore(checkpointPath),
      new MemoryLogger(),
    ).run('NOT_BOUND')
    assert.equal(first.state, 'READY_FOR_BINDING')

    const second = await new EShopSetupOrchestrator(
      checkpointAwareAdapters,
      new FileSetupCheckpointStore(checkpointPath),
      new MemoryLogger(),
    ).run('VALID')
    assert.equal(second.state, 'READY_FOR_BUSINESS')
    for (const stage of SETUP_STAGE_ORDER) assert.equal(counts.get(stage), 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function testFrozenFailureCodeSet(): Promise<void> {
  assert.deepEqual(SETUP_FAILURE_CODES, [
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
  ])
}

async function main(): Promise<void> {
  await testFixedStageOrder()
  await testFailureStopsLaterStages()
  await testRetryAndIdempotentResume()
  await testCompletionStates()
  await testHealthMustPassForBusiness()
  await testSensitiveDataExcludedFromLogs()
  await testFileCheckpointResume()
  await testFrozenFailureCodeSet()
  console.log('E-Shop V1 Setup execution skeleton tests passed (8/8)')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
