import assert from 'node:assert/strict'
import { createProductReportPrintAction } from '../lib/product-sales/print-action'
import { submitEshopTray02CloudPrint } from '../lib/eShopTrayCloudClient'
import { parsePrintRequest, type EshopTrayPrintRequest } from '../lib/es-tray-relay/contract'
import { ES_TRAY_MAX_COMMAND_BYTES } from '../lib/es-tray-relay/config'

async function main() {
  const payloads: EshopTrayPrintRequest[] = []
  let renders = 0; let fallbacks = 0; let completed = 0
  let fail = true
  const action = createProductReportPrintAction({
    render: async () => { renders++; return new Uint8Array([27, 64, 10]) },
    submit: (input) => submitEshopTray02CloudPrint({ ...input, fetchImpl: async (path, init) => {
      assert.equal(path, '/api/es-tray-02/print-jobs', 'same OWNER endpoint as order details, never device or network endpoint')
      const payload = parsePrintRequest(JSON.parse(String(init?.body)))
      payloads.push(payload)
      assert.match(payload.orderNo, /^product-sales-report:[a-f0-9]{64}$/)
      assert.match(payload.requestId, /^product-sales-report:[a-f0-9-]{36}$/)
      assert.deepEqual(payload.target, { transport: 'windows-queue', queueName: '前台' })
      assert.equal('storeId' in payload, false, 'print destination derives from authenticated current store')
      assert.equal('tenantId' in payload, false)
      if (fail) throw new Error('response lost')
      return Response.json({ fieldOnly: true, productionContract: true, schemaVersion: 1, jobId: 'job', requestId: payload.requestId, status: 'PENDING_RECEIVE', created: false }, { status: 202 })
    } }),
    browser: async (_html, done) => { fallbacks++; done(); return { status: 'printed', contentPresent: true, layoutWidth: 300, layoutHeight: 500 } },
  })
  const done = () => { completed++ }
  assert.equal(await action('<main>report</main>', 'pending', done), 'ignored')
  assert.equal(payloads.length, 0, 'initialization never prints')
  await assert.rejects(action('<main>report</main>', 'enabled', done), /SUBMIT_NETWORK_FAILED/)
  assert.equal(fallbacks, 0, 'uncertain relay submission never falls back and risks duplicate output')
  fail = false
  assert.equal(await action('<main>report</main>', 'enabled', done), 'submitted')
  assert.deepEqual(payloads[0], payloads[1], 'lost-response retry sends identical key, identity and bytes')
  assert.equal(renders, 1)
  await action('<main>report</main>', 'enabled', done)
  assert.notEqual(payloads[2].requestId, payloads[1].requestId, 'successful prior send permits explicit reprint')
  fail = true
  await assert.rejects(action('<main>old report</main>', 'enabled', done))
  fail = false
  await action('<main>new report in another language</main>', 'enabled', done)
  assert.notEqual(payloads.at(-1)!.orderNo, payloads.at(-2)!.orderNo)
  assert.equal(await action('<main>browser report</main>', 'disabled', done), 'browser')
  assert.equal(fallbacks, 1)
  assert.equal(completed, 6)

  let release!: () => void
  let sends = 0
  const blockedRender = new Promise<void>((resolve) => { release = resolve })
  const serialized = createProductReportPrintAction({
    render: async () => { await blockedRender; return new Uint8Array([10]) },
    submit: async () => { sends++; return { jobId: 'one', requestId: 'one', created: true } },
    browser: async () => { throw new Error('unexpected fallback') },
  })
  const first = serialized('same', 'enabled', () => {})
  assert.equal(await serialized('same', 'enabled', () => {}), 'ignored', 'synchronous double-click lock')
  release(); await first; assert.equal(sends, 1)

  const oversized = createProductReportPrintAction({
    render: async () => new Uint8Array(ES_TRAY_MAX_COMMAND_BYTES + 1),
    submit: async () => { throw new Error('must not enqueue oversized payload') },
    browser: async () => { throw new Error('must not fall back') },
  })
  await assert.rejects(oversized('large report', 'enabled', () => {}), /PRINT_TOO_LARGE/)
  console.log('product report print tests passed: existing OWNER contract, explicit click, retry bytes, double click, changed content, fallback and size limit')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
