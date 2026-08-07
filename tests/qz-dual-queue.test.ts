import assert from 'node:assert/strict'
import {
  QZ_PRINT_QUEUES,
  QzPrintError,
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
  connectError?: Error
  printers?: string[]
  print?: (config: unknown, data: unknown[]) => Promise<void>
}) {
  let active = options?.active ?? true
  const printCalls: PrintCall[] = []
  const configCalls: Array<{ printer: string; options?: Record<string, unknown> }> = []
  const client: QzClient & { printCalls: PrintCall[]; configCalls: typeof configCalls } = {
    websocket: {
      isActive: () => active,
      connect: async () => {
        if (options?.connectError) throw options.connectError
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
    security: {
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

async function run() {
  await testFixedQueueRouting()
  await testQzUnavailableIsExplicit()
  await testMissingQueueIsExplicitAndNeverUsesDefault()
  await testFailuresAndRetriesAreIndependent()
  await testEscPosRawUsesExactQueueAndBase64Bytes()
  console.log('QZ dual-queue adapter tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
