import assert from 'node:assert/strict'
import test from 'node:test'
import { bootstrapFreshV3ControlPlane, type FreshV3BootstrapDb } from '../lib/v3-print-control-plane'

const now = new Date('2026-10-04T01:00:00.000Z')

function fixture(options: {
  existingPlane?: boolean
  otherDevice?: boolean
  computerBinding?: boolean
  runtimeBinding?: boolean
  runtimeTask?: boolean
  v2Job?: boolean
  batch?: boolean
  reactivatedDevice?: boolean
  serializationFailures?: number
} = {}) {
  let plane: any = options.existingPlane ? {
    id: 'plane-old', tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: null, ownerEpoch: 0,
    leaseId: null, leaseExpiresAt: null, mode: 'V2_ACTIVE', stateVersion: 1,
    handoffRequestedAt: null, handoffQuarantineUntil: null, lastReconciledAt: null,
    createdAt: now, updatedAt: now,
  } : null
  const audits: any[] = []
  const transactionOptions: any[] = []
  let failures = options.serializationFailures ?? 0
  const tx: any = {
    $queryRaw: async () => [{ id: 'store-a' }],
    v3PrintControlPlane: {
      findUnique: async () => plane,
      create: async ({ data }: any) => {
        plane = {
          id: 'plane-new', ownerDeviceId: null, ownerEpoch: 0, leaseId: null, leaseExpiresAt: null,
          stateVersion: 1, handoffRequestedAt: null, handoffQuarantineUntil: null,
          createdAt: now, updatedAt: now, ...data,
        }
        return plane
      },
      upsert: async () => plane,
      updateMany: async () => ({ count: 0 }),
    },
    v3PrintExecutionBatch: {
      findFirst: async () => options.batch ? { id: 'batch-old' } : null,
      create: async () => { throw new Error('UNEXPECTED_BATCH_CREATE') },
      updateMany: async () => ({ count: 0 }),
    },
    desktopDevice: {
      findFirst: async ({ where }: any) => where.id
        ? { id: 'device-a', tokenVersion: options.reactivatedDevice ? 2 : 1, replacesDeviceId: null }
        : options.otherDevice ? { id: 'device-old' } : null,
    },
    computerBinding: { findFirst: async () => options.computerBinding ? { id: 'rc10-a' } : null },
    storeRuntimePrinterBinding: { findFirst: async () => options.runtimeBinding ? { id: 'binding-a' } : null },
    storeRuntimePrintTask: { findFirst: async () => options.runtimeTask ? { id: 'task-a' } : null },
    eshopTrayPrintJob: {
      findFirst: async () => options.v2Job ? { id: 'job-a' } : null,
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async () => { throw new Error('UNEXPECTED_JOB_CREATE') },
    },
    operationLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${audits.length + 1}`, ...data }
        audits.push(row)
        return row
      },
    },
  }
  const db = {
    ...tx,
    $transaction: async (operation: (value: any) => Promise<any>, config?: any) => {
      transactionOptions.push(config)
      if (failures > 0) {
        failures -= 1
        throw Object.assign(new Error('serialization'), { code: 'P2034' })
      }
      return operation(tx)
    },
  } as unknown as FreshV3BootstrapDb
  return { db, plane: () => plane, audits, transactionOptions }
}

const identity = { tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a' }

test('fresh bootstrap atomically creates an unowned V3_ACTIVE plane and an audit', async () => {
  const state = fixture({ serializationFailures: 1 })
  const result = await bootstrapFreshV3ControlPlane(state.db, identity, now)
  assert.equal(result.ok, true)
  assert.equal(state.plane().mode, 'V3_ACTIVE')
  assert.equal(state.plane().ownerDeviceId, null)
  assert.equal(state.plane().ownerEpoch, 0)
  assert.equal(state.audits.length, 1)
  assert.equal(state.audits[0].actionType, 'FRESH_V3_BOOTSTRAP_SUCCESS')
  assert.deepEqual(state.transactionOptions, [
    { isolationLevel: 'Serializable' },
    { isolationLevel: 'Serializable' },
  ])
})

test('fresh bootstrap never mutates an existing legacy-safe V2 control plane', async () => {
  const state = fixture({ existingPlane: true })
  assert.deepEqual(await bootstrapFreshV3ControlPlane(state.db, identity, now), {
    ok: false,
    code: 'FRESH_BOOTSTRAP_NOT_ELIGIBLE',
  })
  assert.equal(state.plane().mode, 'V2_ACTIVE')
  assert.equal(state.audits[0].payloadSnapshot.blocker, 'CONTROL_PLANE_PRESENT')
})

test('fresh bootstrap fails closed for every retained RC10/V2/runtime owner signal', async () => {
  const cases = [
    ['otherDevice', 'DESKTOP_DEVICE_HISTORY_PRESENT'],
    ['computerBinding', 'RC10_BINDING_PRESENT'],
    ['runtimeBinding', 'STORE_RUNTIME_BINDING_PRESENT'],
    ['runtimeTask', 'STORE_RUNTIME_TASK_PRESENT'],
    ['v2Job', 'V2_PRINT_JOB_PRESENT'],
    ['batch', 'V3_BATCH_PRESENT'],
    ['reactivatedDevice', 'CURRENT_DEVICE_NOT_FRESH'],
  ] as const
  for (const [flag, blocker] of cases) {
    const state = fixture({ [flag]: true })
    const result = await bootstrapFreshV3ControlPlane(state.db, identity, now)
    assert.deepEqual(result, { ok: false, code: 'FRESH_BOOTSTRAP_NOT_ELIGIBLE' }, flag)
    assert.equal(state.plane(), null, flag)
    assert.equal(state.audits[0].payloadSnapshot.blocker, blocker, flag)
  }
})
