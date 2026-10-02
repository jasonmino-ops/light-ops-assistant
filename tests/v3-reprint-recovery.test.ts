import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import {
  getOrCreateV3ReprintIntent,
  readAccountV3ReprintAvailability,
  refreshV3ReprintRecoveryProof,
  submitDeviceV3Reprint,
} from '../lib/eShopTrayCloudClient'
import { isDesktopPosDeviceRuntime } from '../lib/es-tray-device-client'
import {
  enqueueV3ManualReprintWithDb,
  parseV3ReprintRequest,
  readV3ReprintAvailabilityWithDb,
  V3ReprintError,
  type V3ReprintRequest,
} from '../lib/v3-print-reprint'
import {
  canonicalV3OriginalPrintJobId,
  classifyV3OperatorPrintJob,
  issueV3OperatorRecoveryProofWithDb,
  verifyV3OperatorRecoveryProof,
} from '../lib/v3-print-operator-status'
import {
  handleAccountV3ReprintRequest,
  handleDeviceV3ReprintRequest,
  type V3ReprintRouteDependencies,
} from '../lib/v3-print-reprint-routes'

const bytes = Buffer.from([0x1b, 0x40, 0x0a])
process.env.DESKTOP_DEVICE_TOKEN_SECRET ||= 'test-v3-operator-recovery-secret'
const stream = {
  encoding: 'base64' as const,
  byteLength: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  data: bytes.toString('base64'),
}

function input(overrides: Partial<V3ReprintRequest> = {}): V3ReprintRequest {
  return {
    schemaVersion: 3,
    requestId: 'v3-reprint:front:11111111-2222-4333-8444-555555555555',
    orderNo: 'ORDER-REPRINT-1',
    role: 'FRONT',
    confirmation: 'OPERATOR_CONFIRMED',
    rendererVersion: 'reprint-raw-v1',
    commandStream: stream,
    ...overrides,
  }
}

function fakeDb(options: {
  mode?: string
  kitchenEnabled?: boolean
  orderExists?: boolean
  originalUnknown?: boolean
  originalPending?: boolean
  originalMissing?: boolean
  enqueueFailure?: boolean
  duplicateConstraint?: 'EXPECTED' | 'UNRELATED'
  role?: 'FRONT' | 'KITCHEN'
} = {}) {
  const jobs: any[] = []
  const audits: any[] = []
  const originalRole = options.role ?? 'FRONT'
  const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', originalRole)
  let original: any = options.originalMissing ? null : {
    id: 'original-front', tenantId: 'tenant-a', storeId: 'store-a', idempotencyKey: originalJobId,
    requestHash: 'a'.repeat(64), schemaVersion: 3,
    payload: {
      schemaVersion: 3, printJobId: originalJobId, source: 'LOCAL_DESKTOP', role: originalRole, payloadKind: 'RAW_BYTES',
      orderNo: 'ORDER-REPRINT-1', rendererVersion: 'network-1', payloadBase64: 'AQ==', byteLength: 1,
      payloadHash: 'b'.repeat(64),
    },
    status: 'SUCCEEDED', claimTokenHash: null, claimAttempt: 1, attemptCount: 1, leaseExpiresAt: null,
    completedAt: new Date('2026-09-23T23:59:00.000Z'), resultStatus: 'CROSSED',
    resultCode: 'V3:execution-a:4:1:CROSSED', resultMessage: null, effectBoundary: 'CROSSED',
    physicalCompletionKnown: false, updatedAt: new Date('2026-09-23T23:59:00.000Z'),
  }
  if (original && options.originalUnknown) {
    Object.assign(original, { status: 'FAILED', effectBoundary: 'CROSSING_UNKNOWN', resultStatus: 'CROSSING_UNKNOWN',
      resultCode: 'V3:x:1:1:CROSSING_UNKNOWN' })
  }
  if (original && options.originalPending) {
    const resultMessage = 'V3_CLAIM:desktop-device-a:4:batch-a'
    Object.assign(original, {
      status: 'PENDING', completedAt: null, effectBoundary: null, resultStatus: null, resultCode: null,
      resultMessage, claimTokenHash: createHash('sha256').update(JSON.stringify([
        'v3-delivery', originalJobId, 'desktop-device-a', 4,
      ])).digest('hex'), leaseExpiresAt: new Date('2026-09-24T01:00:00.000Z'),
      updatedAt: new Date('2026-09-24T00:00:00.000Z'),
    })
  }
  const tx = {
    store: { findFirst: async () => ({ printKitchenTicket: options.kitchenEnabled ?? true }) },
    v3PrintControlPlane: { findUnique: async () => ({ tenantId: 'tenant-a', mode: options.mode ?? 'V3_ACTIVE' }) },
    saleRecord: { findFirst: async () => options.orderExists === false ? null : { id: 'sale-a' } },
    customerOrder: { findFirst: async () => null },
    eshopTrayPrintJob: {
      findUnique: async (args: any) => {
        const key = args.where?.tenantId_storeId_idempotencyKey?.idempotencyKey
        if (key === originalJobId) return original
        return jobs.find((job) => job.idempotencyKey === key) ?? null
      },
      create: async ({ data }: any) => {
        if (options.enqueueFailure) throw new Error('simulated enqueue failure')
        if (jobs.some((job) => job.idempotencyKey === data.idempotencyKey)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: 'test',
            meta: {
              modelName: 'EshopTrayPrintJob',
              target: options.duplicateConstraint === 'UNRELATED'
                ? ['claimTokenHash']
                : ['tenantId', 'storeId', 'idempotencyKey'],
            },
          })
        }
        const job = { id: `job-${jobs.length + 1}`, status: 'PENDING', completedAt: null, ...data }
        jobs.push(job)
        return job
      },
      findFirst: async () => null,
      findMany: async () => original ? [original] : [],
      updateMany: async ({ where, data }: any) => {
        if (!original || where.id !== original.id || original.status !== where.status || original.completedAt !== where.completedAt ||
          original.claimTokenHash !== where.claimTokenHash || original.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 }
        original = { ...original, ...data, updatedAt: new Date('2026-09-24T00:00:01.000Z') }
        return { count: 1 }
      },
    },
    v3PrintExecutionBatch: { findUnique: async () => null },
    operationLog: {
      create: async ({ data }: any) => {
        const audit = { id: `audit-${audits.length + 1}`, ...data }
        audits.push(audit)
        return audit
      },
      findFirst: async ({ where }: any) => audits.find((audit) => audit.requestId === where.requestId) ?? null,
    },
  }
  return {
    db: { $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
      const beforeJobs = structuredClone(jobs)
      const beforeAudits = structuredClone(audits)
      const beforeOriginal = structuredClone(original)
      try {
        return await run(tx)
      } catch (error) {
        jobs.splice(0, jobs.length, ...beforeJobs)
        audits.splice(0, audits.length, ...beforeAudits)
        original = beforeOriginal
        throw error
      }
    } } as any,
    jobs,
    audits,
    original: () => original,
    tx,
  }
}

