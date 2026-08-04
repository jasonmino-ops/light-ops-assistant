import assert from 'node:assert/strict'
import {
  configureQzSigningSecurity,
  detectQzOnline,
  listQzPrinters,
  printHelloWorldViaQz,
  printReceiptHtmlViaQz,
  QZ_RECEIPT_WIDTH_INCHES,
  shouldUseQzPrint,
  submitDesktopReceiptPrint,
  type QzClient,
} from '../lib/qzPrinterAdapter'

function makeClient(overrides: Partial<QzClient> = {}): QzClient {
  const printCalls: { config: unknown; data: unknown[] }[] = []
  const base: QzClient = {
    websocket: {
      isActive: () => true,
      connect: async () => {},
    },
    printers: {
      find: async () => ['POS-80'],
    },
    configs: {
      create: (printer, options) => options === undefined ? { printer } : { printer, options },
    },
    print: async (config, data) => {
      printCalls.push({ config, data })
    },
    security: {
      setCertificatePromise: () => {},
      setSignaturePromise: () => {},
      setSignatureAlgorithm: () => {},
    },
  }
  const client = { ...base, ...overrides } as QzClient & { __printCalls: typeof printCalls }
  client.__printCalls = printCalls
  return client
}

const SIGNING_CERTIFICATE = `-----BEGIN CERTIFICATE-----
VEVTVA==
-----END CERTIFICATE-----`
const SIGNING_VERSION = 'test-leaf-20260805-3bf1b1a5'
const SIGNING_DIGEST = 'a'.repeat(64)
const SIGNING_SIGNATURE = 'AQIDBA=='

type FetchCall = { input: string; init?: RequestInit }

