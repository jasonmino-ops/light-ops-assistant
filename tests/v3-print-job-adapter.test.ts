import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import { deliverV3PrintIntent, enqueueHeldV3PrintIntent, enqueueV3PrintIntent, materializeHeldV3PrintIntents, reportV3Execution, type V3Intent } from '../lib/v3-print-job-adapter'
import { canonicalV3PrintEffectKey } from '../lib/v3-print-identity'

const now = new Date('2026-09-23T00:00:00.000Z')
const expiresAt = new Date('2026-09-23T01:00:00.000Z')
const scope = { tenantId: 'tenant-a', storeId: 'store-a' }
const identity = { ...scope, deviceId: 'device-a', batchId: 'batch-a' }
function intent(overrides: Partial<Extract<V3Intent, { payloadKind: 'RAW_BYTES' }>> = {}): V3Intent {
  const bytes = Buffer.from('receipt')
  return { schemaVersion: 3, printJobId: 'job-canonical-001', source: 'CLOUD_H5', role: 'FRONT', payloadKind: 'RAW_BYTES', rendererVersion: 'renderer-v3',
    payloadBase64: bytes.toString('base64'), byteLength: bytes.length, payloadHash: createHash('sha256').update(bytes).digest('hex'), ...overrides,
    orderNo: overrides.orderNo ?? 'ORDER-001' }
}
function database(options: { rejectDeviceIdInPersistenceScope?: boolean } = {}) {
  const jobs: any[] = []
  const controlPlane: any = { mode: 'V3_ACTIVE', ownerDeviceId: 'device-a', ownerEpoch: 7,
    stateVersion: 4, leaseId: 'lease-a', leaseExpiresAt: expiresAt }
  const batch: any = { id: 'batch-a', controlPlaneId: 'control-a', ...scope, ownerDeviceId: 'device-a', ownerEpoch: 7,
    stateVersion: 4, leaseId: 'lease-a', mode: 'V3_ACTIVE', expiresAt, revokedAt: null, controlPlane }
  const batches = [batch]
  const matches = (job: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('gt' in value && !(job[key] > value.gt)) return false
      if ('lte' in value && !(job[key] <= value.lte)) return false
      if ('not' in value && job[key] === value.not) return false
      if ('in' in value && !value.in.includes(job[key])) return false
      return true
    }
    return job[key] === value
  })
  const assertActiveClaimConstraint = (job: any) => {
    if (job.status === 'CLAIMED' || job.status === 'EXECUTING') {
      assert.ok(job.claimedByComputerBindingId)
      assert.ok(job.claimTokenHash)
      assert.ok(job.claimAttempt > 0)
      assert.ok(job.leaseExpiresAt)
    }
  }
  const assertPersistenceScope = (value: Record<string, unknown>) => {
    if (options.rejectDeviceIdInPersistenceScope) assert.equal(Object.hasOwn(value, 'deviceId'), false)
  }
  const db: any = { jobs, batch, batches, controlPlane,
    v3PrintExecutionBatch: { findUnique: async ({ where, include }: any) => {
      const selected = batches.find(value => value.id === where.id)
      return selected ? (include ? { ...selected, controlPlane } : { ...selected, controlPlane: undefined }) : null
    } },
    eshopTrayPrintJob: {
      create: async ({ data }: any) => {
        assertPersistenceScope(data)
        if (jobs.some(job => job.tenantId === data.tenantId && job.storeId === data.storeId && job.idempotencyKey === data.idempotencyKey)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' })
        }
        const job = { id: `row-${jobs.length + 1}`, status: 'PENDING', claimedByComputerBindingId: null, claimTokenHash: null,
          claimAttempt: 0, attemptCount: 0, leaseExpiresAt: null, nextAttemptAt: now, completedAt: null,
          resultCode: null, resultMessage: null, ...data, createdAt: now, updatedAt: now }
        assertActiveClaimConstraint(job)
        jobs.push(job); return job
      },
      findUnique: async ({ where }: any) => {
        assertPersistenceScope(where.tenantId_storeId_idempotencyKey)
        return jobs.find(job => job.tenantId === where.tenantId_storeId_idempotencyKey.tenantId &&
        job.storeId === where.tenantId_storeId_idempotencyKey.storeId && job.idempotencyKey === where.tenantId_storeId_idempotencyKey.idempotencyKey) ?? null
      },
      findFirst: async ({ where }: any) => {
        assertPersistenceScope(where)
        return jobs.filter(job => matches(job, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null
      },
      findMany: async ({ where }: any) => {
        assertPersistenceScope(where)
        return jobs.filter(job => matches(job, where))
      },
      updateMany: async ({ where, data }: any) => {
        const selected = jobs.filter(job => matches(job, where))
        for (const job of selected) {
          const next = { ...job }
          for (const [key, value] of Object.entries(data) as [string, any][]) {
            next[key] = value && typeof value === 'object' && 'increment' in value ? next[key] + value.increment : value
          }
          assertActiveClaimConstraint(next)
          Object.assign(job, next)
        }
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
  assert.equal(db.jobs[0].status, 'PENDING')
  assert.equal(db.jobs[0].claimedByComputerBindingId, null)
  assert.match(db.jobs[0].resultMessage, /^V3_CLAIM:device-a:7:batch-a$/)
  assert.equal(db.jobs[0].attemptCount, 1)
  assert.equal(db.jobs[0].claimAttempt, 1)
  assert.ok(db.jobs[0].claimTokenHash)
})

test('delivery rejects wrong scope, stale ownerEpoch/lease/stateVersion, and expired owner lease', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt)
  assert.deepEqual(await deliverV3PrintIntent(db, { ...identity, tenantId: 'tenant-b' }, now), { ok: false, code: 'V3_BATCH_STALE' })
  assert.deepEqual(await deliverV3PrintIntent(db, { ...identity, storeId: 'store-b' }, now), { ok: false, code: 'V3_BATCH_STALE' })
  db.batch.controlPlane.stateVersion += 1
  assert.deepEqual(await deliverV3PrintIntent(db, identity, now), { ok: false, code: 'V3_BATCH_STALE' })
  db.batch.controlPlane.stateVersion = db.batch.stateVersion
  db.batch.controlPlane.ownerEpoch += 1
  assert.deepEqual(await deliverV3PrintIntent(db, identity, now), { ok: false, code: 'V3_BATCH_STALE' })
  db.batch.controlPlane.ownerEpoch = db.batch.ownerEpoch
  db.batch.controlPlane.leaseId = 'lease-b'
  assert.deepEqual(await deliverV3PrintIntent(db, identity, now), { ok: false, code: 'V3_BATCH_STALE' })
  db.batch.controlPlane.leaseId = db.batch.leaseId
  db.batch.controlPlane.leaseExpiresAt = now
  assert.deepEqual(await deliverV3PrintIntent(db, identity, now), { ok: false, code: 'V3_BATCH_STALE' })
  assert.equal(db.jobs[0].claimAttempt, 0)
})

for (const role of ['FRONT', 'KITCHEN'] as const) {
  test(`CLOUD_REMOTE_REPRINT ${role} is claimed once with its exact intentional identity and role`, async () => {
    const db = database()
    const printJobId = `v3-reprint:${role.toLowerCase()}:11111111-2222-4333-8444-555555555555`
    await enqueueV3PrintIntent(db, scope, intent({
      printJobId, source: 'CLOUD_REMOTE_REPRINT', role, orderNo: 'ORDER-REPRINT-001', rendererVersion: 'reprint-raw-v1',
    }), expiresAt)
    const first = await deliverV3PrintIntent(db, identity, now)
    const second = await deliverV3PrintIntent(db, identity, now)
    assert.equal(first.ok && first.job?.printJobId, printJobId)
    assert.equal(first.ok && first.job?.intent.source, 'CLOUD_REMOTE_REPRINT')
    assert.equal(first.ok && first.job?.intent.role, role)
    assert.equal(second.ok && second.job, null)
    assert.notEqual(printJobId, `network:${createHash('sha256').update(canonicalV3PrintEffectKey('ORDER-REPRINT-001', role)).digest('hex')}`)
    assert.equal(db.jobs[0].claimAttempt, 1)
    assert.equal(db.jobs[0].attemptCount, 1)
    assert.deepEqual(await reportV3Execution(db, identity, {
      printJobId, source: 'CLOUD_REMOTE_REPRINT', role, executionId: `execution-${role.toLowerCase()}`,
      ownerEpoch: 7, reportVersion: 1, outcome: 'CROSSED',
    }, now), { ok: true, acknowledged: true })
    assert.equal(db.jobs[0].status, 'SUCCEEDED')
    assert.equal(db.jobs[0].claimTokenHash, null)
  })
}

test('CLOUD_REMOTE_REPRINT UNKNOWN is terminally reconciled and never redelivered as a physical retry', async () => {
  const db = database()
  const printJobId = 'v3-reprint:kitchen:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  await enqueueV3PrintIntent(db, scope, intent({
    printJobId, source: 'CLOUD_REMOTE_REPRINT', role: 'KITCHEN', orderNo: 'ORDER-REPRINT-UNKNOWN', rendererVersion: 'reprint-raw-v1',
  }), expiresAt)
  assert.equal((await deliverV3PrintIntent(db, identity, now)).job?.printJobId, printJobId)
  assert.deepEqual(await reportV3Execution(db, identity, {
    printJobId, source: 'CLOUD_REMOTE_REPRINT', role: 'KITCHEN', executionId: 'execution-unknown',
    ownerEpoch: 7, reportVersion: 1, outcome: 'CROSSING_UNKNOWN',
  }, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].resultStatus, 'CROSSING_UNKNOWN')
  assert.equal(db.jobs[0].attemptCount, 1)
  assert.equal((await deliverV3PrintIntent(db, identity, now)).job, null)
})

