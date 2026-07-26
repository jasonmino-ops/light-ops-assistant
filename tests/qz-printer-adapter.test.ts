import assert from 'node:assert/strict'
import {
  detectQzOnline,
  listQzPrinters,
  printHelloWorldViaQz,
  printReceiptHtmlViaQz,
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
      create: (printer) => ({ printer }),
    },
    print: async (config, data) => {
      printCalls.push({ config, data })
    },
    security: {
      setCertificatePromise: () => {},
      setSignaturePromise: () => (resolve: (value: string) => void) => resolve(''),
    },
  }
  const client = { ...base, ...overrides } as QzClient & { __printCalls: typeof printCalls }
  client.__printCalls = printCalls
  return client
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
  const [job] = client.__printCalls[0].data as { type: string; format: string; data: string }[]
  assert.equal(job.type, 'pixel')
  assert.equal(job.format, 'html')
  assert.equal(job.data, '<html>receipt</html>')
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
