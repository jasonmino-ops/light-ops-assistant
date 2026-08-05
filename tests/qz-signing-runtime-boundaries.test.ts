import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { NextRequest } from 'next/server'
import {
  QZ_SIGN_DEVICE_RATE_LIMIT_MAX,
  QZ_SIGN_IP_RATE_LIMIT_MAX,
  QZ_SIGN_RATE_LIMIT_MAX,
  QZ_SIGN_STORE_RATE_LIMIT_MAX,
  type QzActiveSigningConfig,
  type QzCertificateKeyPair,
} from '../lib/qz-signing-config'
import { handleQzSignRequest, type QzSignRouteDependencies } from '../lib/qz-signing-route'
import {
  QzSigningRequestError,
  finishQzSignAudit,
  qzRequestIpHash,
  reserveQzSignRateLimit,
  verifyQzSigningSession,
  type QzSigningSession,
} from '../lib/qz-signing-server'
import {
  signPosDeviceToken,
  verifyPosDeviceRequest,
} from '../lib/desktop-pos-auth'
import { prisma } from '../lib/prisma'

const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const RAW_TENANT_ID = 'tenant-runtime-test'
const RAW_STORE_ID = 'store-secret-runtime-test'
const RAW_STORE_CODE = 'ST-NOT-CANARY'
const RAW_SESSION_FINGERPRINT = 'session-secret-runtime-test'
const RAW_DEVICE_ID = 'device-secret-runtime-test'
const RAW_IP = '203.0.113.77'
const VERSION = 'qz-runtime-test-v1'

type FakeOperationLog = {
  count: (args: { where: Record<string, unknown> }) => Promise<number>
  create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
  update?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>
}

type MutablePrisma = {
  $transaction: (
    callback: (tx: { operationLog: FakeOperationLog }) => Promise<string>,
    options?: unknown,
  ) => Promise<string>
}

function posRequest(token: string, deviceId = RAW_DEVICE_ID) {
  return new NextRequest('https://elifekh.com/api/qz/sign', {
    headers: {
      'x-pos-device-id': deviceId,
      'x-pos-device-token': token,
    },
  })
}

function signingRequest() {
  return new NextRequest('https://elifekh.com/api/qz/sign', {
    method: 'POST',
    headers: {
      origin: 'https://elifekh.com',
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain; charset=utf-8',
      'x-qz-certificate-version': VERSION,
      'x-forwarded-for': RAW_IP,
    },
    body: DIGEST,
  })
}

