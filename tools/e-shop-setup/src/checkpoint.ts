import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { SetupCheckpoint, SetupCheckpointStore, SetupStage, StageResult } from './contracts'
import { SETUP_FAILURE_CODES, SETUP_STAGE_ORDER } from './contracts'
import { sanitizeSetupEvidence } from './setupLog'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFailureCode(value: string): boolean {
  return (SETUP_FAILURE_CODES as readonly string[]).includes(value)
}

function isStoredStageResult(value: unknown): value is StageResult {
  if (!isRecord(value)) return false
  return (
    (value.status === 'READY' || value.status === 'NEEDS_ACTION' || value.status === 'BLOCKED') &&
    (
      value.failureCode === null ||
      (typeof value.failureCode === 'string' && isFailureCode(value.failureCode))
    ) &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean' &&
    isRecord(value.evidence)
  )
}

function parseCheckpoint(text: string): SetupCheckpoint {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || value.schema !== 'eshop.setup.checkpoint.v1' || !isRecord(value.stages)) {
    throw new Error('invalid setup checkpoint schema')
  }
  if (
    value.globalState !== 'BLOCKED' &&
    value.globalState !== 'READY_FOR_BINDING' &&
    value.globalState !== 'READY_FOR_BUSINESS'
  ) {
    throw new Error('invalid setup checkpoint global state')
  }

  const stages: Partial<Record<SetupStage, StageResult>> = {}
  for (const stage of SETUP_STAGE_ORDER) {
    const result = value.stages[stage]
    if (result === undefined) continue
    if (!isStoredStageResult(result)) throw new Error(`invalid checkpoint result for ${stage}`)
    stages[stage] = {
      ...result,
      evidence: sanitizeSetupEvidence(result.evidence as StageResult['evidence']),
    }
  }

  return {
    schema: 'eshop.setup.checkpoint.v1',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    globalState: value.globalState,
    stages,
  }
}

function safeCheckpoint(checkpoint: SetupCheckpoint): SetupCheckpoint {
  const stages: Partial<Record<SetupStage, StageResult>> = {}
  for (const stage of SETUP_STAGE_ORDER) {
    const result = checkpoint.stages[stage]
    if (!result) continue
    stages[stage] = { ...result, evidence: sanitizeSetupEvidence(result.evidence) }
  }
  return { ...checkpoint, stages }
}

export class FileSetupCheckpointStore implements SetupCheckpointStore {
  constructor(private readonly checkpointPath: string) {}

  async load(): Promise<SetupCheckpoint | null> {
    try {
      return parseCheckpoint(await readFile(this.checkpointPath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async save(checkpoint: SetupCheckpoint): Promise<void> {
    await mkdir(dirname(this.checkpointPath), { recursive: true })
    const tempPath = `${this.checkpointPath}.${process.pid}.tmp`
    await writeFile(tempPath, `${JSON.stringify(safeCheckpoint(checkpoint), null, 2)}\n`, 'utf8')
    await rename(tempPath, this.checkpointPath)
  }
}
