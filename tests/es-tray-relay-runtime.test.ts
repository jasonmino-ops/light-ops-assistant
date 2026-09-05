import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import pg from 'pg'
import { prisma } from '../lib/prisma'
import {
  hashClaimSecret,
  hashDeviceSecret,
  hashInstallationId,
} from '../lib/computer-client/crypto'
import { authenticateRelayAgent } from '../lib/es-tray-relay/auth'
import type { RelayTimingConfig } from '../lib/es-tray-relay/config'
import {
  type EshopTrayPrintRequest,
  parsePrintRequest,
} from '../lib/es-tray-relay/contract'
import {
  claimNextRelayPrintJob,
  completeRelayPrintJob,
  enqueueRelayPrintJob,
  markRelayPrintJobExecuting,
  RelayServiceError,
} from '../lib/es-tray-relay/service'

if (process.env.ES_TRAY_RELAY_TEST_DATABASE !== '1') {
  throw new Error('ES_TRAY_RELAY_TEST_DATABASE=1 is required')
}
if (!process.env.DATABASE_URL || !process.env.COMPUTER_CLIENT_TOKEN_SECRET) {
  throw new Error('DATABASE_URL and COMPUTER_CLIENT_TOKEN_SECRET are required')
}

const timing: RelayTimingConfig = {
  claimLeaseMs: 30_000,
  executionTimeoutMs: 60_000,
  jobTtlMs: 86_400_000,
  maxAttempts: 3,
}

let assertions = 0
async function test(name: string, run: () => Promise<void>) {
  await run()
  assertions += 1
  console.log(`PASS ${name}`)
}

function request(id = `request-${randomUUID()}`, bytes = Buffer.from([0x1b, 0x40])): EshopTrayPrintRequest {
  return parsePrintRequest({
    relayVersion: '0.1',
    requestId: id,
    orderNo: `ORDER-${randomUUID()}`,
    documentName: 'E-Shop relay test',
    target: { transport: 'windows-queue', queueName: '前台' },
    commandStream: {
      encoding: 'base64',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data: bytes.toString('base64'),
    },
  })
}

async function seedScope(label: string) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: { name: `${label}-${suffix}`, status: 'ACTIVE', tier: 'STANDARD' },
  })
  const store = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      code: `${label}-${suffix}`.slice(0, 80),
      name: `${label} store`,
      status: 'ACTIVE',
    },
  })
  const installationId = `installation_${randomUUID().replaceAll('-', '_')}`
  const deviceSecret = `ecc_v1_${'d'.repeat(32)}${randomUUID().replaceAll('-', '')}`
  const claimSecret = `ecr_v1_${'c'.repeat(32)}${randomUUID().replaceAll('-', '')}`
  const binding = await prisma.computerBinding.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      installationIdHash: hashInstallationId(installationId),
      computerName: `${label}-computer`,
      agentVersion: '0.1.3',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + 86_400_000),
      claimSecretHash: hashClaimSecret(claimSecret),
      deviceSecretHash: hashDeviceSecret(deviceSecret),
      credentialStatus: 'ACTIVE',
      credentialActivatedAt: new Date(),
      credentialExpiresAt: new Date(Date.now() + 86_400_000),
      boundAt: new Date(),
    },
  })
  return {
    tenant,
    store,
    binding,
    installationId,
    deviceSecret,
    scope: { tenantId: tenant.id, storeId: store.id },
    agent: { tenantId: tenant.id, storeId: store.id, computerBindingId: binding.id },
  }
}

function authRequest(installationId: string, deviceSecret: string) {
  return new NextRequest('http://localhost/api/es-tray-02/print-jobs/receive', {
    method: 'POST',
    headers: {
      'x-installation-id': installationId,
      'x-es-tray-version': '0.1.3',
      authorization: `Bearer ${deviceSecret}`,
    },
  })
}

async function expectServiceError(code: string, run: () => Promise<unknown>) {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof RelayServiceError)
    assert.equal(error.code, code)
    return true
  })
}

