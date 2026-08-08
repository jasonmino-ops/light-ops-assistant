import assert from 'node:assert/strict'
import {
  QZ_PRINT_QUEUES,
  QzPrintError,
  listQzPrinters,
  printEscPosBitImageViaFixedQzQueue,
  printCustomerReceiptViaQz,
  printKitchenTicketViaQz,
  type QzClient,
} from '../lib/qzPrinterAdapter'

type PrintCall = { config: unknown; data: unknown[] }
const FORMAL_RAW_BYTES = Uint8Array.from([0x1b, 0x2a, 0x21, 0x01, 0x00, 0xff, 0x00, 0x81])

async function fakeRasterize() {
  return FORMAL_RAW_BYTES
}

function makeClient(options?: {
  active?: boolean
  connect?: () => Promise<void>
  connectError?: Error
  printers?: string[]
  print?: (config: unknown, data: unknown[]) => Promise<void>
  security?: QzClient['security']
}) {
  let active = options?.active ?? true
  const printCalls: PrintCall[] = []
  const configCalls: Array<{ printer: string; options?: Record<string, unknown> }> = []
  const client: QzClient & { printCalls: PrintCall[]; configCalls: typeof configCalls } = {
    websocket: {
      isActive: () => active,
      connect: async () => {
        if (options?.connectError) throw options.connectError
        await options?.connect?.()
        active = true
      },
    },
    printers: {
      find: async () => options?.printers ?? ['前台', '厨房'],
    },
    configs: {
      create: (printer, configOptions) => {
        configCalls.push({ printer, options: configOptions })
        return { printer, options: configOptions }
      },
    },
    print: async (config, data) => {
      printCalls.push({ config, data })
      await options?.print?.(config, data)
    },
    security: options?.security ?? {
      setCertificatePromise: () => {},
      setSignaturePromise: () => {},
      setSignatureAlgorithm: () => {},
    },
    printCalls,
    configCalls,
  }
  return client
}

async function testFixedQueueRouting() {
  assert.deepEqual(QZ_PRINT_QUEUES, { receipt: '前台', kitchen: '厨房' })
  const client = makeClient()
  const rasterizedHtml: string[] = []
  const rasterize = async (html: string) => {
    rasterizedHtml.push(html)
    return FORMAL_RAW_BYTES
  }

  const receipt = await printCustomerReceiptViaQz('<html>receipt</html>', client, rasterize)
  const kitchen = await printKitchenTicketViaQz('<html>kitchen</html>', client, rasterize)

  assert.deepEqual(receipt, { kind: 'receipt', queueName: '前台' })
  assert.deepEqual(kitchen, { kind: 'kitchen', queueName: '厨房' })
  assert.deepEqual(rasterizedHtml, ['<html>receipt</html>', '<html>kitchen</html>'])
  assert.deepEqual(client.configCalls.map(({ printer }) => printer), ['前台', '厨房'])
  assert.equal(client.printCalls.length, 2)
  for (const call of client.configCalls) assert.equal(call.options, undefined)
  for (const call of client.printCalls) {
    assert.deepEqual(call.data, [{ type: 'raw', format: 'base64', data: 'GyohAQD/AIE=' }])
  }
}

async function testQzUnavailableIsExplicit() {
  const client = makeClient({ active: false, connectError: new Error('ECONNREFUSED') })
  await assert.rejects(
    () => printCustomerReceiptViaQz('<html />', client, fakeRasterize),
    (error: unknown) => error instanceof QzPrintError && error.code === 'QZ_UNAVAILABLE' && error.queueName === '前台',
  )
  assert.equal(client.printCalls.length, 0)
}

async function testMissingQueueIsExplicitAndNeverUsesDefault() {
  const client = makeClient({ printers: ['前台'] })
  await assert.rejects(
    () => printKitchenTicketViaQz('<html />', client, fakeRasterize),
    (error: unknown) => error instanceof QzPrintError && error.code === 'QZ_QUEUE_NOT_FOUND' && error.queueName === '厨房',
  )
  assert.equal(client.configCalls.length, 0)
  assert.equal(client.printCalls.length, 0)
}

async function testFailuresAndRetriesAreIndependent() {
  let receiptAttempts = 0
  const client = makeClient({
    print: async (config) => {
      const printer = (config as { printer: string }).printer
      if (printer === '前台' && receiptAttempts++ === 0) throw new Error('front queue offline')
    },
  })

  await assert.rejects(
    () => printCustomerReceiptViaQz('<html>receipt attempt 1</html>', client, fakeRasterize),
    (error: unknown) => error instanceof QzPrintError && error.code === 'QZ_PRINT_FAILED',
  )
  await printKitchenTicketViaQz('<html>kitchen succeeds independently</html>', client, fakeRasterize)
  await printCustomerReceiptViaQz('<html>receipt manual retry</html>', client, fakeRasterize)

  assert.deepEqual(client.configCalls.map(({ printer }) => printer), ['前台', '厨房', '前台'])
  assert.equal(client.printCalls.length, 3)
}

async function testEscPosRawUsesExactQueueAndBase64Bytes() {
  const client = makeClient()
  const receipt = await printEscPosBitImageViaFixedQzQueue('receipt', FORMAL_RAW_BYTES, client)
  const kitchen = await printEscPosBitImageViaFixedQzQueue('kitchen', FORMAL_RAW_BYTES, client)

  assert.deepEqual(receipt, { kind: 'receipt', queueName: '前台' })
  assert.deepEqual(kitchen, { kind: 'kitchen', queueName: '厨房' })
  assert.deepEqual(client.configCalls, [
    { printer: '前台', options: undefined },
    { printer: '厨房', options: undefined },
  ])
}

