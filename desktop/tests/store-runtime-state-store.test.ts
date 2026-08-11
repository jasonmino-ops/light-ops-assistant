import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { StoreRuntimeStateStore } from '../src/main/storeRuntime/stateStore'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempStore() {
  const path = await mkdtemp(join(tmpdir(), 'eshop-store-runtime-'))
  tempDirs.push(path)
  return new StoreRuntimeStateStore(path)
}

describe('Store Runtime local recovery state', () => {
  it('atomically persists the cached printer binding and terminal result journal', async () => {
    const store = await tempStore()
    await store.load()
    await store.setBinding({
      id: 'binding-001',
      tenantId: 'tenant-001',
      storeId: 'store-001',
      targetType: 'WINDOWS_QUEUE',
      printerName: 'EPSON TM-T82',
      enabled: true,
      version: 2,
      updatedAt: '2026-08-11T00:00:00.000Z',
    })
    await store.recordAccepted({ taskId: 'task-0001', idempotencyKey: 'receipt:0001', storeId: 'store-001' })
    await store.recordExecuting({ taskId: 'task-0001', idempotencyKey: 'receipt:0001', storeId: 'store-001' })
    await store.recordTerminal({
      taskId: 'task-0001',
      idempotencyKey: 'receipt:0001',
      storeId: 'store-001',
      result: {
        state: 'FAILED',
        resultCode: 'PRINTER_OFFLINE',
        effectBoundary: 'NOT_CROSSED',
        physicalCompletionKnown: false,
      },
    })

    const reloaded = new StoreRuntimeStateStore(dirname(dirname(store.path)))
    await reloaded.load()
    expect(reloaded.binding()).toMatchObject({ printerName: 'EPSON TM-T82', version: 2 })
    expect(reloaded.records()).toEqual([expect.objectContaining({
      taskId: 'task-0001',
      state: 'TERMINAL',
      reported: false,
      result: expect.objectContaining({ resultCode: 'PRINTER_OFFLINE', physicalCompletionKnown: false }),
    })])
    expect(await readFile(store.path, 'utf8')).not.toContain('.tmp-')
  })

  it('marks a terminal result reported without removing the trace', async () => {
    const store = await tempStore()
    await store.recordTerminal({
      taskId: 'task-0002',
      idempotencyKey: 'receipt:0002',
      storeId: 'store-001',
      result: {
        state: 'SUCCEEDED',
        resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
        effectBoundary: 'CROSSED',
        physicalCompletionKnown: false,
      },
    })
    await store.markReported('task-0002')
    expect(store.records()[0]).toMatchObject({ state: 'TERMINAL', reported: true })
  })
})