test('transition admission is durably HELD across restart and materializes only for final V3 mode', async () => {
  const db = database()
  await enqueueHeldV3PrintIntent(db, scope, intent(), expiresAt)
  assert.equal(db.jobs[0].resultMessage, 'V3_DURABLY_HELD')
  assert.equal((await deliverV3PrintIntent(db, identity, now)).job, null)
  const restartedDb = { ...db, eshopTrayPrintJob: db.eshopTrayPrintJob }
  assert.equal(await materializeHeldV3PrintIntents(restartedDb as any, scope, 'V3_ACTIVE', now), 1)
  assert.equal(db.jobs[0].resultMessage, null)
  assert.equal((await deliverV3PrintIntent(db, identity, now)).job?.printJobId, 'job-canonical-001')
})

test('no-batch local HOLD projects rich Desktop auth context to schema-3 persistence scope', async () => {
  const db = database({ rejectDeviceIdInPersistenceScope: true })
  const desktopContext = { ...scope, deviceId: 'device-a' }
  for (const role of ['FRONT', 'KITCHEN'] as const) {
    const printJobId = `network:held-${role.toLowerCase()}-001`
    const held = await enqueueHeldV3PrintIntent(db, desktopContext, intent({
      printJobId, source: 'LOCAL_DESKTOP', role,
    }), expiresAt)
    assert.equal(held.created, true)
    assert.equal(held.job.idempotencyKey, printJobId)
    assert.equal(held.job.schemaVersion, 3)
    assert.equal(held.job.resultMessage, 'V3_DURABLY_HELD')
    assert.equal(held.job.attemptCount, 0)
    assert.equal(held.job.claimAttempt, 0)
  }
  assert.equal(await materializeHeldV3PrintIntents(db, desktopContext, 'V3_ACTIVE', now), 2)
  assert.deepEqual(db.jobs.map((job: any) => job.idempotencyKey), [
    'network:held-front-001', 'network:held-kitchen-001',
  ])
  assert.ok(db.jobs.every((job: any) => !Object.hasOwn(job, 'deviceId')))
})

