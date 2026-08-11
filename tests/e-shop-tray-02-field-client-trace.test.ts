import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  ESHOP_TRAY_02_CLIENT_TRACE_EVENTS,
  traceEshopTray02ClientPrint,
} from '../lib/eShopTrayCloudClient'

const expectedEvents = [
  'PRINT_CLICK',
  'PRINT_HTML_START',
  'PRINT_HTML_SUCCESS',
  'PRINT_HTML_FAILED',
  'ESC_POS_RENDER_START',
  'ESC_POS_RENDER_SUCCESS',
  'ESC_POS_RENDER_FAILED',
  'DIGEST_START',
  'DIGEST_SUCCESS',
  'DIGEST_FAILED',
  'BASE64_START',
  'BASE64_SUCCESS',
  'BASE64_FAILED',
  'CLOUD_SUBMIT_START',
  'CLOUD_SUBMIT_RESULT',
  'CLOUD_SUBMIT_FAILED',
]
assert.deepEqual([...ESHOP_TRAY_02_CLIENT_TRACE_EVENTS], expectedEvents)

let capturedPath = ''
let capturedInit: RequestInit | undefined
const originalInfo = console.info
const originalWarn = console.warn

async function main() {
  console.info = () => {}
  console.warn = () => {}
  try {
    await traceEshopTray02ClientPrint({
      event: 'ESC_POS_RENDER_FAILED',
      orderNo: 'sensitive-prefix-ORDER_12345678901234567890',
      byteLength: 128,
      error: new Error('x'.repeat(500)),
      token: 'must-not-be-sent',
      html: '<html>must-not-be-sent</html>',
      commandStream: 'must-not-be-sent',
    } as never, async (path, init) => {
      capturedPath = path
      capturedInit = init
      return new Response(null, { status: 202 })
    })

    await traceEshopTray02ClientPrint(
      { event: 'PRINT_CLICK', orderNo: 'ORDER-1' },
      async () => { throw new Error('trace transport unavailable') },
    )
  } finally {
    console.info = originalInfo
    console.warn = originalWarn
  }

  assert.equal(capturedPath, '/api/es-tray-02/client-trace')
  assert.equal(capturedInit?.method, 'POST')
  assert.equal(capturedInit?.keepalive, true)
  const payload = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>
  assert.equal(payload.fieldOnly, true)
  assert.equal(payload.productionContract, false)
  assert.equal(payload.event, 'ESC_POS_RENDER_FAILED')
  assert.equal(typeof payload.timestamp, 'string')
  assert.equal(typeof payload.orderRef, 'string')
  assert.ok(String(payload.orderRef).length <= 16)
  assert.equal(payload.byteLength, 128)
  assert.ok(String((payload.error as { message: string }).message).length <= 160)
  assert.equal(JSON.stringify(payload).includes('must-not-be-sent'), false)

  const orderSheet = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
  const cloudClient = fs.readFileSync('lib/eShopTrayCloudClient.ts', 'utf8')
  const traceRoute = fs.readFileSync('app/api/es-tray-02/client-trace/route.ts', 'utf8')

  for (const event of expectedEvents) {
    assert.ok(orderSheet.includes(`event: '${event}'`) || cloudClient.includes(`event: '${event}'`), `${event} must be emitted`)
    assert.ok(traceRoute.includes(`'${event}'`), `${event} must be server-allowlisted`)
  }
  assert.ok(orderSheet.indexOf("event: 'PRINT_HTML_START'") < orderSheet.indexOf('buildPrintHTML('))
  assert.ok(orderSheet.indexOf("event: 'ESC_POS_RENDER_START'") < orderSheet.indexOf('await renderTicketHtmlToEscPosRaw(html)'))
  assert.match(orderSheet, /traceCloudRelay = printPath === 'CLOUD_RELAY'/)
  assert.ok(cloudClient.indexOf("event: 'DIGEST_START'") < cloudClient.indexOf('digest = await sha256Hex'))
  assert.ok(cloudClient.indexOf("event: 'BASE64_START'") < cloudClient.indexOf('encodedCommandStream = qzRawBytesToBase64'))
  assert.match(traceRoute, /ctx\.role !== 'OWNER'/)
  assert.match(traceRoute, /store\.code !== config\.storeCode/)
  assert.match(traceRoute, /MAX_TRACE_BODY_CHARS = 4096/)
  assert.match(traceRoute, /ES_TRAY_02_FIELD_CLIENT_TRACE/)
  assert.doesNotMatch(traceRoute, /commandStream|<html|token/i)

  console.log('ES-TRAY-02 FIELD client trace tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