async function main() {
  const a = await seedScope('relay-a')
  const b = await seedScope('relay-b')
  const secondStore = await prisma.store.create({
    data: {
      tenantId: a.tenant.id,
      code: `relay-second-${randomUUID().slice(0, 8)}`,
      name: 'second store',
      status: 'ACTIVE',
    },
  })

  await test('enqueue idempotency returns the original job', async () => {
    const body = request('idempotent-request-0001')
    const first = await enqueueRelayPrintJob(a.scope, body, timing)
    const replay = await enqueueRelayPrintJob(a.scope, body, timing)
    assert.equal(first.created, true)
    assert.equal(replay.created, false)
    assert.equal(replay.job.id, first.job.id)
  })

  await test('concurrent duplicate enqueue creates one row', async () => {
    const body = request('concurrent-request-0001')
    const results = await Promise.all([
      enqueueRelayPrintJob(a.scope, body, timing),
      enqueueRelayPrintJob(a.scope, body, timing),
    ])
    assert.equal(results.filter((entry) => entry.created).length, 1)
    assert.equal(new Set(results.map((entry) => entry.job.id)).size, 1)
  })

  await test('same key with a different payload conflicts', async () => {
    const key = 'conflicting-request-0001'
    await enqueueRelayPrintJob(a.scope, request(key, Buffer.from('one')), timing)
    await expectServiceError('ES_TRAY_02_IDEMPOTENCY_CONFLICT', () =>
      enqueueRelayPrintJob(a.scope, request(key, Buffer.from('two')), timing))
  })

  await test('tenant and store scopes have independent idempotency domains', async () => {
    const key = 'scoped-request-0001'
    const body = request(key)
    const tenantJob = await enqueueRelayPrintJob(b.scope, body, timing)
    const storeJob = await enqueueRelayPrintJob({ tenantId: a.tenant.id, storeId: secondStore.id }, body, timing)
    assert.equal(tenantJob.created, true)
    assert.equal(storeJob.created, true)
    assert.notEqual(tenantJob.job.id, storeJob.job.id)
  })

  await test('invalid installation id and invalid device secret are rejected', async () => {
    const badInstallation = await authenticateRelayAgent(authRequest('missing-installation-0001', a.deviceSecret))
    const badSecret = await authenticateRelayAgent(authRequest(a.installationId, `ecc_v1_${'x'.repeat(64)}`))
    assert.deepEqual(badInstallation, { ok: false, status: 401, error: 'AGENT_AUTH_REQUIRED' })
    assert.deepEqual(badSecret, { ok: false, status: 401, error: 'AGENT_AUTH_REQUIRED' })
  })

  await test('disabled and revoked credentials are rejected', async () => {
    await prisma.computerBinding.update({ where: { id: b.binding.id }, data: { disabledAt: new Date() } })
    const disabled = await authenticateRelayAgent(authRequest(b.installationId, b.deviceSecret))
    assert.deepEqual(disabled, { ok: false, status: 403, error: 'COMPUTER_DISABLED' })
    await prisma.computerBinding.update({
      where: { id: b.binding.id },
      data: { disabledAt: null, credentialStatus: 'VOID' },
    })
    const revoked = await authenticateRelayAgent(authRequest(b.installationId, b.deviceSecret))
    assert.deepEqual(revoked, { ok: false, status: 403, error: 'CREDENTIAL_NOT_ACTIVE' })
  })

  await test('Tray 0.1.2 cannot claim a production job', async () => {
    const legacy = authRequest(a.installationId, a.deviceSecret)
    legacy.headers.set('x-es-tray-version', '0.1.2')
    const result = await authenticateRelayAgent(legacy)
    assert.deepEqual(result, { ok: false, status: 426, error: 'ES_TRAY_02_CLIENT_UPGRADE_REQUIRED' })
  })

  await test('atomic concurrent claim returns a job once', async () => {
    const scope = await seedScope('relay-atomic')
    await enqueueRelayPrintJob(scope.scope, request('atomic-claim-request-0001'), timing)
    const claims = await Promise.all([
      claimNextRelayPrintJob(scope.agent, timing),
      claimNextRelayPrintJob(scope.agent, timing),
    ])
    assert.equal(claims.filter(Boolean).length, 1)
  })

  await test('claim transaction loses to a concurrent binding disable', async () => {
    const scoped = await seedScope('relay-disable-race')
    await enqueueRelayPrintJob(scoped.scope, request('disable-race-request-0001'), timing)
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE "ComputerBinding" SET "disabledAt" = NOW() WHERE "id" = $1', [scoped.binding.id])
      let settled = false
      const claim = claimNextRelayPrintJob(scoped.agent, timing).finally(() => { settled = true })
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(settled, false, 'claim must wait for the authorization row lock')
      await client.query('COMMIT')
      await expectServiceError('COMPUTER_BINDING_NOT_ACTIVE', () => claim)
      const row = await prisma.eshopTrayPrintJob.findFirstOrThrow({ where: scoped.scope })
      assert.equal(row.status, 'PENDING')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    }
  })

  await test('claim transaction loses to a concurrent credential revoke', async () => {
    const scoped = await seedScope('relay-revoke-race')
    await enqueueRelayPrintJob(scoped.scope, request('revoke-race-request-0001'), timing)
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE "ComputerBinding" SET "credentialStatus" = \'VOID\' WHERE "id" = $1', [scoped.binding.id])
      let settled = false
      const claim = claimNextRelayPrintJob(scoped.agent, timing).finally(() => { settled = true })
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(settled, false, 'claim must wait for the credential row lock')
      await client.query('COMMIT')
      await expectServiceError('COMPUTER_BINDING_NOT_ACTIVE', () => claim)
      const row = await prisma.eshopTrayPrintJob.findFirstOrThrow({ where: scoped.scope })
      assert.equal(row.status, 'PENDING')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    }
  })

  await test('claim transaction loses to a concurrent store deactivation', async () => {
    const scoped = await seedScope('relay-store-race')
    await enqueueRelayPrintJob(scoped.scope, request('store-race-request-0001'), timing)
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE "Store" SET "status" = \'DISABLED\' WHERE "id" = $1', [scoped.store.id])
      let settled = false
      const claim = claimNextRelayPrintJob(scoped.agent, timing).finally(() => { settled = true })
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(settled, false, 'claim must wait for the store authorization row lock')
      await client.query('COMMIT')
      await expectServiceError('COMPUTER_BINDING_NOT_ACTIVE', () => claim)
      const row = await prisma.eshopTrayPrintJob.findFirstOrThrow({ where: scoped.scope })
      assert.equal(row.status, 'PENDING')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    }
  })

  await test('claim cannot cross a tenant or store boundary', async () => {
    const scoped = await seedScope('relay-scope')
    const unrelated = await seedScope('relay-empty-scope')
    await enqueueRelayPrintJob(scoped.scope, request('isolated-claim-request-0001'), timing)
    assert.equal(await claimNextRelayPrintJob(unrelated.agent, timing), null)
    const claim = await claimNextRelayPrintJob(scoped.agent, timing)
    assert.ok(claim)
  })

  await test('lease expiry before EXECUTING permits a new attempt only', async () => {
    const scoped = await seedScope('relay-lease')
    const start = new Date('2026-09-05T00:00:00.000Z')
    await enqueueRelayPrintJob(scoped.scope, request('lease-retry-request-0001'), timing, start)
    const first = await claimNextRelayPrintJob(scoped.agent, timing, start)
    assert.ok(first)
    const second = await claimNextRelayPrintJob(scoped.agent, timing, new Date(start.getTime() + 30_001))
    assert.ok(second)
    assert.equal(second.claimAttempt, 2)
    assert.notEqual(second.claimToken, first.claimToken)
    await expectServiceError('ES_TRAY_02_STALE_CLAIM', () => markRelayPrintJobExecuting(
      scoped.agent,
      first.id,
      { schemaVersion: 1, claimAttempt: first.claimAttempt, claimToken: first.claimToken },
      timing,
      new Date(start.getTime() + 30_002),
    ))
  })

  await test('EXECUTING and terminal result transitions are idempotent', async () => {
    const scoped = await seedScope('relay-ack')
    const start = new Date('2026-09-05T01:00:00.000Z')
    await enqueueRelayPrintJob(scoped.scope, request('ack-result-request-0001'), timing, start)
    const claim = await claimNextRelayPrintJob(scoped.agent, timing, start)
    assert.ok(claim)
    const proof = { schemaVersion: 1 as const, claimAttempt: claim.claimAttempt, claimToken: claim.claimToken }
    const firstExecuting = await markRelayPrintJobExecuting(scoped.agent, claim.id, proof, timing, start)
    const replayExecuting = await markRelayPrintJobExecuting(scoped.agent, claim.id, proof, timing, start)
    assert.equal(firstExecuting.idempotent, false)
    assert.equal(replayExecuting.idempotent, true)
    const terminal = {
      ...proof,
      state: 'SUCCEEDED' as const,
      resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
      effectBoundary: 'CROSSED' as const,
      physicalCompletionKnown: false as const,
    }
    const firstResult = await completeRelayPrintJob(scoped.agent, claim.id, terminal, start)
    const replayResult = await completeRelayPrintJob(scoped.agent, claim.id, terminal, start)
    assert.equal(firstResult.idempotent, false)
    assert.equal(replayResult.idempotent, true)
    assert.equal(firstResult.job.result?.physicalCompletionKnown, false)
  })

  await test('an old attempt token cannot acknowledge a newer claim', async () => {
    const scoped = await seedScope('relay-stale')
    const start = new Date('2026-09-05T02:00:00.000Z')
    await enqueueRelayPrintJob(scoped.scope, request('stale-result-request-0001'), timing, start)
    const first = await claimNextRelayPrintJob(scoped.agent, timing, start)
    assert.ok(first)
    const second = await claimNextRelayPrintJob(scoped.agent, timing, new Date(start.getTime() + 30_001))
    assert.ok(second)
    await expectServiceError('ES_TRAY_02_STALE_CLAIM', () => completeRelayPrintJob(scoped.agent, second.id, {
      schemaVersion: 1,
      claimAttempt: first.claimAttempt,
      claimToken: first.claimToken,
      state: 'FAILED',
      resultCode: 'STALE_ATTEMPT',
      effectBoundary: 'NOT_CROSSED',
      physicalCompletionKnown: false,
    }))
  })

  await test('execution timeout becomes terminal CROSSING_UNKNOWN without reprint', async () => {
    const scoped = await seedScope('relay-unknown')
    const start = new Date('2026-09-05T03:00:00.000Z')
    await enqueueRelayPrintJob(scoped.scope, request('unknown-effect-request-0001'), timing, start)
    const claim = await claimNextRelayPrintJob(scoped.agent, timing, start)
    assert.ok(claim)
    await markRelayPrintJobExecuting(scoped.agent, claim.id, {
      schemaVersion: 1,
      claimAttempt: claim.claimAttempt,
      claimToken: claim.claimToken,
    }, timing, start)
    assert.equal(await claimNextRelayPrintJob(scoped.agent, timing, new Date(start.getTime() + 60_001)), null)
    const row = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: claim.id } })
    assert.equal(row.status, 'FAILED')
    assert.equal(row.effectBoundary, 'CROSSING_UNKNOWN')
  })

  await test('maxAttempts terminates safe pre-execution retries', async () => {
    const scoped = await seedScope('relay-attempts')
    const start = new Date('2026-09-05T04:00:00.000Z')
    const oneAttempt = { ...timing, maxAttempts: 1 }
    const created = await enqueueRelayPrintJob(scoped.scope, request('max-attempt-request-0001'), oneAttempt, start)
    assert.ok(await claimNextRelayPrintJob(scoped.agent, oneAttempt, start))
    assert.equal(await claimNextRelayPrintJob(scoped.agent, oneAttempt, new Date(start.getTime() + 30_001)), null)
    const row = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: created.job.id } })
    assert.equal(row.status, 'FAILED')
    assert.equal(row.resultCode, 'MAX_CLAIM_ATTEMPTS_EXCEEDED')
  })

  await test('TTL expiration is terminal and never claimable', async () => {
    const scoped = await seedScope('relay-expiry')
    const start = new Date('2026-09-05T05:00:00.000Z')
    const shortTtl = { ...timing, jobTtlMs: 60_000 }
    const created = await enqueueRelayPrintJob(scoped.scope, request('ttl-expiry-request-0001'), shortTtl, start)
    assert.equal(await claimNextRelayPrintJob(scoped.agent, shortTtl, new Date(start.getTime() + 60_001)), null)
    const row = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: created.job.id } })
    assert.equal(row.status, 'EXPIRED')
    assert.equal(row.effectBoundary, 'NOT_CROSSED')
  })

  await test('database constraint rejects a cross-scope claim owner', async () => {
    const scoped = await seedScope('relay-fk')
    const created = await enqueueRelayPrintJob(scoped.scope, request('cross-binding-request-0001'), timing)
    await assert.rejects(() => prisma.$executeRawUnsafe(
      'UPDATE "EshopTrayPrintJob" SET "claimedByComputerBindingId" = $1, "status" = \'CLAIMED\', "claimTokenHash" = $2, "claimAttempt" = 1, "leaseExpiresAt" = NOW() + INTERVAL \'30 seconds\' WHERE "id" = $3',
      a.binding.id,
      'a'.repeat(64),
      created.job.id,
    ))
  })

  console.log(`es-tray relay runtime database tests passed (${assertions} cases)`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
