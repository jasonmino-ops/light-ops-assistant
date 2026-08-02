import assert from 'node:assert/strict'
import {
  QzPrintError,
  clearQzSecurityConfigForRecovery,
  configureQzSecurity,
  printCustomerReceiptViaQz,
  type QzClient,
} from '../lib/qzPrinterAdapter'

const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nPUBLIC-TEST-ONLY\n-----END CERTIFICATE-----'
const SIGNATURE = 'AQIDBA=='

type CertificateHandler = (
  resolve: (value: string) => void,
  reject: (error: unknown) => void,
) => void
type SignatureHandler = (
  resolve: (value: string) => void,
  reject: (error: unknown) => void,
) => void
type SignatureFactory = (toSign: string) => SignatureHandler

function configResponse(version: string) {
  return new Response(JSON.stringify({
    certificate: CERTIFICATE,
    signatureAlgorithm: 'SHA512',
    certificateVersion: version,
    enabled: true,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function signatureResponse(version: string) {
  return new Response(SIGNATURE, {
    status: 200,
    headers: { 'X-QZ-Certificate-Version': version },
  })
}

function createSecurityClient(printImpl?: () => Promise<void>) {
  let active = true
  let disconnects = 0
  let certificateHandler: CertificateHandler | null = null
  let signatureFactory: SignatureFactory | null = null
  let printCalls = 0
  const client: QzClient = {
    websocket: {
      isActive: () => active,
      connect: async () => { active = true },
      disconnect: async () => { disconnects += 1; active = false },
    },
    printers: { find: async () => ['前台', '厨房'] },
    configs: { create: (printer) => ({ printer }) },
    print: async () => {
      printCalls += 1
      await printImpl?.()
    },
    security: {
      setCertificatePromise: (handler) => { certificateHandler = handler },
      setSignatureAlgorithm: (algorithm) => { assert.equal(algorithm, 'SHA512') },
      setSignaturePromise: (factory) => { signatureFactory = factory },
    },
  }
  configureQzSecurity(client)
  return {
    client,
    certificate: () => invokeCertificate(certificateHandler),
    signature: (value = DIGEST) => invokeSignature(signatureFactory, value),
    disconnects: () => disconnects,
    printCalls: () => printCalls,
  }
}

function invokeCertificate(handler: CertificateHandler | null): Promise<string> {
  assert.ok(handler, 'certificate handler must be registered')
  return new Promise((resolve, reject) => handler(resolve, reject))
}

function invokeSignature(factory: SignatureFactory | null, toSign: string): Promise<string> {
  assert.ok(factory, 'signature handler must be registered')
  return new Promise((resolve, reject) => factory(toSign)(resolve, reject))
}

async function withFetch(
  implementation: typeof fetch,
  run: () => Promise<void>,
) {
  const previous = globalThis.fetch
  globalThis.fetch = implementation
  clearQzSecurityConfigForRecovery()
  try {
    await run()
  } finally {
    clearQzSecurityConfigForRecovery()
    globalThis.fetch = previous
  }
}

async function testConfigFailureCanRecover() {
  let configCalls = 0
  await withFetch(async (input) => {
    assert.equal(String(input), '/api/qz/config')
    configCalls += 1
    return configCalls === 1 ? new Response('', { status: 503 }) : configResponse('v2')
  }, async () => {
    const qz = createSecurityClient()
    await assert.rejects(() => qz.certificate(), /QZ_SECURITY_UNAVAILABLE/)
    assert.equal(await qz.certificate(), CERTIFICATE)
    assert.equal(configCalls, 2, 'a rejected config Promise must not poison later reconnects')
  })
}

async function testSignaturesAreNeverCached() {
  let configCalls = 0
  let signCalls = 0
  await withFetch(async (input) => {
    if (String(input) === '/api/qz/config') {
      configCalls += 1
      return configResponse('v1')
    }
    signCalls += 1
    return signatureResponse('v1')
  }, async () => {
    const qz = createSecurityClient()
    assert.equal(await qz.certificate(), CERTIFICATE)
    assert.equal(await qz.signature(), SIGNATURE)
    assert.equal(await qz.signature(), SIGNATURE)
    assert.equal(configCalls, 1)
    assert.equal(signCalls, 2, 'every QZ digest must obtain its own signature')
  })
}

async function testVersionMismatchRefreshesOnlyAfterBlockedPrint() {
  let configCalls = 0
  await withFetch(async (input) => {
    if (String(input) === '/api/qz/config') {
      configCalls += 1
      return configResponse(configCalls === 1 ? 'v1' : 'v2')
    }
    return new Response(JSON.stringify({ error: 'QZ_SIGN_VERSION_MISMATCH' }), { status: 409 })
  }, async () => {
    const qz = createSecurityClient()
    assert.equal(await qz.certificate(), CERTIFICATE)
    await assert.rejects(() => qz.signature(), /QZ_SECURITY_UNAVAILABLE/)
    assert.equal(await qz.certificate(), CERTIFICATE)
    assert.equal(configCalls, 2, 'rotation mismatch must invalidate only the cached public config')
  })
}

async function testSecurityFailureBlocksTransportAndDoesNotFallback() {
  let transportSubmissions = 0
  let harness: ReturnType<typeof createSecurityClient>
  await withFetch(async (input) => {
    if (String(input) === '/api/qz/config') return configResponse('v1')
    return new Response(JSON.stringify({ error: 'QZ_SIGN_KMS_FAILED' }), { status: 503 })
  }, async () => {
    harness = createSecurityClient(async () => {
      await harness.signature()
      transportSubmissions += 1
    })
    await assert.rejects(
      () => printCustomerReceiptViaQz('<html>unchanged receipt</html>', harness.client, async () => Uint8Array.of(1)),
      (error: unknown) => error instanceof QzPrintError && error.code === 'QZ_SECURITY_UNAVAILABLE',
    )
    assert.equal(harness.printCalls(), 1, 'the business action invokes QZ at most once')
    assert.equal(transportSubmissions, 0, 'QZ transport must not receive RAW data without a signature')
    assert.equal(harness.disconnects(), 1, 'the next manual retry must reconnect and reload current config')
  })
}

async function run() {
  await testConfigFailureCanRecover()
  await testSignaturesAreNeverCached()
  await testVersionMismatchRefreshesOnlyAfterBlockedPrint()
  await testSecurityFailureBlocksTransportAndDoesNotFallback()
  console.log('QZ browser signing recovery tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