test('final V2 mode materializes held local bytes into the existing schema-1 path', async () => {
  const db = database()
  await enqueueHeldV3PrintIntent(db, scope, intent({ source: 'LOCAL_DESKTOP', role: 'KITCHEN' }), expiresAt)
  assert.equal(await materializeHeldV3PrintIntents(db, scope, 'V2_ACTIVE', now), 1)
  assert.equal(db.jobs[0].schemaVersion, 1)
  assert.equal(db.jobs[0].idempotencyKey, 'job-canonical-001')
  assert.equal(db.jobs[0].payload.orderNo, 'ORDER-001')
  assert.equal(db.jobs[0].payload.commandStream.data, Buffer.from('receipt').toString('base64'))
  assert.equal(db.jobs[0].resultMessage, null)
})

test('batch renewal preserves the original durable claim and report without redelivery', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt); await deliverV3PrintIntent(db, identity, now)
  db.controlPlane.stateVersion = 5
  db.batches.push({ ...db.batch, id: 'batch-b', stateVersion: 5, controlPlane: db.controlPlane })
  assert.deepEqual(await deliverV3PrintIntent(db, { ...identity, batchId: 'batch-b' }, now), { ok: true, job: null })
  assert.equal(db.jobs[0].resultMessage, 'V3_CLAIM:device-a:7:batch-a')
  assert.equal(db.jobs[0].claimAttempt, 1)
  assert.equal(db.jobs[0].attemptCount, 1)
  assert.deepEqual(await reportV3Execution(db, identity, {
    printJobId: 'job-canonical-001', source: 'CLOUD_H5', role: 'FRONT', executionId: 'execution-a',
    ownerEpoch: 7, reportVersion: 1, outcome: 'CROSSED',
  }, now), { ok: true, acknowledged: true })
})

