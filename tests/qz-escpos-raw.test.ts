import assert from 'node:assert/strict'
import { printReceiptEscPosBytesViaQz, type QzClient } from '../lib/qzPrinterAdapter'
import { bytesToBase64, EscPosBuilder } from '../lib/receipt/escpos-encoder'

function makeClient(overrides: Partial<QzClient> = {}): QzClient & { __printCalls: { config: unknown; data: unknown[] }[] } {
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
      create: (printer, options) => (options === undefined ? { printer } : { printer, options }),
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

async function testRequiresPrinter() {
  const client = makeClient()
  await assert.rejects(() => printReceiptEscPosBytesViaQz('', 'AAAA', client), /QZ_NO_PRINTER_SELECTED/)
  assert.equal(client.__printCalls.length, 0)
}

async function testSubmitsRawBase64Payload() {
  const client = makeClient()
  const base64 = new EscPosBuilder().init().text('Hi').cut().toBase64()
  await printReceiptEscPosBytesViaQz('POS-80', base64, client)
  assert.equal(client.__printCalls.length, 1)
  assert.deepEqual(client.__printCalls[0].config, { printer: 'POS-80' })
  const [job] = client.__printCalls[0].data as { type: string; format: string; data: string }[]
  assert.equal(job.type, 'raw')
  assert.equal(job.format, 'base64')
  assert.equal(job.data, base64)
}

async function testPayloadRoundTripsToOriginalBytes() {
  const bytes = new EscPosBuilder().init().align('center').text('Receipt').cut().toBytes()
  const base64 = bytesToBase64(bytes)
  const client = makeClient()
  await printReceiptEscPosBytesViaQz('POS-80', base64, client)
  const [job] = client.__printCalls[0].data as { data: string }[]
  assert.equal(job.data, base64, 'the exact bytes built by the encoder must reach QZ unmodified')
}

async function testNeverTouchesPixelHtmlConfigShape() {
  // Regression guard: the RAW path must not accidentally reuse the pixel
  // HTML config (units/size/scaleContent), which is what caused the POS-80
  // clipping bug this experiment exists to avoid repeating.
  const client = makeClient()
  await printReceiptEscPosBytesViaQz('POS-80', 'QUFB', client)
  const [{ config }] = client.__printCalls
  assert.deepEqual(config, { printer: 'POS-80' })
}

async function run() {
  await testRequiresPrinter()
  await testSubmitsRawBase64Payload()
  await testPayloadRoundTripsToOriginalBytes()
  await testNeverTouchesPixelHtmlConfigShape()
  console.log('qz escpos raw adapter tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
