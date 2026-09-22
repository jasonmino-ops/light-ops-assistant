import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import { deliverV3PrintIntent, enqueueV3PrintIntent, reportV3Execution, type V3Intent } from '../lib/v3-print-job-adapter'
import { canonicalV3PrintEffectKey } from '../lib/v3-print-identity'

const now = new Date('2026-09-23T00:00:00.000Z')
const expiresAt = new Date('2026-09-23T01:00:00.000Z')
const scope = { tenantId: 'tenant-a', storeId: 'store-a' }
const identity = { ...scope, deviceId: 'device-a', batchId: 'batch-a' }
function intent(overrides: Partial<Extract<V3Intent, { payloadKind: 'RAW_BYTES' }>> = {}): V3Intent {
  const bytes = Buffer.from('receipt')
  return { schemaVersion: 3, printJobId: 'job-canonical-001', source: 'CLOUD_H5', role: 'FRONT', payloadKind: 'RAW_BYTES', rendererVersion: 'renderer-v3',
    payloadBase64: bytes.toString('base64'), byteLength: bytes.length, payloadHash: createHash('sha256').update(bytes).digest('hex'), ...overrides }
}
function database() {
  const jobs: any[] = []
  const batch: any = { id: 'batch-a', controlPlaneId: 'control-a', ...scope, ownerDeviceId: 'device-a', ownerEpoch: 7,
    stateVersion: 4, leaseId: 'lease-a', mode: 'V3_ACTIVE', expiresAt, revokedAt: null,
    controlPlane: { mode: 'V3_ACTIVE', ownerDeviceId: 'device-a', ownerEpoch: 7, stateVersion: 4, leaseId: 'lease-a' } }
  const matches = (job: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'expiresAt') return !value.gt || job.expiresAt > value.gt
    if (key === 'nextAttemptAt') return !value.lte || job.nextAttemptAt <= value.lte
    if (value && typeof value === 'object' && !Array.isArray(value)) return true
    return job[key] === value
  })
  const db: any = { jobs, batch,
    v3PrintExecutionBatch: { findUnique: async ({ where, include }: any) => where.id === batch.id ? (include ? batch : { ...batch, controlPlane: undefined }) : null },
    eshopTrayPrintJob: {
      create: async ({ data }: any) => {
        if (jobs.some(job => job.tenantId === data.tenantId && job.storeId === data.storeId && job.idempotencyKey === data.idempotencyKey)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' })
        }
        const job = { id: `row-${jobs.length + 1}`, status: 'PENDING', claimTokenHash: null, claimAttempt: 0, attemptCount: 0,
          nextAttemptAt: now, completedAt: null, resultCode: null, resultMessage: null, ...data, createdAt: now, updatedAt: now }
        jobs.push(job); return job
      },
      findUnique: async ({ where }: any) => jobs.find(job => job.tenantId === where.tenantId_storeId_idempotencyKey.tenantId &&
        job.storeId === where.tenantId_storeId_idempotencyKey.storeId && job.idempotencyKey === where.tenantId_storeId_idempotencyKey.idempotencyKey) ?? null,
      findFirst: async ({ where }: any) => jobs.filter(job => matches(job, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null,
      updateMany: async ({ where, data }: any) => {
        const selected = jobs.filter(job => matches(job, where))
        for (const job of selected) for (const [key, value] of Object.entries(data) as [string, any][]) job[key] = value && typeof value === 'object' && 'increment' in value ? job[key] + value.increment : value
        return { count: selected.length }
      },
    },
  }
  return db
}

test('schema 3 create is strict and duplicate create is idempotent', async () => {
  const db = database(), value = intent()
  assert.equal((await enqueueV3PrintIntent(db, scope, value, expiresAt)).created, true)
  assert.equal((await enqueueV3PrintIntent(db, scope, value, expiresAt)).created, false)
  await assert.rejects(enqueueV3PrintIntent(db, scope, { ...value, schemaVersion: 2 } as any, expiresAt), /V3_INTENT_INVALID/)
  assert.equal(db.jobs.length, 1); assert.equal(db.jobs[0].schemaVersion, 3); assert.equal(db.jobs[0].physicalCompletionKnown, false)
})

test('delivery requires a live owner-scoped batch', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt)
  assert.deepEqual(await deliverV3PrintIntent(db, { ...identity, deviceId: 'stale-device' }, now), { ok: false, code: 'V3_BATCH_STALE' })
  const delivered = await deliverV3PrintIntent(db, identity, now)
  assert.equal(delivered.ok, true); assert.equal(delivered.ok && delivered.job?.printJobId, 'job-canonical-001')
  assert.equal(db.jobs[0].status, 'CLAIMED'); assert.equal(db.jobs[0].attemptCount, 1)
})

test('restart redelivery is same-device same-epoch only', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt); await deliverV3PrintIntent(db, identity, now)
  db.batch.id = 'batch-b'
  assert.equal((await deliverV3PrintIntent(db, { ...identity, batchId: 'batch-b' }, now)).ok, true)
  db.batch.ownerEpoch = 8; db.batch.controlPlane.ownerEpoch = 8
  assert.deepEqual(await deliverV3PrintIntent(db, { ...identity, batchId: 'batch-b' }, now), { ok: false, code: 'V3_CLAIM_AMBIGUOUS' })
})