function request(path: string, method: 'GET' | 'POST', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })
}

function dependencies(overrides: Partial<V3ReprintRouteDependencies> = {}): V3ReprintRouteDependencies {
  return {
    accountContext: async () => ({ tenantId: 'tenant-a', storeId: 'store-a', userId: 'user-a', role: 'STAFF' }),
    deviceContext: async () => ({
      ok: true,
      context: {
        principal: 'BROWSER_POS_DEVICE', browserPosDeviceId: 'browser-a', computerBindingId: 'binding-a',
        tenantId: 'tenant-a', storeId: 'store-a', storeCode: 'STORE-A', enabled: true, unavailableReason: null,
      },
    }),
    availability: async () => ({ enabled: true, kitchenEnabled: true, legacyAllowed: false }),
    enqueue: async (_scope, _actor, value) => ({
      created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role,
    }),
    ...overrides,
  }
}

let cases = 0
async function test(name: string, run: () => void | Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await test('strict V3 reprint contract accepts an explicit role-specific operator confirmation', () => {
    assert.deepEqual(parseV3ReprintRequest(input()), input())
  })

  await test('an original canonical print identity cannot be submitted as a reprint identity', () => {
    assert.throws(() => parseV3ReprintRequest(input({ requestId: `network:${'a'.repeat(64)}` })), /V3_REPRINT_IDENTITY_INVALID/)
  })

  await test('request identity is cryptographically separated by role', () => {
    assert.throws(() => parseV3ReprintRequest(input({ role: 'KITCHEN' })), /V3_REPRINT_IDENTITY_ROLE_MISMATCH/)
  })

  await test('FRONT and KITCHEN manual actions receive independent new identities', () => {
    const front = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'FRONT', () => 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    const kitchen = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'KITCHEN', () => 'v3-reprint:kitchen:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    assert.notEqual(front.requestId, kitchen.requestId)
    assert.equal(front.orderNo, kitchen.orderNo)
  })

  await test('a retry of one unresolved role retains its exact identity and bytes', () => {
    const first = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'FRONT', () => 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    first.commandStream = new Uint8Array(bytes)
    first.recoveryProof = `v3orp1.${Buffer.from('{}').toString('base64url')}.${'a'.repeat(64)}`
    const retry = getOrCreateV3ReprintIntent(first, 'ORDER-1', 'FRONT', () => { throw new Error('must not regenerate') })
    assert.equal(retry, first)
    assert.deepEqual(retry.commandStream, new Uint8Array(bytes))
    assert.equal(retry.recoveryProof, first.recoveryProof)
  })

  await test('an uncommitted retry keeps its identity and bytes but refreshes an expired Desktop proof', () => {
    const intent = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'FRONT', () => 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    const originalBytes = new Uint8Array(bytes)
    intent.commandStream = originalBytes
    intent.recoveryProof = 'old-proof'
    const refreshed = refreshV3ReprintRecoveryProof(intent, 'fresh-proof')
    assert.equal(refreshed, intent)
    assert.equal(refreshed.requestId, 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    assert.equal(refreshed.commandStream, originalBytes)
    assert.equal(refreshed.recoveryProof, 'fresh-proof')
  })

  await test('server persists one schema-3 remote reprint and its operator audit in one transaction', async () => {
    const state = fakeDb()
    const result = await enqueueV3ManualReprintWithDb(
      state.db,
      { tenantId: 'tenant-a', storeId: 'store-a' },
      { kind: 'ACCOUNT', userId: 'user-a', role: 'STAFF' },
      input(),
      new Date('2026-09-24T00:00:00.000Z'),
    )
    assert.equal(result.created, true)
    assert.equal(state.jobs.length, 1)
    assert.equal(state.jobs[0].schemaVersion, 3)
    assert.equal(state.jobs[0].payload.source, 'CLOUD_REMOTE_REPRINT')
    assert.equal(state.jobs[0].payload.role, 'FRONT')
    assert.equal(state.audits.length, 1)
    assert.equal(state.audits[0].actionType, 'V3_PRINT_MANUAL_REPRINT_REQUESTED')
    assert.equal(state.audits[0].requestId, input().requestId)
  })

  await test('CROSSING_UNKNOWN original execution fails closed before creating a reprint', async () => {
    const state = fakeDb({ originalUnknown: true })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER' },
        input(),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_ORIGINAL_UNKNOWN',
    )
    assert.equal(state.jobs.length, 0)
    assert.equal(state.audits.length, 0)
  })

  await test('a non-terminal original execution cannot race an intentional reprint', async () => {
    const state = fakeDb({ originalPending: true })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER' },
        input(),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_RECOVERY_DESKTOP_REQUIRED',
    )
    assert.equal(state.jobs.length, 0)
    assert.equal(state.audits.length, 0)
  })

  await test('operator states require complete terminal evidence and keep cloud reservation ambiguous', () => {
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const base = fakeDb().original()
    assert.equal(classifyV3OperatorPrintJob(base, originalJobId).state, 'PRINTED')
    assert.equal(classifyV3OperatorPrintJob({
      ...base, status: 'FAILED', resultStatus: 'FAILED_NOT_CROSSED', effectBoundary: 'NOT_CROSSED',
      resultCode: 'V3:execution-a:4:1:FAILED_NOT_CROSSED',
    }, originalJobId).state, 'DEFINITELY_NOT_PRINTED')
    const pending = fakeDb({ originalPending: true }).original()
    assert.deepEqual(classifyV3OperatorPrintJob(pending, originalJobId, 'desktop-device-a'), {
      state: 'AMBIGUOUS', originalJobId, localProofEligible: true,
    })
    assert.equal(classifyV3OperatorPrintJob(null, originalJobId).state, 'AMBIGUOUS')
    assert.equal(classifyV3OperatorPrintJob({ ...base, effectBoundary: 'CROSSING_UNKNOWN' }, originalJobId).state, 'AMBIGUOUS')
  })

  await test('authenticated Desktop ledger absence atomically terminalizes original and enqueues exactly one role reprint', async () => {
    const state = fakeDb({ originalPending: true, role: 'KITCHEN' })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'KITCHEN')
    const now = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, {
      orderNo: 'ORDER-REPRINT-1', role: 'KITCHEN', originalJobId, localEvidence: 'LEDGER_ABSENT',
    }, now)
    assert.ok(recoveryProof)
    const request = input({
      role: 'KITCHEN',
      requestId: 'v3-reprint:kitchen:11111111-2222-4333-8444-555555555555',
      recoveryProof: recoveryProof!,
    })
    const result = await enqueueV3ManualReprintWithDb(state.db, {
      tenantId: 'tenant-a', storeId: 'store-a',
    }, {
      kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-a', desktopDeviceId: 'desktop-device-a',
    }, request, now)
    assert.equal(result.created, true)
    assert.equal(state.original().status, 'FAILED')
    assert.equal(state.original().resultStatus, 'FAILED_NOT_CROSSED')
    assert.equal(state.original().effectBoundary, 'NOT_CROSSED')
    assert.equal(state.original().completedAt.toISOString(), now.toISOString())
    assert.equal(state.original().resultCode, `V3_OPERATOR_RECOVERY:${request.requestId}`)
    assert.equal(state.original().claimTokenHash, null)
    assert.equal(state.original().leaseExpiresAt, null)
    assert.equal(state.jobs.length, 1)
    assert.equal(state.jobs[0].payload.role, 'KITCHEN')
    assert.equal(state.audits.filter((row) => row.actionType === 'V3_PRINT_OPERATOR_RECOVERY_COMMITTED').length, 1)
    assert.equal(state.audits.filter((row) => row.actionType === 'V3_PRINT_MANUAL_REPRINT_REQUESTED').length, 1)
  })

  await test('response loss after committed recovery retries the same request without another job or terminalization', async () => {
    const state = fakeDb({ originalPending: true, role: 'KITCHEN' })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'KITCHEN')
    const issuedAt = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'KITCHEN', originalJobId, localEvidence: 'LEDGER_ABSENT' }, issuedAt)
    const request = input({
      role: 'KITCHEN',
      requestId: 'v3-reprint:kitchen:11111111-2222-4333-8444-555555555555',
      recoveryProof: recoveryProof!,
    })
    const actor = { kind: 'DESKTOP_DEVICE' as const, browserPosDeviceId: 'browser-a', desktopDeviceId: 'desktop-device-a' }
    const first = await enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, actor, request, issuedAt)
    const retry = await enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, actor, request,
      new Date(issuedAt.getTime() + 3 * 60 * 1000))
    assert.equal(first.created, true)
    assert.equal(retry.created, false)
    assert.equal(state.jobs.length, 1)
    assert.equal(state.audits.filter((row) => row.actionType === 'V3_PRINT_OPERATOR_RECOVERY_COMMITTED').length, 1)
    assert.equal(state.audits.filter((row) => row.actionType === 'V3_PRINT_MANUAL_REPRINT_REQUESTED').length, 1)
  })

  await test('same request identity with mismatched bytes fails closed after transaction rollback', async () => {
    const state = fakeDb({ originalPending: true, role: 'KITCHEN' })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'KITCHEN')
    const now = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'KITCHEN', originalJobId, localEvidence: 'LEDGER_ABSENT' }, now)
    const request = input({
      role: 'KITCHEN',
      requestId: 'v3-reprint:kitchen:11111111-2222-4333-8444-555555555555',
      recoveryProof: recoveryProof!,
    })
    const actor = { kind: 'DESKTOP_DEVICE' as const, browserPosDeviceId: 'browser-a', desktopDeviceId: 'desktop-device-a' }
    await enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, actor, request, now)
    const differentBytes = Buffer.from([0x1b, 0x40, 0x0a, 0x0a])
    await assert.rejects(enqueueV3ManualReprintWithDb(state.db, {
      tenantId: 'tenant-a', storeId: 'store-a',
    }, actor, {
      ...request,
      commandStream: {
        encoding: 'base64',
        byteLength: differentBytes.byteLength,
        sha256: createHash('sha256').update(differentBytes).digest('hex'),
        data: differentBytes.toString('base64'),
      },
    }, now), (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_IDEMPOTENCY_CONFLICT')
    assert.equal(state.jobs.length, 1)
  })

  await test('different request identities remain distinct after one recovery commits', async () => {
    const state = fakeDb({ originalPending: true, role: 'KITCHEN' })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'KITCHEN')
    const now = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'KITCHEN', originalJobId, localEvidence: 'LEDGER_ABSENT' }, now)
    const actor = { kind: 'DESKTOP_DEVICE' as const, browserPosDeviceId: 'browser-a', desktopDeviceId: 'desktop-device-a' }
    await enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, actor, input({
      role: 'KITCHEN', requestId: 'v3-reprint:kitchen:11111111-2222-4333-8444-555555555555', recoveryProof: recoveryProof!,
    }), now)
    await enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, actor, input({
      role: 'KITCHEN', requestId: 'v3-reprint:kitchen:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    }), now)
    assert.equal(state.jobs.length, 2)
    assert.notEqual(state.jobs[0].idempotencyKey, state.jobs[1].idempotencyKey)
  })

  await test('P2002 on an unrelated constraint is never recovered as idempotent success', async () => {
    const state = fakeDb({ duplicateConstraint: 'UNRELATED' })
    await enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, {
      kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER',
    }, input())
    await assert.rejects(enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, {
      kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER',
    }, input()), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    assert.equal(state.jobs.length, 1)
  })

  await test('cloud reservation without a valid Desktop proof remains ambiguous and creates no reprint', async () => {
    const state = fakeDb({ originalPending: true })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, {
        kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-a', desktopDeviceId: 'desktop-device-a',
      }, input(), new Date('2026-09-24T00:00:30.000Z')),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_RECOVERY_PROOF_INVALID',
    )
    assert.equal(state.original().status, 'PENDING')
    assert.equal(state.jobs.length, 0)
  })

  await test('Browser/account cannot submit a Desktop recovery proof', async () => {
    const state = fakeDb({ originalPending: true })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const now = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'FRONT', originalJobId, localEvidence: 'LEDGER_ABSENT' }, now)
    await assert.rejects(
      enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, {
        kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER',
      }, input({ recoveryProof: recoveryProof! }), now),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_RECOVERY_DESKTOP_REQUIRED',
    )
  })

  await test('mismatched Desktop identity cannot use another device proof', async () => {
    const state = fakeDb({ originalPending: true })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const now = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'FRONT', originalJobId, localEvidence: 'LEDGER_ABSENT' }, now)
    await assert.rejects(
      enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, {
        kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-b', desktopDeviceId: 'desktop-device-b',
      }, input({ recoveryProof: recoveryProof! }), now),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_RECOVERY_PROOF_INVALID',
    )
    assert.equal(state.original().status, 'PENDING')
  })

  await test('Desktop recovery proof is bound to the exact tenant, store, order, role, and claim', async () => {
    const state = fakeDb({ originalPending: true })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const now = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'FRONT', originalJobId, localEvidence: 'LEDGER_ABSENT' }, now)
    assert.ok(recoveryProof)
    const expected = {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
      orderNo: 'ORDER-REPRINT-1', role: 'FRONT' as const, originalJobId,
    }
    assert.ok(verifyV3OperatorRecoveryProof(recoveryProof!, expected, state.original(), now))
    assert.equal(verifyV3OperatorRecoveryProof(recoveryProof!, { ...expected, tenantId: 'tenant-b' }, state.original(), now), null)
    assert.equal(verifyV3OperatorRecoveryProof(recoveryProof!, { ...expected, storeId: 'store-b' }, state.original(), now), null)
    assert.equal(verifyV3OperatorRecoveryProof(recoveryProof!, { ...expected, orderNo: 'ORDER-REPRINT-2' }, state.original(), now), null)
    assert.equal(verifyV3OperatorRecoveryProof(recoveryProof!, { ...expected, role: 'KITCHEN' }, state.original(), now), null)
    assert.equal(verifyV3OperatorRecoveryProof(recoveryProof!, expected, {
      ...state.original(), claimAttempt: state.original().claimAttempt + 1,
    }, now), null)
  })

  await test('tampered or expired Desktop proof fails closed', async () => {
    const state = fakeDb({ originalPending: true })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const issuedAt = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'FRONT', originalJobId, localEvidence: 'LEDGER_ABSENT' }, issuedAt)
    const actor = { kind: 'DESKTOP_DEVICE' as const, browserPosDeviceId: 'browser-a', desktopDeviceId: 'desktop-device-a' }
    const tampered = `${recoveryProof!.slice(0, -1)}${recoveryProof!.endsWith('a') ? 'b' : 'a'}`
    for (const [proof, now] of [
      [tampered, issuedAt],
      [recoveryProof!, new Date(issuedAt.getTime() + 3 * 60 * 1000)],
    ] as const) {
      await assert.rejects(
        enqueueV3ManualReprintWithDb(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, actor,
          input({ recoveryProof: proof }), now),
        (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_RECOVERY_PROOF_INVALID',
      )
    }
    assert.equal(state.original().status, 'PENDING')
    assert.equal(state.jobs.length, 0)
  })

  await test('transaction failure rolls back original terminalization and creates no reprint or audit', async () => {
    const state = fakeDb({ originalPending: true, enqueueFailure: true })
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const now = new Date('2026-09-24T00:00:30.000Z')
    const recoveryProof = await issueV3OperatorRecoveryProofWithDb(state.tx as any, {
      tenantId: 'tenant-a', storeId: 'store-a', desktopDeviceId: 'desktop-device-a',
    }, { orderNo: 'ORDER-REPRINT-1', role: 'FRONT', originalJobId, localEvidence: 'LEDGER_ABSENT' }, now)
    await assert.rejects(enqueueV3ManualReprintWithDb(state.db, {
      tenantId: 'tenant-a', storeId: 'store-a',
    }, {
      kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-a', desktopDeviceId: 'desktop-device-a',
    }, input({ recoveryProof: recoveryProof! }), now), /simulated enqueue failure/)
    assert.equal(state.original().status, 'PENDING')
    assert.notEqual(state.original().claimTokenHash, null)
    assert.equal(state.jobs.length, 0)
    assert.equal(state.audits.length, 0)
  })

  await test('reprint submission is rejected outside V3_ACTIVE without falling back to V2', async () => {
    const state = fakeDb({ mode: 'V2_ACTIVE' })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-a', computerBindingId: 'binding-a' },
        input(),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_MODE_NOT_ACTIVE',
    )
    assert.equal(state.jobs.length, 0)
  })

  await test('KITCHEN reprint requires the store kitchen-ticket contract', async () => {
    const state = fakeDb({ kitchenEnabled: false })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER' },
        input({
          role: 'KITCHEN',
          requestId: 'v3-reprint:kitchen:11111111-2222-4333-8444-555555555555',
        }),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_KITCHEN_DISABLED',
    )
  })

  await test('account route derives tenant/store/user from the authenticated account session', async () => {
    let observed: unknown
    const response = await handleAccountV3ReprintRequest(request('/api/es-tray-02/v3-reprints', 'POST', input()), dependencies({
      enqueue: async (scope, actor, value) => {
        observed = { scope, actor }
        return { created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role }
      },
    }))
    assert.equal(response.status, 202)
    assert.deepEqual(observed, {
      scope: { tenantId: 'tenant-a', storeId: 'store-a' },
      actor: { kind: 'ACCOUNT', userId: 'user-a', role: 'STAFF' },
    })
  })

  await test('account route rejects an opaque Desktop proof before enqueue', async () => {
    let called = false
    const response = await handleAccountV3ReprintRequest(request('/api/es-tray-02/v3-reprints', 'POST', input({
      recoveryProof: `v3orp1.${Buffer.from('{}').toString('base64url')}.${'a'.repeat(64)}`,
    })), dependencies({
      enqueue: async (_scope, _actor, value) => {
        called = true
        return { created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role }
      },
    }))
    assert.equal(response.status, 409)
    assert.equal(called, false)
  })

  await test('device route derives scope and audit actor from the delegated device principal', async () => {
    let observed: unknown
    const response = await handleDeviceV3ReprintRequest(request('/api/es-tray-02/device/v3-reprints', 'POST', input()), dependencies({
      enqueue: async (scope, actor, value) => {
        observed = { scope, actor }
        return { created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role }
      },
    }))
    assert.equal(response.status, 202)
    assert.deepEqual(observed, {
      scope: { tenantId: 'tenant-a', storeId: 'store-a' },
      actor: { kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-a', computerBindingId: 'binding-a' },
    })
  })

  await test('Desktop-issued device recovery derives its audit actor from the verified DesktopDevice', async () => {
    let observed: unknown
    const response = await handleDeviceV3ReprintRequest(request('/api/es-tray-02/device/v3-reprints', 'POST', input()), dependencies({
      deviceContext: async () => ({
        ok: true,
        context: {
          principal: 'DESKTOP_POS_DEVICE', browserPosDeviceId: 'browser-desktop-a', desktopDeviceId: 'desktop-device-a',
          tenantId: 'tenant-a', storeId: 'store-a', storeCode: 'STORE-A', enabled: true, unavailableReason: null,
        },
      }),
      enqueue: async (scope, actor, value) => {
        observed = { scope, actor }
        return { created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role }
      },
    }))
    assert.equal(response.status, 202)
    assert.deepEqual(observed, {
      scope: { tenantId: 'tenant-a', storeId: 'store-a' },
      actor: { kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-desktop-a', desktopDeviceId: 'desktop-device-a' },
    })
  })

  await test('device status GET binds local-proof eligibility to the authenticated DesktopDevice', async () => {
    let observed: unknown
    const response = await handleDeviceV3ReprintRequest(
      request('/api/es-tray-02/device/v3-reprints?orderNo=ORDER-REPRINT-1', 'GET'),
      dependencies({
        deviceContext: async () => ({
          ok: true,
          context: {
            principal: 'DESKTOP_POS_DEVICE', browserPosDeviceId: 'browser-desktop-a', desktopDeviceId: 'desktop-device-a',
            tenantId: 'tenant-a', storeId: 'store-a', storeCode: 'STORE-A', enabled: true, unavailableReason: null,
          },
        }),
        availability: async (scope, value) => {
          observed = { scope, value }
          return { enabled: true, kitchenEnabled: true, legacyAllowed: false }
        },
      }),
    )
    assert.equal(response.status, 200)
    assert.deepEqual(observed, {
      scope: { tenantId: 'tenant-a', storeId: 'store-a' },
      value: { orderNo: 'ORDER-REPRINT-1', desktopDeviceId: 'desktop-device-a' },
    })
  })

  await test('Desktop records route is device-authenticated only with an explicit desktop store context', () => {
    const previous = (globalThis as any).window
    try {
      ;(globalThis as any).window = { location: { pathname: '/records', search: '?from=desktop&storeCode=STORE-A' } }
      assert.equal(isDesktopPosDeviceRuntime(), true)
      ;(globalThis as any).window = { location: { pathname: '/records', search: '' } }
      assert.equal(isDesktopPosDeviceRuntime(), false)
      ;(globalThis as any).window = { location: { pathname: '/desktop/pos', search: '?storeCode=STORE-A' } }
      assert.equal(isDesktopPosDeviceRuntime(), true)
    } finally {
      if (previous === undefined) delete (globalThis as any).window
      else (globalThis as any).window = previous
    }
  })

  await test('an unavailable V3 mode check stays unknown and cannot fail open to legacy print', async () => {
    assert.equal(await readAccountV3ReprintAvailability(async () => new Response(null, { status: 503 })), null)
    assert.equal(await readAccountV3ReprintAvailability(async () => {
      throw new Error('network unavailable')
    }), null)
    assert.equal(await readAccountV3ReprintAvailability(async () => new Response(JSON.stringify({
      enabled: false, kitchenEnabled: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })), null)
  })

  await test('only authoritative V2_ACTIVE permits the legacy print path', async () => {
    async function availability(mode: string | null, tenantId = 'tenant-a') {
      return readV3ReprintAvailabilityWithDb({
        store: { findFirst: async () => ({ printKitchenTicket: true }) },
        v3PrintControlPlane: { findUnique: async () => mode === null ? null : { tenantId, mode } },
      } as any, { tenantId: 'tenant-a', storeId: 'store-a' })
    }
    assert.deepEqual(await availability('V2_ACTIVE'), {
      enabled: false, kitchenEnabled: false, legacyAllowed: true,
    })
    assert.deepEqual(await availability('V3_ACTIVE'), {
      enabled: true, kitchenEnabled: true, legacyAllowed: false,
    })
    for (const mode of ['BLOCKED_UNKNOWN', 'V2_DRAINING', 'V3_DRAINING']) {
      assert.deepEqual(await availability(mode), {
        enabled: false, kitchenEnabled: false, legacyAllowed: false,
      })
    }
    assert.deepEqual(await availability(null), {
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    })
    assert.deepEqual(await availability('V2_ACTIVE', 'another-tenant'), {
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    })
  })

  await test('availability maps independent FRONT and KITCHEN states without exposing claim internals', async () => {
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const front = fakeDb().original()
    const result = await readV3ReprintAvailabilityWithDb({
      store: { findFirst: async () => ({ printKitchenTicket: false }) },
      v3PrintControlPlane: { findUnique: async () => ({ tenantId: 'tenant-a', mode: 'V3_ACTIVE' }) },
      eshopTrayPrintJob: { findMany: async () => [front] },
    } as any, { tenantId: 'tenant-a', storeId: 'store-a' }, {
      orderNo: 'ORDER-REPRINT-1', desktopDeviceId: 'desktop-device-a',
    })
    assert.deepEqual(result.roles, {
      FRONT: { state: 'PRINTED', originalJobId, localProofEligible: false },
      KITCHEN: null,
    })
    assert.equal(JSON.stringify(result).includes('claimToken'), false)
    assert.equal(JSON.stringify(result).includes('ledger'), false)
  })

  await test('role status includes reprint outcomes so pending recovery cannot offer another effect', async () => {
    const originalJobId = canonicalV3OriginalPrintJobId('ORDER-REPRINT-1', 'FRONT')
    const printed = fakeDb().original()
    const failedOriginal = {
      ...printed,
      status: 'FAILED',
      resultStatus: 'FAILED_NOT_CROSSED',
      resultCode: 'V3:original:4:1:FAILED_NOT_CROSSED',
      effectBoundary: 'NOT_CROSSED',
    }
    function reprint(state: 'PENDING' | 'CROSSED' | 'FAILED_NOT_CROSSED') {
      const terminal = state !== 'PENDING'
      return {
        ...printed,
        id: `reprint-${state}`,
        idempotencyKey: 'v3-reprint:front:11111111-2222-4333-8444-555555555555',
        payload: {
          schemaVersion: 3,
          printJobId: 'v3-reprint:front:11111111-2222-4333-8444-555555555555',
          source: 'CLOUD_REMOTE_REPRINT',
          role: 'FRONT',
          payloadKind: 'RAW_BYTES',
          orderNo: 'ORDER-REPRINT-1',
        },
        status: state === 'CROSSED' ? 'SUCCEEDED' : state === 'FAILED_NOT_CROSSED' ? 'FAILED' : 'PENDING',
        completedAt: terminal ? new Date('2026-09-24T00:01:00.000Z') : null,
        resultStatus: terminal ? state : null,
        resultCode: terminal ? `V3:reprint:4:1:${state}` : null,
        effectBoundary: state === 'CROSSED' ? 'CROSSED' : state === 'FAILED_NOT_CROSSED' ? 'NOT_CROSSED' : null,
      }
    }
    async function stateFor(rows: any[]) {
      const result = await readV3ReprintAvailabilityWithDb({
        store: { findFirst: async () => ({ printKitchenTicket: false }) },
        v3PrintControlPlane: { findUnique: async () => ({ tenantId: 'tenant-a', mode: 'V3_ACTIVE' }) },
        eshopTrayPrintJob: { findMany: async () => rows },
      } as any, { tenantId: 'tenant-a', storeId: 'store-a' }, { orderNo: 'ORDER-REPRINT-1' })
      assert.equal(result.roles?.FRONT.originalJobId, originalJobId)
      return result.roles?.FRONT.state
    }
    assert.equal(await stateFor([failedOriginal, reprint('PENDING')]), 'AMBIGUOUS')
    assert.equal(await stateFor([failedOriginal, reprint('CROSSED')]), 'PRINTED')
    assert.equal(await stateFor([failedOriginal, reprint('FAILED_NOT_CROSSED')]), 'DEFINITELY_NOT_PRINTED')
    assert.equal(await stateFor([printed, reprint('PENDING')]), 'PRINTED')
  })

  await test('the client exposes legacy printing only from an explicit authoritative V2 response', async () => {
    assert.deepEqual(await readAccountV3ReprintAvailability(async () => new Response(JSON.stringify({
      enabled: false, kitchenEnabled: false, legacyAllowed: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })), {
      enabled: false, kitchenEnabled: false, legacyAllowed: true,
    })
    assert.deepEqual(await readAccountV3ReprintAvailability(async () => new Response(JSON.stringify({
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })), {
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    })
  })

  await test('record detail refreshes authoritative mode at action time before any legacy browser reprint', () => {
    const detail = readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
    const printStart = detail.indexOf('async function handlePrint()')
    const actionStart = detail.indexOf('async function handleReprintAction()')
    const v3Start = detail.indexOf('async function handleV3Reprint()')
    assert.ok(printStart >= 0 && actionStart > printStart && v3Start > actionStart)
    const print = detail.slice(printStart, actionStart)
    const action = detail.slice(actionStart, v3Start)
    assert.match(print, /const availability = await readCurrentV3ReprintAvailability\(\)/)
    assert.match(print, /if \(!availability\?\.legacyAllowed\)[\s\S]*return/)
    assert.match(action, /const availability = await readCurrentV3ReprintAvailability\(\)/)
    assert.match(action, /availability\?\.enabled[\s\S]*availability\?\.legacyAllowed[\s\S]*void handlePrint\(\)/)
    assert.doesNotMatch(action, /v3Reprint\?\.legacyAllowed/)
  })

  await test('Order Detail exposes simple role states and blocks ambiguous/BOTH recovery choices', () => {
    const detail = readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
    assert.match(detail, />打印状态</)
    assert.match(detail, /label: '已打印'/)
    assert.match(detail, /label: '未打印'/)
    assert.match(detail, /label: '状态待确认'/)
    assert.match(detail, /请先确认打印机是否已经出票/)
    assert.match(detail, /status\.state === 'DEFINITELY_NOT_PRINTED'/)
    assert.match(detail, /operatorRecoveryRole \? \[operatorRecoveryRole\] : reprintRoleChoices/)
    assert.match(detail, /state !== 'AMBIGUOUS'/)
    assert.match(detail, /availability\.roles\[operatorRecoveryRole\]\?\.state !== 'DEFINITELY_NOT_PRINTED'/)
    assert.match(detail, /await readCurrentV3ReprintAvailability\(\)\s*setReprintChoice\(null\)/)
    assert.match(detail, /if \(!d \|\| !reprintChoice \|\| printInFlightRef\.current\) return/)
    assert.doesNotMatch(detail, />authority<|>lease<|>batch<|>claim token<|>effect boundary</i)
  })

  await test('Cashier auto-admission is independent of preview and cannot be discarded before acceptance', () => {
    const cashier = readFileSync('app/cashier/page.tsx', 'utf8')
    assert.equal((cashier.match(/v3Admission: \{ status: 'PENDING', acceptedRoles: \[\], unresolvedRoles: v3Roles \}/g) ?? []).length, 1)
    assert.match(cashier, /submitV3LocalTickets\(current\.receipt, current\.kitchenTicket, attemptedRoles\)/)
    assert.match(cashier, /status === 'V2_FALLBACK_REQUIRED' && result\.reason == null && acceptedRoles\.length === 0/)
    assert.match(cashier, /saleResult\?\.v3Admission\?\.status === 'PENDING' \|\| saleResult\?\.v3Admission\?\.status === 'REJECTED'/)
    assert.match(cashier, /status: unresolvedRoles\.length === 0 \? 'ACCEPTED' : 'REJECTED'/)
    assert.match(cashier, /const baseSaleResult: SaleResult = \{[\s\S]*paymentMethod: 'MEMBER_BALANCE'/)
    assert.match(cashier, /if \(admission\.route === 'V2_LEGACY'\) \{\s*setSaleResult\(baseSaleResult\)\s*return/)
    assert.match(cashier, /admission\?\.status === 'ACCEPTED'[\s\S]*setSelectedDesktopRecordOrderNo\(orderNo\)/)
    assert.match(cashier, /saleResult\?\.v3Admission && saleResult\.v3Admission\.status !== 'V2_LEGACY'/)
    const admissionStart = cashier.indexOf('const current = saleResult')
    const admissionEnd = cashier.indexOf('useEffect(() => {', admissionStart + 1)
    assert.ok(admissionStart > 0 && admissionEnd > admissionStart)
    assert.doesNotMatch(cashier.slice(admissionStart, admissionEnd), /setTimeout|Date\.now/)
  })

  await test('Records preserves canonical order identity and delegates recovery without direct printing', () => {
    const records = readFileSync('app/records/page.tsx', 'utf8')
    assert.match(records, /canonicalOrderNo: item\.orderNo/)
    assert.match(records, /if \(!entry\.canonicalOrderNo\)[\s\S]*无法查看详情或补打/)
    assert.match(records, /setSelectedOrderNo\(entry\.canonicalOrderNo\)/)
    assert.doesNotMatch(records, /item\.orderNo \?\? item\.recordNo[\s\S]{0,400}setSelectedOrderNo\(entry\.orderNo\)/)
    assert.doesNotMatch(records, /printDesktopReceipt|DesktopReceiptPreview|handleSaleRecordReprint/)
  })

  await test('protected Cashier and Records blobs match the exact active authorization', () => {
    assert.equal(
      createHash('sha256').update(readFileSync('app/cashier/page.tsx')).digest('hex'),
      '6a03169bfbf5ab14d7f6f516211a06beaea00aeb5ca92e313373243e60d25718',
    )
    assert.equal(
      createHash('sha256').update(readFileSync('app/records/page.tsx')).digest('hex'),
      '48efc97f9b77dd63bed22fb0e3b69e44bf13ababbad3a8956cf39a6426912a22',
    )
  })

  await test('device client sends a V3-only role-specific contract and validates the durable response', async () => {
    let body: any
    const intent = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'FRONT', () => 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    intent.commandStream = new Uint8Array(bytes)
    const result = await submitDeviceV3Reprint({
      intent,
      fetchImpl: async (_path, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          schemaVersion: 3, source: 'CLOUD_REMOTE_REPRINT', status: 'PENDING_RECEIVE', audited: true,
          created: true, jobId: 'job-a', requestId: intent.requestId, orderNo: intent.orderNo, role: intent.role,
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      },
    })
    assert.equal(result.requestId, intent.requestId)
    assert.deepEqual(Object.keys(body).sort(), [
      'commandStream', 'confirmation', 'orderNo', 'rendererVersion', 'requestId', 'role', 'schemaVersion',
    ])
    assert.equal(body.source, undefined)
    assert.equal(body.tenantId, undefined)
    assert.equal(body.storeId, undefined)
  })

  await test('device recovery carries only the opaque proof on the existing V3 reprint contract', async () => {
    let body: any
    const intent = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'KITCHEN', () => 'v3-reprint:kitchen:11111111-2222-4333-8444-555555555555')
    intent.commandStream = new Uint8Array(bytes)
    intent.recoveryProof = `v3orp1.${Buffer.from('{}').toString('base64url')}.${'a'.repeat(64)}`
    await submitDeviceV3Reprint({
      intent,
      fetchImpl: async (_path, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          schemaVersion: 3, source: 'CLOUD_REMOTE_REPRINT', status: 'PENDING_RECEIVE', audited: true,
          created: true, jobId: 'job-kitchen', requestId: intent.requestId, orderNo: intent.orderNo, role: intent.role,
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      },
    })
    assert.equal(body.recoveryProof, intent.recoveryProof)
    assert.equal(body.localLedger, undefined)
    assert.equal(body.transportStarted, undefined)
  })

  console.log(`PASS v3 reprint recovery ${cases}/${cases}`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