test('concurrent callers receive a schema-3 job at most once', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt)
  const results = await Promise.all([deliverV3PrintIntent(db, identity, now), deliverV3PrintIntent(db, identity, now)])
  assert.equal(results.filter(result => result.ok && result.job).length, 1)
  assert.equal(results.filter(result => result.ok && result.job === null).length +
    results.filter(result => !result.ok && result.code === 'V3_DELIVERY_RACE').length, 1)
  assert.equal(db.jobs[0].claimAttempt, 1)
  assert.equal(db.jobs[0].attemptCount, 1)
})

test('a new owner epoch cannot inherit an outstanding V3 delivery reservation', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt); await deliverV3PrintIntent(db, identity, now)
  db.controlPlane.ownerEpoch = 8
  db.controlPlane.stateVersion = 5
  db.controlPlane.leaseId = 'lease-b'
  db.batches.push({ ...db.batch, id: 'batch-b', ownerEpoch: 8, stateVersion: 5, leaseId: 'lease-b', controlPlane: db.controlPlane })
  assert.deepEqual(await deliverV3PrintIntent(db, { ...identity, batchId: 'batch-b' }, now), {
    ok: false, code: 'V3_CLAIM_AMBIGUOUS',
  })
})

test('report ACK is idempotent and never claims physical completion', async () => {
  const db = database(); await enqueueV3PrintIntent(db, scope, intent(), expiresAt); await deliverV3PrintIntent(db, identity, now)
  const report = { printJobId: 'job-canonical-001', source: 'CLOUD_H5' as const, role: 'FRONT' as const,
    executionId: 'execution-a', ownerEpoch: 7, reportVersion: 1, outcome: 'CROSSED' as const }
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].physicalCompletionKnown, false); assert.equal(db.jobs[0].claimTokenHash, null)
})

test('Local-first report creates an endpoint-free reconciliation destination', async () => {
  const db = database()
  const report = { printJobId: 'job-local-001', source: 'LOCAL_DESKTOP' as const, role: 'KITCHEN' as const,
    executionId: 'execution-local', ownerEpoch: 7, reportVersion: 1, outcome: 'CROSSING_UNKNOWN' as const }
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].schemaVersion, 3); assert.equal(db.jobs[0].resultStatus, 'CROSSING_UNKNOWN')
  assert.equal(/host|port|endpoint/i.test(JSON.stringify(db.jobs[0].payload)), false)
})