function configResponse(overrides: Record<string, unknown> = {}, status = 200): Response {
  return new Response(JSON.stringify({
    certificate: SIGNING_CERTIFICATE,
    certificateVersion: SIGNING_VERSION,
    signatureAlgorithm: 'SHA512',
    enabled: true,
    ...overrides,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function signatureResponse(body = SIGNING_SIGNATURE, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

function makeSigningHarness(options: {
  responses?: Response[]
  search?: string
  posHeaders?: Record<string, string>
} = {}) {
  const fetchCalls: FetchCall[] = []
  const storeCodes: string[] = []
  const responses = [...(options.responses ?? [configResponse(), signatureResponse()])]
  let certificateHandler: (() => Promise<string>) | null = null
  let signatureHandler: ((digest: string) => Promise<string>) | null = null
  let signatureAlgorithm: string | null = null
  let rejectOnFailure = false
  const client = makeClient({
    security: {
      setCertificatePromise: (handler, settings) => {
        certificateHandler = handler
        rejectOnFailure = settings?.rejectOnFailure === true
      },
      setSignaturePromise: (handler) => {
        signatureHandler = handler
      },
      setSignatureAlgorithm: (algorithm) => {
        signatureAlgorithm = algorithm
      },
    },
  })

  configureQzSigningSecurity(client, {
    fetchImpl: async (input, init) => {
      fetchCalls.push({ input, init })
      const response = responses.shift()
      if (!response) throw new Error('unexpected fetch')
      return response
    },
    readLocationSearch: () => options.search ?? '?storeCode=ST169E7000',
    getPosHeaders: (storeCode) => {
      storeCodes.push(storeCode)
      return options.posHeaders ?? {
        'x-pos-device-token': 'valid-pos-token',
        'x-pos-device-id': 'valid-pos-device-id',
        'x-lightops-client': 'desktop-pos',
      }
    },
  })

  return {
    client,
    fetchCalls,
    storeCodes,
    certificate: async () => {
      if (!certificateHandler) throw new Error('certificate handler not registered')
      return certificateHandler()
    },
    signature: async (digest = SIGNING_DIGEST) => {
      if (!signatureHandler) throw new Error('signature handler not registered')
      return signatureHandler(digest)
    },
    signatureAlgorithm: () => signatureAlgorithm,
    rejectOnFailure: () => rejectOnFailure,
  }
}

async function testSigningConfigSuccessWiresCertificateAndSha512() {
  const harness = makeSigningHarness()
  assert.equal(await harness.certificate(), SIGNING_CERTIFICATE)
  assert.equal(harness.signatureAlgorithm(), 'SHA512')
  assert.equal(harness.rejectOnFailure(), true, 'certificate failures must reject instead of resolving blank')
  assert.equal(harness.fetchCalls.length, 1)
  assert.equal(harness.fetchCalls[0].input, '/api/qz/config')
  assert.equal(harness.fetchCalls[0].init?.method, 'GET')
  assert.equal(harness.fetchCalls[0].init?.cache, 'no-store')
}

async function testSigningConfigFailuresReject() {
  const unavailable = makeSigningHarness({ responses: [configResponse({}, 503)] })
  await assert.rejects(() => unavailable.certificate(), /QZ_SIGNING_CONFIG_UNAVAILABLE/)

  const invalidValues = [
    { certificate: '' },
    { certificateVersion: '' },
    { signatureAlgorithm: 'SHA256' },
  ]
  for (const invalid of invalidValues) {
    const harness = makeSigningHarness({ responses: [configResponse(invalid)] })
    await assert.rejects(() => harness.certificate(), /QZ_SIGNING_CONFIG_INVALID/)
  }
}

async function testDisabledSigningConfigRejects() {
  const harness = makeSigningHarness({ responses: [configResponse({ enabled: false })] })
  await assert.rejects(() => harness.certificate(), /QZ_SIGNING_DISABLED/)
}

async function testSignatureRequestPreservesDigestAndRequiredHeaders() {
  const harness = makeSigningHarness()
  await harness.certificate()
  assert.equal(await harness.signature(), SIGNING_SIGNATURE)
  assert.equal(harness.fetchCalls.length, 2)
  const signCall = harness.fetchCalls[1]
  assert.equal(signCall.input, '/api/qz/sign')
  assert.equal(signCall.init?.method, 'POST')
  assert.equal(signCall.init?.body, SIGNING_DIGEST, 'the QZ digest must be sent verbatim without re-hashing')
  const headers = new Headers(signCall.init?.headers)
  assert.equal(headers.get('content-type'), 'text/plain')
  assert.equal(headers.get('x-qz-certificate-version'), SIGNING_VERSION)
  assert.equal(headers.get('x-pos-device-token'), 'valid-pos-token')
  assert.equal(headers.get('x-pos-device-id'), 'valid-pos-device-id')
  assert.deepEqual(harness.storeCodes, ['ST169E7000'])
}

async function testMissingStoreOrPosHeadersFailClosed() {
  const missingStore = makeSigningHarness({ search: '' })
  await missingStore.certificate()
  await assert.rejects(() => missingStore.signature(), /QZ_SIGNING_STORE_CONTEXT_INVALID/)
  assert.equal(missingStore.fetchCalls.length, 1, 'missing store context must not call the signing endpoint')

  const duplicateStore = makeSigningHarness({ search: '?storeCode=STORE-A&storeCode=STORE-B' })
  await duplicateStore.certificate()
  await assert.rejects(() => duplicateStore.signature(), /QZ_SIGNING_STORE_CONTEXT_INVALID/)

  const incompletePosHeaders: Record<string, string>[] = [
    { 'x-pos-device-id': 'valid-pos-device-id' },
    { 'x-pos-device-token': 'valid-pos-token' },
  ]
  for (const posHeaders of incompletePosHeaders) {
    const harness = makeSigningHarness({ posHeaders })
    await harness.certificate()
    await assert.rejects(() => harness.signature(), /QZ_SIGNING_POS_AUTH_MISSING/)
    assert.equal(harness.fetchCalls.length, 1, 'missing POS auth must not call the signing endpoint')
  }
}

async function testSignatureResponseFailuresRejectWithoutBlankFallback() {
  for (const response of [
    signatureResponse('upstream failed', 503),
    signatureResponse(''),
    signatureResponse('not-base64'),
  ]) {
    const harness = makeSigningHarness({ responses: [configResponse(), response] })
    await harness.certificate()
    await assert.rejects(() => harness.signature())
  }
}

async function testInvalidDigestFailsBeforeSigningRequest() {
  const harness = makeSigningHarness()
  await harness.certificate()
  await assert.rejects(() => harness.signature('not-a-64-character-hex-digest'), /QZ_SIGNING_DIGEST_INVALID/)
  assert.equal(harness.fetchCalls.length, 1)
}

async function testPrintersFindUsesConfiguredSigningChain() {
  const harness = makeSigningHarness()
  let active = false
  harness.client.websocket = {
    isActive: () => active,
    connect: async () => {
      await harness.certificate()
      active = true
    },
  }
  harness.client.printers = {
    find: async () => {
      await harness.signature()
      return ['POS-80']
    },
  }

  assert.deepEqual(await listQzPrinters(harness.client), ['POS-80'])
  assert.deepEqual(harness.fetchCalls.map((call) => call.input), ['/api/qz/config', '/api/qz/sign'])
}

async function testQzPrintUsesConfiguredSigningChain() {
  const harness = makeSigningHarness()
  let active = false
  harness.client.websocket = {
    isActive: () => active,
    connect: async () => {
      await harness.certificate()
      active = true
    },
  }
  harness.client.print = async () => {
    await harness.signature()
  }

  await printReceiptHtmlViaQz('POS-80', '<html>receipt</html>', harness.client)
  assert.deepEqual(harness.fetchCalls.map((call) => call.input), ['/api/qz/config', '/api/qz/sign'])
}

function testShouldUseQzPrintGate() {
  const base = { qzPrintEnabled: true, hasKitchenTicket: false, qzStatus: 'online' as const, selectedPrinter: 'POS-80' }
  assert.equal(shouldUseQzPrint(base), true, 'all conditions satisfied must allow QZ')
  assert.equal(shouldUseQzPrint({ ...base, qzPrintEnabled: false }), false, 'disabled toggle must block QZ')
  assert.equal(shouldUseQzPrint({ ...base, hasKitchenTicket: true }), false, 'kitchen ticket combo must stay on the legacy path')
  assert.equal(shouldUseQzPrint({ ...base, qzStatus: 'offline' }), false, 'offline QZ must block QZ')
  assert.equal(shouldUseQzPrint({ ...base, qzStatus: 'checking' }), false, 'still-checking QZ must block QZ')
  assert.equal(shouldUseQzPrint({ ...base, selectedPrinter: null }), false, 'no selected printer must block QZ')
}

async function testDetectQzOnlineWhenAlreadyActive() {
  const client = makeClient({ websocket: { isActive: () => true, connect: async () => { throw new Error('should not connect again') } } })
  assert.equal(await detectQzOnline(client), true)
}

async function testDetectQzOnlineConnectsWhenIdle() {
  let connected = false
  const client = makeClient({
    websocket: {
      isActive: () => connected,
      connect: async () => { connected = true },
    },
  })
  assert.equal(await detectQzOnline(client), true)
}

async function testDetectQzOnlineFalseWhenNoRuntime() {
  const client = makeClient({
    websocket: {
      isActive: () => false,
      connect: async () => { throw new Error('ECONNREFUSED: no QZ Tray running') },
    },
  })
  assert.equal(await detectQzOnline(client), false, 'a missing QZ runtime must report offline, not throw')
}

async function testListQzPrintersNormalizesSingleResult() {
  const client = makeClient({ printers: { find: async () => 'POS-80' } })
  assert.deepEqual(await listQzPrinters(client), ['POS-80'])
}

async function testListQzPrintersPassesThroughArray() {
  const client = makeClient({ printers: { find: async () => ['POS-80', 'Kitchen-58'] } })
  assert.deepEqual(await listQzPrinters(client), ['POS-80', 'Kitchen-58'])
}

async function testPrintHelloWorldRequiresPrinter() {
  const client = makeClient() as QzClient & { __printCalls: unknown[] }
  await assert.rejects(() => printHelloWorldViaQz('', client), /QZ_NO_PRINTER_SELECTED/)
  assert.equal(client.__printCalls.length, 0)
}

async function testPrintHelloWorldSubmitsToSelectedPrinter() {
  const client = makeClient() as QzClient & { __printCalls: { config: unknown; data: unknown[] }[] }
  await printHelloWorldViaQz('POS-80', client)
  assert.equal(client.__printCalls.length, 1)
  assert.deepEqual(client.__printCalls[0].config, { printer: 'POS-80' })
  assert.match(String(client.__printCalls[0].data[0]), /Hello World/)
}

async function testPrintReceiptHtmlSubmitsHtmlPayload() {
  const client = makeClient() as QzClient & { __printCalls: { config: unknown; data: unknown[] }[] }
  await printReceiptHtmlViaQz('POS-80', '<html>receipt</html>', client)
  assert.equal(client.__printCalls.length, 1)
  assert.deepEqual(client.__printCalls[0].config, {
    printer: 'POS-80',
    options: {
      units: 'in',
      size: { width: QZ_RECEIPT_WIDTH_INCHES },
      margins: 0,
      orientation: 'portrait',
      scaleContent: false,
    },
  })
  const [job] = client.__printCalls[0].data as {
    type: string
    format: string
    flavor: string
    data: string
    options: { pageWidth: number }
  }[]
  assert.equal(job.type, 'pixel')
  assert.equal(job.format, 'html')
  assert.equal(job.flavor, 'plain')
  assert.equal(job.data, '<html>receipt</html>')
  assert.equal(job.options.pageWidth, QZ_RECEIPT_WIDTH_INCHES)
}

async function testSubmitUsesLegacyWhenNotUsingQz() {
  let legacyCalls = 0
  const client = makeClient() as QzClient & { __printCalls: unknown[] }
  const result = await submitDesktopReceiptPrint({
    useQz: false,
    printerName: 'POS-80',
    html: '<html>receipt</html>',
    client,
    legacyPrint: () => { legacyCalls += 1 },
  })
  assert.equal(result.route, 'legacy')
  assert.equal(legacyCalls, 1)
  assert.equal(client.__printCalls.length, 0, 'the legacy route must never touch the QZ client')
}

async function testSubmitUsesLegacyWhenNoPrinterSelected() {
  let legacyCalls = 0
  const result = await submitDesktopReceiptPrint({
    useQz: true,
    printerName: null,
    html: '<html>receipt</html>',
    legacyPrint: () => { legacyCalls += 1 },
  })
  assert.equal(result.route, 'legacy')
  assert.equal(legacyCalls, 1)
}

async function testSubmitViaQzSuccessNeverCallsLegacy() {
  let legacyCalls = 0
  const client = makeClient() as QzClient & { __printCalls: { config: unknown; data: unknown[] }[] }
  const result = await submitDesktopReceiptPrint({
    useQz: true,
    printerName: 'POS-80',
    html: '<html>receipt</html>',
    client,
    legacyPrint: () => { legacyCalls += 1 },
  })
  assert.equal(result.route, 'qz')
  assert.equal(result.qzError, undefined)
  assert.equal(legacyCalls, 0, 'a successful QZ submission must not also open the browser print window')
  assert.equal(client.__printCalls.length, 1)
}

async function testSubmitViaQzFailureNeverCallsLegacy() {
  let legacyCalls = 0
  const client = makeClient({
    print: async () => { throw new Error('printer offline mid-job') },
  })
  const result = await submitDesktopReceiptPrint({
    useQz: true,
    printerName: 'POS-80',
    html: '<html>receipt</html>',
    client,
    legacyPrint: () => { legacyCalls += 1 },
  })
  assert.equal(result.route, 'qz')
  assert.ok(result.qzError instanceof Error)
  assert.equal(legacyCalls, 0, 'a failed QZ submission must not silently retry through window.print()')
}

async function run() {
  await testSigningConfigSuccessWiresCertificateAndSha512()
  await testSigningConfigFailuresReject()
  await testDisabledSigningConfigRejects()
  await testSignatureRequestPreservesDigestAndRequiredHeaders()
  await testMissingStoreOrPosHeadersFailClosed()
  await testSignatureResponseFailuresRejectWithoutBlankFallback()
  await testInvalidDigestFailsBeforeSigningRequest()
  await testPrintersFindUsesConfiguredSigningChain()
  await testQzPrintUsesConfiguredSigningChain()
  testShouldUseQzPrintGate()
  await testDetectQzOnlineWhenAlreadyActive()
  await testDetectQzOnlineConnectsWhenIdle()
  await testDetectQzOnlineFalseWhenNoRuntime()
  await testListQzPrintersNormalizesSingleResult()
  await testListQzPrintersPassesThroughArray()
  await testPrintHelloWorldRequiresPrinter()
  await testPrintHelloWorldSubmitsToSelectedPrinter()
  await testPrintReceiptHtmlSubmitsHtmlPayload()
  await testSubmitUsesLegacyWhenNotUsingQz()
  await testSubmitUsesLegacyWhenNoPrinterSelected()
  await testSubmitViaQzSuccessNeverCallsLegacy()
  await testSubmitViaQzFailureNeverCallsLegacy()
  console.log('qz printer adapter tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
