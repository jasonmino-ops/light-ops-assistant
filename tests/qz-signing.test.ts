import assert from 'node:assert/strict'
import type { SignCommandOutput } from '@aws-sdk/client-kms'
import { NextRequest } from 'next/server'
import { GET as getQzConfig } from '../app/api/qz/config/route'
import { POST as postQzSign } from '../app/api/qz/sign/route'
import {
  QZ_KMS_MESSAGE_TYPE,
  QZ_KMS_SIGNING_ALGORITHM,
  QzSigningConfigError,
  isQzSigningStoreAllowed,
  readQzActiveSigningConfig,
  readQzPublicSigningConfig,
} from '../lib/qz-signing-config'
import {
  QzSigningRequestError,
  assertQzCertificateVersion,
  assertQzDigestText,
  assertQzSignContentType,
  assertQzSignOrigin,
  qzKmsSignCommand,
  signQzDigestWithKms,
} from '../lib/qz-signing-server'

const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nPUBLIC-TEST-ONLY\n-----END CERTIFICATE-----'
const VERSION = 'qz-test-2026-01'
const REGION = 'us-east-1'
const ROLE_ARN = 'arn:aws:iam::123456789012:role/eshop-qz-sign-production'
const KEY_ARN = 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789abc'
const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function env(mode: 'disabled' | 'canary' | 'general' = 'canary'): Record<string, string | undefined> {
  return {
    QZ_SIGNING_MODE: mode,
    QZ_SIGNING_PUBLIC_CERTIFICATE: CERTIFICATE,
    QZ_SIGNING_CERTIFICATE_VERSION: VERSION,
    QZ_SIGNING_CANARY_STORE_CODES: mode === 'canary' ? 'ST169E7000' : undefined,
    QZ_SIGNING_ORIGIN: 'https://elifekh.com',
    QZ_SIGNING_AWS_REGION: REGION,
    QZ_SIGNING_AWS_ROLE_ARN: ROLE_ARN,
    QZ_SIGNING_KMS_KEY_ARN: KEY_ARN,
  }
}

function request(headers?: Record<string, string>) {
  return new NextRequest('https://elifekh.com/api/qz/sign', {
    method: 'POST',
    headers: {
      origin: 'https://elifekh.com',
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain; charset=utf-8',
      'x-qz-certificate-version': VERSION,
      ...headers,
    },
    body: DIGEST,
  })
}

