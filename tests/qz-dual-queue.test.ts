import assert from 'node:assert/strict'
import {
  QZ_PRINT_QUEUES,
  QZ_RECEIPT_WIDTH_INCHES,
  QzPrintError,
  printCustomerReceiptViaQz,
  printKitchenTicketViaQz,
  type QzClient,
} from '../lib/qzPrinterAdapter'

type PrintCall = { config: unknown; data: unknown[] }

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
      setSignaturePromise: () => () => {},
    },
    printCalls,
    configCalls,
  }
  return client
}

async function testFixedQueueRouting() {
  assert.deepEqual(QZ_PRINT_QUEUES, { receipt: '前台', kitchen: '厨房' })
  const client = makeClient()

  const receipt = await printCustomerReceiptViaQz('<html>receipt</html>', client)
  const kitchen = await printKitchenTicketViaQz('<html>kitchen</html>', client)

  assert.deepEqual(receipt, { kind: 'receipt', queueName: '前台' })
  assert.deepEqual(kitchen, { kind: 'kitchen', queueName: '厨房' })
  assert.deepEqual(client.configCalls.map(({ printer }) => printer), ['前台', '厨房'])
  assert.equal(client.printCalls.length, 2)
  assert.equal((client.printCalls[0].data[0] as { data: string }).data, '<html>receipt</html>')
  assert.equal((client.printCalls[1].data[0] as { data: string }).data, '<html>kitchen</html>')
  for (const call of client.configCalls) {
    assert.deepEqual(call.options, {
      units: 'in',
      size: { width: QZ_RECEIPT_WIDTH_INCHES },
      margins: 0,
      orientation: 'portrait',
      scaleContent: false,
    })
  }
}

async function testQzUnavailableIsExplicit() {
  const client = makeClient({ active: false, connectError: new Error('ECONNREFUSED') })
  await assert.rejects(
    () => printCustomerReceiptViaQz('<html />', client),
    (error: unknown) => error instanceof QzPrintError && error.code === 'QZ_UNAVAILABLE' && error.queueName === '前台',
  )
  assert.equal(client.printCalls.length, 0)
}

async function testMissingQueueIsExplicitAndNeverUsesDefault() {
  const client = makeClient({ printers: ['前台'] })
  await assert.rejects(
    () => printKitchenTicketViaQz('<html />', client),
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
    () => printCustomerReceiptViaQz('<html>receipt attempt 1</html>', client),
    (error: unknown) => error instanceof QzPrintError && error.code === 'QZ_PRINT_FAILED',
  )
  await printKitchenTicketViaQz('<html>kitchen succeeds independently</html>', client)
  await printCustomerReceiptViaQz('<html>receipt manual retry</html>', client)

  assert.deepEqual(
    client.configCalls.map(({ printer }) => printer),
    ['前台', '厨房', '前台'],
    'each manual action must remain an independent QZ submission',
  )
  assert.equal(client.printCalls.length, 3)
}

async function run() {
  await testFixedQueueRouting()
  await testQzUnavailableIsExplicit()
  await testMissingQueueIsExplicitAndNeverUsesDefault()
  await testFailuresAndRetriesAreIndependent()
  console.log('QZ dual-queue adapter tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