function expiredPosToken(secret: string): string {
  const encoded = Buffer.from(JSON.stringify({
    v: 'pos-device-v1',
    tenantId: RAW_TENANT_ID,
    storeId: RAW_STORE_ID,
    storeCode: RAW_STORE_CODE,
    deviceId: RAW_DEVICE_ID,
    issuedBy: 'runtime-test',
    iat: Date.now() - 181 * 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

async function testCurrentMainPosTokenContractDirectly() {
  const previousSecret = process.env.AUTH_SECRET
  const authSecret = 'qz-runtime-session-test-secret'
  process.env.AUTH_SECRET = authSecret
  const token = signPosDeviceToken({
    tenantId: RAW_TENANT_ID,
    storeId: RAW_STORE_ID,
    storeCode: RAW_STORE_CODE,
    deviceId: RAW_DEVICE_ID,
    issuedBy: 'runtime-test',
  })
  const expected = {
    tenantId: RAW_TENANT_ID,
    storeId: RAW_STORE_ID,
    storeCode: RAW_STORE_CODE,
  }
  try {
    const active = await verifyQzSigningSession(posRequest(token))
    assert.ok(active)
    assert.equal(active.tenantId, RAW_TENANT_ID)
    assert.equal(active.storeId, RAW_STORE_ID)
    assert.equal(active.storeCode, RAW_STORE_CODE)
    assert.equal(active.deviceId, RAW_DEVICE_ID)
    assert.match(active.sessionFingerprint, /^[0-9a-f]{64}$/)
    assert.notEqual(active.sessionFingerprint, token)
    assert.equal(
      (await verifyQzSigningSession(posRequest(token)))?.sessionFingerprint,
      active.sessionFingerprint,
      'the same verified token must derive the same server-only fingerprint',
    )

    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    assert.equal(await verifyQzSigningSession(posRequest(tampered)), null, 'tampered token must fail')
    assert.equal(await verifyQzSigningSession(posRequest(expiredPosToken(authSecret))), null, 'expired token must fail')
    assert.equal(await verifyQzSigningSession(posRequest(token, 'wrong-device')), null, 'device mismatch must fail')
    assert.equal(await verifyPosDeviceRequest(posRequest(token), { ...expected, storeId: 'wrong-store' }), null)
    assert.equal(await verifyPosDeviceRequest(posRequest(token), { ...expected, storeCode: 'WRONG-CODE' }), null)
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = previousSecret
  }
}

async function withFakeRateLimitDb(
  counts: [number, number, number, number],
  run: (state: {
    countWheres: Record<string, unknown>[]
    creates: Record<string, unknown>[]
    updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>
  }) => Promise<void>,
) {
  const mutablePrisma = prisma as unknown as MutablePrisma
  const originalTransaction = mutablePrisma.$transaction
  const operationDelegate = prisma.operationLog as unknown as Required<FakeOperationLog>
  const originalUpdate = operationDelegate.update
  const state = {
    countWheres: [] as Record<string, unknown>[],
    creates: [] as Record<string, unknown>[],
    updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  }
  mutablePrisma.$transaction = async (callback) => callback({
    operationLog: {
      count: async ({ where }) => {
        const index = state.countWheres.push(where) - 1
        return counts[index] ?? 0
      },
      create: async ({ data }) => {
        state.creates.push(data)
        return { id: `attempt-${state.creates.length}` }
      },
    },
  })
  operationDelegate.update = async (args) => {
    state.updates.push(args)
    return args
  }
  try {
    await run(state)
  } finally {
    mutablePrisma.$transaction = originalTransaction
    operationDelegate.update = originalUpdate
  }
}

const SESSION: QzSigningSession = {
  tenantId: RAW_TENANT_ID,
  storeId: RAW_STORE_ID,
  storeCode: RAW_STORE_CODE,
  sessionFingerprint: RAW_SESSION_FINGERPRINT,
  deviceId: RAW_DEVICE_ID,
}

async function testFourRateLimitDimensionsAndAuditRedactionDirectly() {
  const ipHash = qzRequestIpHash(signingRequest())
  const dimensions: Array<{ index: number; maximum: number }> = [
    { index: 0, maximum: QZ_SIGN_RATE_LIMIT_MAX },
    { index: 1, maximum: QZ_SIGN_DEVICE_RATE_LIMIT_MAX },
    { index: 2, maximum: QZ_SIGN_IP_RATE_LIMIT_MAX },
    { index: 3, maximum: QZ_SIGN_STORE_RATE_LIMIT_MAX },
  ]
  for (const dimension of dimensions) {
    const counts: [number, number, number, number] = [0, 0, 0, 0]
    counts[dimension.index] = dimension.maximum
    await withFakeRateLimitDb(counts, async (state) => {
      await assert.rejects(
        () => reserveQzSignRateLimit(SESSION, VERSION, ipHash),
        (error: unknown) => error instanceof QzSigningRequestError && error.code === 'QZ_SIGN_RATE_LIMITED',
      )
      assert.equal(state.countWheres.length, 4)
      assert.equal(state.creates.length, 0)
    })
  }

  let firstStoreHash = ''
  await withFakeRateLimitDb([0, 0, 0, 0], async (state) => {
    assert.equal(await reserveQzSignRateLimit(SESSION, VERSION, ipHash), 'attempt-1')
    assert.equal(state.countWheres.length, 4)
    assert.match(String(state.countWheres[0].targetId), /^qz-session:[0-9a-f]{32}$/)
    assert.deepEqual((state.countWheres[1].payloadSnapshot as { path: string[] }).path, ['deviceHash'])
    assert.deepEqual((state.countWheres[2].payloadSnapshot as { path: string[] }).path, ['ipHash'])
    assert.deepEqual((state.countWheres[3].payloadSnapshot as { path: string[] }).path, ['storeHash'])

    const audit = state.creates[0]
    const snapshot = audit.payloadSnapshot as Record<string, unknown>
    firstStoreHash = String(snapshot.storeHash)
    assert.equal(audit.storeId, null)
    assert.match(firstStoreHash, /^[0-9a-f]{64}$/)
    assert.match(String(snapshot.deviceHash), /^[0-9a-f]{64}$/)
    assert.match(String(snapshot.ipHash), /^[0-9a-f]{64}$/)
    const serialized = JSON.stringify(audit)
    for (const forbidden of [
      RAW_STORE_ID,
      RAW_STORE_CODE,
      RAW_SESSION_FINGERPRINT,
      RAW_DEVICE_ID,
      RAW_IP,
      DIGEST,
      'signature-secret-runtime-test',
      'ticket-content-runtime-test',
      'raw-payload-runtime-test',
    ]) {
      assert.equal(serialized.includes(forbidden), false, `audit must not contain ${forbidden}`)
    }
  })
  await withFakeRateLimitDb([0, 0, 0, 0], async (state) => {
    await reserveQzSignRateLimit(SESSION, VERSION, ipHash)
    const snapshot = state.creates[0].payloadSnapshot as Record<string, unknown>
    assert.equal(snapshot.storeHash, firstStoreHash, 'store hash must be stable')
  })
}

function canaryConfig(): QzActiveSigningConfig {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pair: QzCertificateKeyPair = {
    certificateVersion: VERSION,
    certificate: 'public-test-certificate',
    certificateSha256: '0'.repeat(64),
    kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789abc',
    signingEnabled: true,
    certificatePublicKey: publicKey,
  }
  return {
    mode: 'canary',
    certificate: pair.certificate,
    certificateVersion: VERSION,
    signatureAlgorithm: 'SHA512',
    canaryStoreCodes: new Set(['ST169E7000']),
    activePair: pair,
    versionPairs: new Map([[VERSION, pair]]),
    allowedOrigin: 'https://elifekh.com',
    awsRegion: 'us-east-1',
    awsRoleArn: 'arn:aws:iam::123456789012:role/qz-test',
  }
}

async function testCanaryDenialConsumesExistingAttemptLimitBeforeKms() {
  let kmsCalls = 0
  await withFakeRateLimitDb([0, 0, 0, 0], async (state) => {
    const dependencies: QzSignRouteDependencies = {
      readConfig: canaryConfig,
      verifySession: async () => SESSION,
      reserveAttempt: reserveQzSignRateLimit,
      sign: async () => { kmsCalls += 1; return 'unexpected' },
      finishAudit: finishQzSignAudit,
    }
    const response = await handleQzSignRequest(signingRequest(), dependencies)
    assert.equal(response.status, 403)
    assert.equal((await response.json()).error, 'QZ_SIGN_STORE_FORBIDDEN')
    assert.equal(state.creates.length, 1)
    assert.equal(state.updates.length, 1)
    assert.deepEqual(state.updates[0].data, { status: 'FAILED', message: 'QZ_SIGN_STORE_FORBIDDEN' })
    assert.equal(kmsCalls, 0)
  })

  await withFakeRateLimitDb([QZ_SIGN_RATE_LIMIT_MAX, 0, 0, 0], async (state) => {
    const dependencies: QzSignRouteDependencies = {
      readConfig: canaryConfig,
      verifySession: async () => SESSION,
      reserveAttempt: reserveQzSignRateLimit,
      sign: async () => { kmsCalls += 1; return 'unexpected' },
      finishAudit: finishQzSignAudit,
    }
    const response = await handleQzSignRequest(signingRequest(), dependencies)
    assert.equal(response.status, 429)
    assert.equal(state.creates.length, 0)
    assert.equal(state.updates.length, 0)
    assert.equal(kmsCalls, 0)
  })
}

async function run() {
  await testCurrentMainPosTokenContractDirectly()
  await testFourRateLimitDimensionsAndAuditRedactionDirectly()
  await testCanaryDenialConsumesExistingAttemptLimitBeforeKms()
  console.log('QZ signing runtime boundary tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