test('report ACK is idempotent and never claims physical completion', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt); await deliverV3PrintIntent(db, identity, now)
  const report = { printJobId: 'job-canonical-001', source: 'CLOUD_H5' as const, role: 'FRONT' as const,
    executionId: 'execution-a', ownerEpoch: 7, outcome: 'CROSSED' as const }
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].physicalCompletionKnown, false); assert.equal(db.jobs[0].claimTokenHash, null)
})

test('Local-first report creates an endpoint-free reconciliation destination', async () => {
  const db = database()
  const report = { printJobId: 'job-local-001', source: 'LOCAL_DESKTOP' as const, role: 'KITCHEN' as const,
    executionId: 'execution-local', ownerEpoch: 7, outcome: 'CROSSING_UNKNOWN' as const }
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].schemaVersion, 3); assert.equal(db.jobs[0].resultStatus, 'CROSSING_UNKNOWN')
  assert.equal(/host|port|endpoint/i.test(JSON.stringify(db.jobs[0].payload)), false)
})

test('delayed Cloud intent recognizes the terminal Local reconciliation without creating a second job', async () => {
  const db = database()
  const report = { printJobId: 'job-canonical-001', source: 'LOCAL_DESKTOP' as const, role: 'FRONT' as const,
    executionId: 'execution-local', ownerEpoch: 7, outcome: 'CROSSED' as const }
  await reportV3Execution(db, identity, report, now)
  assert.equal((await enqueueV3PrintIntent(db, scope, intent(), expiresAt)).created, false)
  assert.equal(db.jobs.length, 1)
  assert.equal((await deliverV3PrintIntent(db, identity, now)).job, null)
})

test('Local terminal atomically consumes an already pending Cloud intent for the same canonical effect', async () => {
  const db = database()
  await enqueueV3PrintIntent(db, scope, intent(), expiresAt)
  const report = { printJobId: 'job-canonical-001', source: 'LOCAL_DESKTOP' as const, role: 'FRONT' as const,
    executionId: 'execution-local', ownerEpoch: 7, outcome: 'CROSSED' as const }
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].status, 'SUCCEEDED')
  assert.equal(db.jobs[0].payload.kind, 'LOCAL_RECONCILIATION')
  assert.equal((await deliverV3PrintIntent(db, identity, now)).job, null)
})

test('Local terminal can reconcile a concurrently claimed Cloud intent only under the same batch fence', async () => {
  const db = database()
  await enqueueV3PrintIntent(db, scope, intent(), expiresAt)
  await deliverV3PrintIntent(db, identity, now)
  const report = { printJobId: 'job-canonical-001', source: 'LOCAL_DESKTOP' as const, role: 'FRONT' as const,
    executionId: 'execution-local', ownerEpoch: 7, outcome: 'CROSSED' as const }
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].status, 'SUCCEEDED')
})

test('delayed Cloud intent cannot collide with a Local reconciliation for another role', async () => {
  const db = database()
  await reportV3Execution(db, identity, { printJobId: 'job-canonical-001', source: 'LOCAL_DESKTOP', role: 'KITCHEN',
    executionId: 'execution-local', ownerEpoch: 7, outcome: 'CROSSED' }, now)
  await assert.rejects(enqueueV3PrintIntent(db, scope, intent(), expiresAt), /V3_INTENT_IDEMPOTENCY_CONFLICT/)
})

test('canonical cashier identity is stable, role-specific, and rejects synthetic identity inputs', () => {
  assert.equal(canonicalV3PrintEffectKey('ORDER-123', 'FRONT'), 'cashier-network-v2:ORDER-123:FRONT')
  assert.equal(canonicalV3PrintEffectKey('ORDER-123', 'KITCHEN'), 'cashier-network-v2:ORDER-123:KITCHEN')
  assert.throws(() => canonicalV3PrintEffectKey('', 'FRONT'), /V3_PRINT_ORDER_ID_INVALID/)
  assert.throws(() => canonicalV3PrintEffectKey(' ', 'FRONT'), /V3_PRINT_ORDER_ID_INVALID/)
})

test('Cashier keeps the original path before V3 IPC when canonical order identity is unavailable', () => {
  const cashier = readFileSync(new URL('../app/cashier/page.tsx', import.meta.url), 'utf8')
  assert.match(cashier, /const orderNo = receipt\.orderNo\s+if \(!bridge \|\| !window\.eshopDesktopRuntime\?\.isDesktop \|\| !orderNo\) return false/)
  assert.match(cashier, /canonicalV3PrintEffectKey\(orderNo, role\)/)
  assert.match(cashier, /bridge\.submit\(\{\s*orderNo,/)
  assert.doesNotMatch(cashier, /canonicalV3PrintEffectKey\((?:Date\.now|crypto\.randomUUID|Math\.random)/)
  assert.match(cashier, /if \(await submitV3LocalTickets[\s\S]*?\) return\s+if \(kind === 'receipt'\)/)
})
