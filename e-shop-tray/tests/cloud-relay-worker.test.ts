import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudRelayStateStore } from '../src/cloud/stateStore'
import { CloudRelayWorker } from '../src/cloud/worker'
import type { CloudTask, TaskResult } from '../src/cloud/types'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

async function stateStore() {
  const dir = await mkdtemp(join(tmpdir(), 'eshop-tray-cloud-worker-'))
  dirs.push(dir)
  return new CloudRelayStateStore(dir)
}

function task(overrides: Partial<CloudTask> = {}): CloudTask {
  const bytes = Buffer.from([0x1b, 0x40, 0x1d, 0x56, 0x00])
  return {
    id: 'task-cloud-0001', taskId: 'task-cloud-0001', storeId: 'store-field-001', storeCode: 'ST169E7000',
    taskType: 'PRINT_ESC_POS', schemaVersion: 1, idempotencyKey: 'eshop-tray:ORDER-1:request-0001',
    payload: {
      storeCode: 'ST169E7000', documentName: 'E-Shop ORDER-1', target: { type: 'WINDOWS_QUEUE', name: '前台' },
      commandStream: { encoding: 'base64', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') },
    },
    target: { type: 'WINDOWS_QUEUE', name: '前台' }, status: 'CLAIMED', claimedByDeviceId: 'device-field-001',
    leaseExpiresAt: '2026-08-11T18:00:00.000Z', attemptCount: 1, ...overrides,
  }
}

function cloud(claimed: CloudTask | null) {
  return {
    bootstrap: vi.fn(async () => ({ deviceId: 'device-field-001' } as never)),
    claim: vi.fn(async () => claimed),
    markExecuting: vi.fn(async () => undefined),
    report: vi.fn(async (_token: string, _taskId: string, _result: TaskResult) => undefined),
  }
}

async function worker(input: { claimed: CloudTask | null; store: CloudRelayStateStore; deliver?: ReturnType<typeof vi.fn> }) {
  const port = cloud(input.claimed)
  const deliver = input.deliver ?? vi.fn(async (bytes: Uint8Array) => ({ bytesWritten: bytes.length, durationMs: 3, transport: 'windows-queue' as const }))
  const runtime = new CloudRelayWorker({ token: 'test-device-token', client: port, stateStore: input.store, transport: { deliver }, pollIntervalMs: 60_000 })
  await runtime.start()
  runtime.stop()
  return { runtime, port, deliver }
}

describe('FIELD Cloud Relay worker', () => {
  it('claims, validates, executes through the existing WindowsQueueTransport port, then reports result', async () => {
    const store = await stateStore()
    const { runtime, port, deliver } = await worker({ claimed: task(), store })
    await runtime.runOnceForTest()
    expect(port.markExecuting).toHaveBeenCalledWith('test-device-token', 'task-cloud-0001')
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(port.report).toHaveBeenCalledWith('test-device-token', 'task-cloud-0001', expect.objectContaining({
      state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER', effectBoundary: 'CROSSED', physicalCompletionKnown: false,
    }))
    expect(store.records()).toEqual([expect.objectContaining({ state: 'TERMINAL', reported: true })])
  })

  it('rejects wrong-store work before printing', async () => {
    const store = await stateStore()
    const wrong = task({ storeCode: 'OTHER' as never })
    const { runtime, port, deliver } = await worker({ claimed: wrong, store })
    await runtime.runOnceForTest()
    expect(deliver).not.toHaveBeenCalled()
    expect(port.report).toHaveBeenCalledWith('test-device-token', wrong.id, expect.objectContaining({
      state: 'FAILED', resultCode: 'FIELD_TASK_STORE_MISMATCH', effectBoundary: 'NOT_CROSSED', physicalCompletionKnown: false,
    }))
  })

  it('replays an unreported terminal result after reconnect without printing twice', async () => {
    const store = await stateStore(); await store.load()
    await store.recordTerminal({ taskId: 'task-recovery-1', idempotencyKey: 'eshop-tray:recovery:0001', storeId: 'store-field-001', result: {
      state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER', effectBoundary: 'CROSSED', physicalCompletionKnown: false,
    } })
    const { runtime, port, deliver } = await worker({ claimed: task(), store })
    await runtime.runOnceForTest()
    expect(port.report).toHaveBeenCalledWith('test-device-token', 'task-recovery-1', expect.anything())
    expect(port.claim).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('turns an interrupted executing journal into CROSSING_UNKNOWN and never re-executes it', async () => {
    const store = await stateStore(); await store.load()
    await store.recordExecuting({ taskId: 'task-interrupted-1', idempotencyKey: 'eshop-tray:interrupted:0001', storeId: 'store-field-001' })
    const { runtime, port, deliver } = await worker({ claimed: task(), store })
    await runtime.runOnceForTest()
    expect(port.report).toHaveBeenCalledWith('test-device-token', 'task-interrupted-1', expect.objectContaining({
      state: 'FAILED', resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION', effectBoundary: 'CROSSING_UNKNOWN', physicalCompletionKnown: false,
    }))
    expect(port.claim).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('persists a printer failure for later result replay', async () => {
    const store = await stateStore()
    const deliver = vi.fn(async () => { throw new Error('PRINT_TIMEOUT') })
    const { runtime, port } = await worker({ claimed: task(), store, deliver })
    port.report.mockRejectedValueOnce(new Error('CLOUD_NETWORK_ERROR'))
    await expect(runtime.runOnceForTest()).rejects.toThrow('CLOUD_NETWORK_ERROR')
    expect(store.records()[0]).toMatchObject({ state: 'TERMINAL', reported: false, result: { state: 'FAILED', resultCode: 'PRINT_TIMEOUT', effectBoundary: 'CROSSING_UNKNOWN' } })
    await runtime.runOnceForTest()
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(store.records()[0].reported).toBe(true)
  })
})
