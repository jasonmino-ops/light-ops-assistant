import assert from 'node:assert/strict'
import { createProductReportPrintAction } from '../lib/product-sales/print-action'
import { submitEshopTray02CloudPrint } from '../lib/eShopTrayCloudClient'
import { parsePrintRequest, type EshopTrayPrintRequest } from '../lib/es-tray-relay/contract'
import { ES_TRAY_MAX_COMMAND_BYTES } from '../lib/es-tray-relay/config'

async function main() {
  const payloads: EshopTrayPrintRequest[] = []
  let renders = 0; let fallbacks = 0
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
  assert.equal(await action('<main>report</main>', 'pending'), 'ignored')
  assert.equal(payloads.length, 0, 'initialization never prints')
  await assert.rejects(action('<main>report</main>', 'enabled'), /PRINT_SEND_FAILED/)
  assert.equal(fallbacks, 0, 'uncertain relay submission never falls back and risks duplicate output')
  fail = false
  assert.equal(await action('<main>report</main>', 'enabled'), 'submitted')
  assert.deepEqual(payloads[0], payloads[1], 'lost-response retry sends identical key, identity and bytes')
  assert.equal(renders, 1)
  await action('<main>report</main>', 'enabled')
  assert.notEqual(payloads[2].requestId, payloads[1].requestId, 'successful prior send permits explicit reprint')
  fail = true
  await assert.rejects(action('<main>old report</main>', 'enabled'))
  fail = false
  await action('<main>new report in another language</main>', 'enabled')
  assert.notEqual(payloads.at(-1)!.orderNo, payloads.at(-2)!.orderNo)
  assert.equal(await action('<main>browser report</main>', 'disabled'), 'browser')
  assert.equal(fallbacks, 1)

  let release!: () => void
  let sends = 0
  const blockedRender = new Promise<void>((resolve) => { release = resolve })
  const serialized = createProductReportPrintAction({
    render: async () => { await blockedRender; return new Uint8Array([10]) },
    submit: async () => { sends++; return { jobId: 'one', requestId: 'one', created: true } },
    browser: async () => { throw new Error('unexpected fallback') },
  })
  const first = serialized('same', 'enabled')
  assert.equal(await serialized('same', 'enabled'), 'ignored', 'synchronous double-click lock')
  release(); await first; assert.equal(sends, 1)

  const oversized = createProductReportPrintAction({
    render: async () => new Uint8Array(ES_TRAY_MAX_COMMAND_BYTES + 1),
    submit: async () => { throw new Error('must not enqueue oversized payload') },
    browser: async () => { throw new Error('must not fall back') },
  })
  await assert.rejects(oversized('large report', 'enabled'), /PRINT_TOO_LARGE/)
  await failureBoundaries()
  console.log('product report print tests passed: OWNER contract, deadlines, abort, late completion fences, repeat/retry identity and browser cleanup')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
const limits = { prepareMs: 50, submitMs: 50 }
async function failureBoundaries() {
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle)
  const nativeFetch = globalThis.fetch
  try {
    // The report's own digest can stall. Expiry must not start a renderer later.
    const digest = deferred<ArrayBuffer>(); let rendered = 0
    crypto.subtle.digest = () => digest.promise
    const preparation = createProductReportPrintAction({ render: async () => { rendered++; return new Uint8Array([10]) } }, limits)
    await assert.rejects(preparation('digest stalled', 'enabled'), /PRINT_PREPARE_TIMEOUT/)
    digest.resolve(new ArrayBuffer(32)); await tick(); assert.equal(rendered, 0)
    crypto.subtle.digest = nativeDigest

    // A timed-out render resolving after retry must neither send nor overwrite
    // that retry's cached bytes or request identity.
    const lateRender = deferred<Uint8Array>(); const sent: Array<{ requestId: string; commandStream: Uint8Array }> = []
    let renderCount = 0
    const renderTimeout = createProductReportPrintAction({
      render: () => ++renderCount === 1 ? lateRender.promise : Promise.resolve(new Uint8Array([20])),
      submit: async (input) => { sent.push(input); throw new Error('unconfirmed') },
      browser: async () => { throw new Error('no automatic fallback') },
    }, limits)
    await assert.rejects(renderTimeout('render stalled', 'enabled'), /PRINT_PREPARE_TIMEOUT/)
    assert.equal(sent.length, 0)
    await assert.rejects(renderTimeout('render stalled', 'enabled'), /PRINT_SEND_FAILED/)
    lateRender.resolve(new Uint8Array([99])); await tick()
    assert.equal(sent.length, 1)
    await assert.rejects(renderTimeout('render stalled', 'enabled'), /PRINT_SEND_FAILED/)
    assert.deepEqual(sent[1], sent[0]); assert.deepEqual(sent[1].commandStream, new Uint8Array([20]))
    assert.equal(renderCount, 2)

    // Real default shared submit + report fetchImpl: hung HTTP must be aborted;
    // explicit retry uses exactly the same body even after a late first success.
    const response = deferred<Response>(); const requests: RequestInit[] = []
    globalThis.fetch = async (_path, init) => {
      requests.push(init!)
      if (requests.length === 1) return response.promise
      if (requests.length === 2) throw new Error('retry lost')
      const body = JSON.parse(String(init!.body))
      return Response.json({ fieldOnly: true, productionContract: true, schemaVersion: 1, jobId: 'retry', requestId: body.requestId, status: 'PENDING_RECEIVE', created: false }, { status: 202 })
    }
    const submission = createProductReportPrintAction({ render: async () => new Uint8Array([10]) }, limits)
    await assert.rejects(submission('submit stalled', 'enabled'), /PRINT_SEND_TIMEOUT/)
    assert.equal(requests[0].signal?.aborted, true)
    await assert.rejects(submission('submit stalled', 'enabled'), /PRINT_SEND_FAILED/)
    const first = JSON.parse(String(requests[0].body))
    response.resolve(Response.json({ fieldOnly: true, productionContract: true, schemaVersion: 1, jobId: 'late', requestId: first.requestId, status: 'PENDING_RECEIVE', created: true }, { status: 202 }))
    await tick()
    assert.equal(await submission('submit stalled', 'enabled'), 'submitted')
    assert.equal(requests.length, 3)
    assert.equal(requests[0].body, requests[1].body); assert.equal(requests[0].body, requests[2].body)

    // An HTTP response whose body never finishes is bounded too.
    globalThis.fetch = async () => ({ status: 202, json: () => new Promise(() => {}) }) as unknown as Response
    const bodyTimeout = createProductReportPrintAction({ render: async () => new Uint8Array([10]) }, limits)
    await assert.rejects(bodyTimeout('body stalled', 'enabled'), /PRINT_SEND_TIMEOUT/)

    // The shared submit hashes bytes before fetch. Abort before that hash
    // resolves must prevent a POST, not merely stop waiting for it.
    const lateHash = deferred<ArrayBuffer>(); let hashes = 0; let posts = 0
    crypto.subtle.digest = (algorithm, data) => ++hashes === 2 ? lateHash.promise : nativeDigest(algorithm, data)
    globalThis.fetch = async () => { posts++; throw new Error('must not POST') }
    const beforeFetch = createProductReportPrintAction({ render: async () => new Uint8Array([10]) }, limits)
    await assert.rejects(beforeFetch('submit hash stalled', 'enabled'), /PRINT_SEND_TIMEOUT/)
    lateHash.resolve(new ArrayBuffer(32)); await tick(); assert.equal(posts, 0)
    crypto.subtle.digest = nativeDigest

    // Rejecting late is handled by the bounded stage, without poisoning retries.
    const lateFailure = deferred<Uint8Array>(); let attempts = 0
    const failedRender = createProductReportPrintAction({
      render: () => ++attempts === 1 ? lateFailure.promise : Promise.reject(new Error('render failure')),
    }, limits)
    await assert.rejects(failedRender('failure', 'enabled'), /PRINT_PREPARE_TIMEOUT/)
    lateFailure.reject(new Error('late render failure')); await tick()
    await assert.rejects(failedRender('failure', 'enabled'), /PRINT_PREPARE_FAILED/)

    // Browser Promise completion releases the page, while delayed afterprint
    // retains a separate lock to prevent overlapping global fallback markup.
    const cleanups: Array<() => void> = []; let browsers = 0
    const browserAction = createProductReportPrintAction({
      browser: async (_html, cleanup) => { browsers++; cleanups.push(cleanup); return { status: 'printed', contentPresent: true, layoutWidth: 300, layoutHeight: 500 } },
      render: async () => { throw new Error('disabled must not render raw') },
      submit: async () => { throw new Error('disabled must not submit') },
    }, limits)
    assert.equal(await browserAction('browser', 'disabled'), 'browser')
    assert.equal(await browserAction('browser', 'disabled'), 'browser-pending')
    assert.equal(browsers, 1)
    cleanups[0]()
    assert.equal(await browserAction('next browser', 'disabled'), 'browser')
    cleanups[0]() // A stale callback must not unlock the newer fallback.
    assert.equal(await browserAction('next browser', 'disabled'), 'browser-pending')
    cleanups[1]()
    assert.equal(await browserAction('again', 'disabled'), 'browser')
    cleanups[2]()

    const blocked = createProductReportPrintAction({ browser: async () => ({ status: 'blocked', reason: 'FONTS_NOT_READY', contentPresent: false, layoutWidth: 0, layoutHeight: 0 }) }, limits)
    await assert.rejects(blocked('browser blocked', 'disabled'), /PRINT_BROWSER_FONTS_NOT_READY/)
    await assert.rejects(blocked('browser blocked', 'disabled'), /PRINT_BROWSER_FONTS_NOT_READY/, 'failed browser action can retry')
  } finally { crypto.subtle.digest = nativeDigest; globalThis.fetch = nativeFetch }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