test('a higher-version terminal fact safely reconciles an earlier UNKNOWN report without retrying print', async () => {
  const db = database()
  const unknown = { printJobId: 'job-local-001', source: 'LOCAL_DESKTOP' as const, role: 'FRONT' as const,
    executionId: 'execution-local', ownerEpoch: 7, reportVersion: 1, outcome: 'CROSSING_UNKNOWN' as const }
  assert.deepEqual(await reportV3Execution(db, identity, unknown, now), { ok: true, acknowledged: true })
  assert.deepEqual(await reportV3Execution(db, identity, { ...unknown, reportVersion: 2, outcome: 'CROSSED' }, now),
    { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].resultStatus, 'CROSSED')
  assert.equal(db.jobs[0].status, 'SUCCEEDED')
})

test('delayed Cloud intent recognizes the terminal Local reconciliation without creating a second job', async () => {
  const db = database()
  const report = { printJobId: 'job-canonical-001', source: 'LOCAL_DESKTOP' as const, role: 'FRONT' as const,
    executionId: 'execution-local', ownerEpoch: 7, reportVersion: 2, outcome: 'CROSSED' as const }
  await reportV3Execution(db, identity, report, now)
  assert.equal((await enqueueV3PrintIntent(db, scope, intent(), expiresAt)).created, false)
  assert.equal(db.jobs.length, 1)
  assert.equal((await deliverV3PrintIntent(db, identity, now)).job, null)
})

test('Local terminal atomically consumes an already pending Cloud intent for the same canonical effect', async () => {
  const db = database()
  await enqueueV3PrintIntent(db, scope, intent(), expiresAt)
  const report = { printJobId: 'job-canonical-001', source: 'LOCAL_DESKTOP' as const, role: 'FRONT' as const,
    executionId: 'execution-local', ownerEpoch: 7, reportVersion: 2, outcome: 'CROSSED' as const }
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
    executionId: 'execution-local', ownerEpoch: 7, reportVersion: 2, outcome: 'CROSSED' as const }
  assert.deepEqual(await reportV3Execution(db, identity, report, now), { ok: true, acknowledged: true })
  assert.equal(db.jobs[0].status, 'SUCCEEDED')
})

test('delayed Cloud intent cannot collide with a Local reconciliation for another role', async () => {
  const db = database()
  await reportV3Execution(db, identity, { printJobId: 'job-canonical-001', source: 'LOCAL_DESKTOP', role: 'KITCHEN',
    executionId: 'execution-local', ownerEpoch: 7, reportVersion: 2, outcome: 'CROSSED' }, now)
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
  assert.match(cashier, /const orderNo = receipt\.orderNo\s+if \(!window\.eshopDesktopRuntime\?\.isDesktop \|\| !orderNo\) \{\s*return \{ route: 'V2_LEGACY', acceptedRoles: \[\], rejectedRoles: \[\] \}\s*\}/)
  assert.match(cashier, /if \(!bridge\) return \{ route: 'V3', acceptedRoles: \[\], rejectedRoles: \[\.\.\.roles\] \}/)
  assert.match(cashier, /canonicalV3PrintEffectKey\(orderNo, role\)/)
  assert.match(cashier, /bridge\.submit\(\{\s*orderNo,/)
  assert.doesNotMatch(cashier, /canonicalV3PrintEffectKey\((?:Date\.now|crypto\.randomUUID|Math\.random)/)
  assert.match(cashier, /if \(admission\.route === 'V3'\) \{\s*if \(admission\.rejectedRoles\.length === 0\) return\s*throw new Error\('V3_DURABLE_ADMISSION_NOT_ACCEPTED'\)/)
  assert.match(cashier, /result\?\.admission === 'DURABLY_ACCEPTED'/)
  assert.match(cashier, /try \{[\s\S]*?await bridge\.submit[\s\S]*?\} catch \{\s*rejectedRoles\.push\(role\)/)
  assert.doesNotMatch(cashier, /result\?\.status === '(?:HELD|CROSSED|FAILED_NOT_CROSSED|CROSSING_UNKNOWN|NOT_EXECUTED)'/)
  assert.match(cashier, /result\?\.status === 'V2_FALLBACK_REQUIRED' && result\.reason == null && acceptedRoles\.length === 0/)
  assert.doesNotMatch(cashier, /result\?\.status === 'V2_FALLBACK_REQUIRED' && acceptedRoles\.length === 0/)
})