async function withProcessEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const keys = [
    'QZ_SIGNING_MODE',
    'QZ_SIGNING_PUBLIC_CERTIFICATE',
    'QZ_SIGNING_CERTIFICATE_VERSION',
    'QZ_SIGNING_CANARY_STORE_CODES',
    'QZ_SIGNING_ORIGIN',
    'QZ_SIGNING_AWS_REGION',
    'QZ_SIGNING_AWS_ROLE_ARN',
    'QZ_SIGNING_KMS_KEY_ARN',
  ] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) {
      const value = values[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await fn()
  } finally {
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function testConfigModesFailClosed() {
  assert.throws(
    () => readQzPublicSigningConfig({}),
    (error: unknown) => error instanceof QzSigningConfigError && error.code === 'QZ_SIGNING_CONFIG_INVALID',
  )
  const disabled = readQzPublicSigningConfig(env('disabled'))
  assert.equal(disabled.mode, 'disabled')
  assert.throws(
    () => readQzActiveSigningConfig(env('disabled')),
    (error: unknown) => error instanceof QzSigningConfigError && error.code === 'QZ_SIGNING_DISABLED',
  )
  assert.throws(
    () => readQzActiveSigningConfig({ ...env('canary'), QZ_SIGNING_CANARY_STORE_CODES: '' }),
    /QZ_SIGNING_CONFIG_INVALID/,
  )
  assert.throws(
    () => readQzActiveSigningConfig({ ...env('general'), QZ_SIGNING_CANARY_STORE_CODES: 'ST169E7000' }),
    /QZ_SIGNING_CONFIG_INVALID/,
  )

  const canary = readQzActiveSigningConfig(env('canary'))
  assert.equal(isQzSigningStoreAllowed(canary, 'ST169E7000'), true)
  assert.equal(isQzSigningStoreAllowed(canary, 'ST-OTHER'), false)
  const general = readQzActiveSigningConfig(env('general'))
  assert.equal(isQzSigningStoreAllowed(general, 'ST-OTHER'), true)
}

async function testConfigEndpointIsPublicAndNoStore() {
  await withProcessEnv(env('canary'), async () => {
    const response = await getQzConfig()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
    assert.deepEqual(await response.json(), {
      certificate: CERTIFICATE,
      signatureAlgorithm: 'SHA512',
      certificateVersion: VERSION,
      enabled: true,
    })
  })
  await withProcessEnv(env('disabled'), async () => {
    const response = await getQzConfig()
    assert.equal(response.status, 200)
    assert.equal((await response.json()).enabled, false)
  })
}

async function testRequestContract() {
  const config = readQzActiveSigningConfig(env('canary'))
  assert.doesNotThrow(() => assertQzSignOrigin(request(), config))
  assert.doesNotThrow(() => assertQzSignContentType(request()))
  assert.doesNotThrow(() => assertQzCertificateVersion(request(), config))
  assert.equal(assertQzDigestText(DIGEST), DIGEST)
  assert.throws(
    () => assertQzSignOrigin(request({ origin: 'https://attacker.example' }), config),
    (error: unknown) => error instanceof QzSigningRequestError && error.code === 'QZ_SIGN_ORIGIN_FORBIDDEN',
  )
  assert.throws(
    () => assertQzSignContentType(request({ 'content-type': 'application/json' })),
    /QZ_SIGN_CONTENT_TYPE_INVALID/,
  )
  assert.throws(
    () => assertQzCertificateVersion(request({ 'x-qz-certificate-version': 'old' }), config),
    /QZ_SIGN_VERSION_MISMATCH/,
  )
  assert.throws(() => assertQzDigestText(`${DIGEST}\n`), /QZ_SIGN_INPUT_INVALID/)
}

async function testKmsSignsUtf8DigestTextAsRawSha512() {
  const config = readQzActiveSigningConfig(env('canary'))
  const command = qzKmsSignCommand(config, DIGEST)
  assert.equal(command.input.KeyId, KEY_ARN)
  assert.equal(command.input.MessageType, QZ_KMS_MESSAGE_TYPE)
  assert.equal(command.input.SigningAlgorithm, QZ_KMS_SIGNING_ALGORITHM)
  assert.equal(Buffer.from(command.input.Message ?? []).toString('utf8'), DIGEST)
  assert.equal(command.input.Message?.byteLength, 64, 'the SHA-256 hex text must not be hex-decoded')

  const signatureBytes = Uint8Array.from([1, 2, 3, 4])
  const signature = await signQzDigestWithKms(config, DIGEST, {
    send: async () => ({
      KeyId: KEY_ARN,
      SigningAlgorithm: QZ_KMS_SIGNING_ALGORITHM,
      Signature: signatureBytes,
      $metadata: {},
    } satisfies SignCommandOutput),
  })
  assert.equal(signature, 'AQIDBA==')

  await assert.rejects(
    () => signQzDigestWithKms(config, DIGEST, {
      send: async () => ({
        KeyId: 'arn:aws:kms:us-east-1:123456789012:key/wrong',
        SigningAlgorithm: QZ_KMS_SIGNING_ALGORITHM,
        Signature: signatureBytes,
        $metadata: {},
      }),
    }),
    /QZ_SIGN_KMS_FAILED/,
  )
}

async function testDisabledAndInvalidSignConfigFailBeforeAuth() {
  await withProcessEnv(env('disabled'), async () => {
    const response = await postQzSign(request())
    assert.equal(response.status, 403)
    assert.equal((await response.json()).error, 'QZ_SIGNING_DISABLED')
  })
  await withProcessEnv({}, async () => {
    const response = await postQzSign(request())
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error, 'QZ_SIGNING_CONFIG_INVALID')
  })
}

async function testActiveEndpointRejectsBeforeKmsWithoutAValidSession() {
  await withProcessEnv(env('canary'), async () => {
    const foreignOrigin = await postQzSign(request({ origin: 'https://attacker.example' }))
    assert.equal(foreignOrigin.status, 403)
    assert.equal((await foreignOrigin.json()).error, 'QZ_SIGN_ORIGIN_FORBIDDEN')

    const wrongType = await postQzSign(request({ 'content-type': 'application/json' }))
    assert.equal(wrongType.status, 400)
    assert.equal((await wrongType.json()).error, 'QZ_SIGN_CONTENT_TYPE_INVALID')

    const wrongVersion = await postQzSign(request({ 'x-qz-certificate-version': 'old' }))
    assert.equal(wrongVersion.status, 400)
    assert.equal((await wrongVersion.json()).error, 'QZ_SIGN_VERSION_MISMATCH')

    const noSession = await postQzSign(request())
    assert.equal(noSession.status, 401)
    assert.equal((await noSession.json()).error, 'QZ_SIGN_SESSION_UNAUTHORIZED')
  })
}

async function run() {
  await testConfigModesFailClosed()
  await testConfigEndpointIsPublicAndNoStore()
  await testRequestContract()
  await testKmsSignsUtf8DigestTextAsRawSha512()
  await testDisabledAndInvalidSignConfigFailBeforeAuth()
  await testActiveEndpointRejectsBeforeKmsWithoutAValidSession()
  console.log('QZ signing contract tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