async function testRawPrintUsesExistingNonBlankSignature() {
  const certificate = `-----BEGIN CERTIFICATE-----
VEVTVA==
-----END CERTIFICATE-----`
  const digest = 'a'.repeat(64)
  const signature = 'AQIDBA=='
  const fetchCalls: string[] = []
  const certificateModes: string[] = []
  const callOrder: string[] = []
  const authorizedCalls: Array<{
    call: 'printers.find' | 'qz.print'
    certificate: string
    signature: string
    certificateHandler: unknown
    signatureHandler: unknown
  }> = []
  let certificateHandler: (() => Promise<string>) | null = null
  let signatureHandler: ((value: string) => Promise<string>) | null = null
  let signatureAlgorithm = ''
  let connectionCertificate = ''
  const observeAuthorizedCall = async (call: 'printers.find' | 'qz.print') => {
    if (!certificateHandler || !signatureHandler) throw new Error('signing callbacks missing')
    const activeCertificateHandler = certificateHandler
    const activeSignatureHandler = signatureHandler
    const observedCertificate = await activeCertificateHandler()
    assert.equal(signatureAlgorithm, 'SHA512')
    const observedSignature = await activeSignatureHandler(digest)
    authorizedCalls.push({
      call,
      certificate: observedCertificate,
      signature: observedSignature,
      certificateHandler: activeCertificateHandler,
      signatureHandler: activeSignatureHandler,
    })
  }

  const client = makeClient({
    active: false,
    connect: async () => {
      callOrder.push('websocket.connect')
      if (!certificateHandler || !signatureHandler) throw new Error('security not installed before connect')
      connectionCertificate = await certificateHandler()
    },
    security: {
      setCertificatePromise: (handler, options) => {
        certificateModes.push(options?.rejectOnFailure === true ? 'signed' : 'raw')
        callOrder.push('security.certificate')
        certificateHandler = handler
      },
      setSignaturePromise: (handler) => {
        callOrder.push('security.signature')
        signatureHandler = handler
      },
      setSignatureAlgorithm: (algorithm) => { signatureAlgorithm = algorithm },
    },
    print: async () => {
      callOrder.push('qz.print')
      await observeAuthorizedCall('qz.print')
    },
  })
  client.printers.find = async () => {
    callOrder.push('printers.find')
    await observeAuthorizedCall('printers.find')
    return ['前台', '厨房']
  }

  const previousWindow = globalThis.window
  const previousLocalStorage = globalThis.localStorage
  const previousFetch = globalThis.fetch
  const values = new Map([
    ['cashier:deviceId', 'valid-pos-device-id'],
    ['cashier:posDeviceToken:ST169E7000', 'valid-pos-token'],
  ])
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { location: { pathname: '/desktop/pos', search: '?storeCode=ST169E7000' } },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size },
    },
  })
  globalThis.fetch = async (input, init) => {
    const endpoint = String(input)
    fetchCalls.push(endpoint)
    if (endpoint === '/api/qz/config') {
      return new Response(JSON.stringify({
        certificate,
        certificateVersion: 'test-leaf-20260805-3bf1b1a5',
        signatureAlgorithm: 'SHA512',
        enabled: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (endpoint === '/api/qz/sign') {
      assert.equal(init?.body, digest)
      return new Response(signature, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    throw new Error(`unexpected endpoint: ${endpoint}`)
  }

  try {
    assert.deepEqual(await listQzPrinters(client, 'raw'), ['前台', '厨房'])
    assert.deepEqual(callOrder, [
      'security.certificate',
      'security.signature',
      'websocket.connect',
      'printers.find',
    ], 'RAW status enumeration must immediately follow its signed connection')
    await printEscPosBitImageViaFixedQzQueue('receipt', FORMAL_RAW_BYTES, client)
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: previousWindow })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: previousLocalStorage })
    globalThis.fetch = previousFetch
  }

  assert.deepEqual(authorizedCalls.map(({ call }) => call), ['printers.find', 'printers.find', 'qz.print'])
  assert.deepEqual(callOrder, [
    'security.certificate',
    'security.signature',
    'websocket.connect',
    'printers.find',
    'printers.find',
    'qz.print',
  ])
  assert.equal(connectionCertificate, certificate)
  for (const request of authorizedCalls) {
    assert.equal(request.certificate, certificate)
    assert.equal(request.signature, signature)
    assert.notEqual(request.signature, '')
    assert.equal(request.certificateHandler, authorizedCalls[0].certificateHandler)
    assert.equal(request.signatureHandler, authorizedCalls[0].signatureHandler)
  }
  assert.equal(signatureAlgorithm, 'SHA512')
  assert.deepEqual(fetchCalls, [
    '/api/qz/config',
    '/api/qz/config', '/api/qz/sign',
    '/api/qz/config', '/api/qz/sign',
    '/api/qz/config', '/api/qz/sign',
  ])
  assert.deepEqual(certificateModes, ['signed'], 'RAW enumeration and print must share one signed security context')
}

async function run() {
  await testFixedQueueRouting()
  await testQzUnavailableIsExplicit()
  await testMissingQueueIsExplicitAndNeverUsesDefault()
  await testFailuresAndRetriesAreIndependent()
  await testEscPosRawUsesExactQueueAndBase64Bytes()
  await testRawPrintUsesExistingNonBlankSignature()
  console.log('QZ dual-queue adapter tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
