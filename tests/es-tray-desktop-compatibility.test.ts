import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import {
  EshopTray02CloudClientError,
  getOrCreateEshopTray02PrintIntent,
  readEshopTray02CloudEnableState,
  submitEshopTray02CloudPrint,
  type EshopTray02Fetch,
} from '../lib/eShopTrayCloudClient'
import { parsePrintRequest } from '../lib/es-tray-relay/contract'

type FetchCall = { input: string; init?: RequestInit }

let cases = 0
async function test(name: string, run: () => void | Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function acceptedResponse(requestId: string, overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    fieldOnly: true,
    productionContract: true,
    schemaVersion: 1,
    jobId: 'job-production-001',
    requestId,
    status: 'PENDING_RECEIVE',
    created: true,
    ...overrides,
  }, 202)
}

function configFetch(body: unknown, status = 200, calls: FetchCall[] = []): EshopTray02Fetch {
  return async (input, init) => {
    calls.push({ input, init })
    return jsonResponse(body, status)
  }
}

async function main() {
  await test('config 200 with fieldOnly=true and enabled=true enables Relay', async () => {
    const calls: FetchCall[] = []
    const state = await readEshopTray02CloudEnableState(configFetch({ fieldOnly: true, enabled: true }, 200, calls))
    assert.equal(state, 'enabled')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, '/api/es-tray-02/config')
    assert.equal(calls[0].init?.method, 'GET')
    assert.equal(calls[0].init?.cache, 'no-store')
  })

  await test('config enabled=false keeps Relay disabled', async () => {
    assert.equal(
      await readEshopTray02CloudEnableState(configFetch({ fieldOnly: true, enabled: false })),
      'disabled',
    )
  })

  for (const status of [401, 403, 404, 500]) {
    await test(`config HTTP ${status} keeps Relay disabled`, async () => {
      assert.equal(
        await readEshopTray02CloudEnableState(configFetch({ error: 'unavailable' }, status)),
        'disabled',
      )
    })
  }

  await test('invalid config payload keeps Relay disabled', async () => {
    assert.equal(
      await readEshopTray02CloudEnableState(configFetch({ fieldOnly: 'true', enabled: true })),
      'disabled',
    )
  })

  await test('config network error creates no Relay intent', async () => {
    const state = await readEshopTray02CloudEnableState(async () => {
      throw new Error('offline')
    })
    assert.equal(state, 'disabled')
  })

  await test('a black-holed config request times out to the legacy path', async () => {
    const state = await readEshopTray02CloudEnableState((_input, init) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    ), 5)
    assert.equal(state, 'disabled')
  })

  const commandStream = Uint8Array.from([0x1b, 0x40, 0x0a, 0x1d, 0x56, 0x00])
  const requestId = 'desktop-order-print:11111111-2222-4333-8444-555555555555'

  await test('one submit action produces exactly one enqueue request', async () => {
    const calls: FetchCall[] = []
    const result = await submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async (input, init) => {
        calls.push({ input, init })
        return acceptedResponse(requestId)
      },
    })
    assert.deepEqual(result, { jobId: 'job-production-001', requestId, created: true })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, '/api/es-tray-02/print-jobs')
    assert.equal(calls[0].init?.method, 'POST')
  })

  await test('the same logical retry reuses its stable requestId and exact bytes', async () => {
    const intent = getOrCreateEshopTray02PrintIntent(null, 'ORDER-001', () => requestId)
    intent.commandStream = commandStream
    assert.equal(getOrCreateEshopTray02PrintIntent(intent, 'ORDER-001'), intent)

    const payloads: Record<string, unknown>[] = []
    await assert.rejects(() => submitEshopTray02CloudPrint({
      orderNo: intent.orderNo,
      requestId: intent.requestId,
      commandStream: intent.commandStream!,
      fetchImpl: async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        throw new Error('response lost')
      },
    }), (error: unknown) => (
      error instanceof EshopTray02CloudClientError
      && error.code === 'ES_TRAY_02_SUBMIT_NETWORK_FAILED'
    ))

    await submitEshopTray02CloudPrint({
      orderNo: intent.orderNo,
      requestId: intent.requestId,
      commandStream: intent.commandStream!,
      fetchImpl: async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return acceptedResponse(intent.requestId, { created: false })
      },
    })
    assert.equal(payloads.length, 2)
    assert.deepEqual(payloads[0], payloads[1])
    assert.equal(payloads[0].requestId, requestId)
  })

  await test('an idempotent replay returns the same job without a new physical intent', async () => {
    const result = await submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async () => acceptedResponse(requestId, { created: false }),
    })
    assert.equal(result.jobId, 'job-production-001')
    assert.equal(result.created, false)
  })

  await test('a conflicting idempotency payload is an explicit 409 failure', async () => {
    await assert.rejects(() => submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async () => jsonResponse({ error: 'ES_TRAY_02_IDEMPOTENCY_CONFLICT' }, 409),
    }), (error: unknown) => (
      error instanceof EshopTray02CloudClientError
      && error.code === 'ES_TRAY_02_IDEMPOTENCY_CONFLICT'
      && error.httpStatus === 409
    ))
  })

  await test('the Desktop payload is byte-for-byte compatible with the Production parser', async () => {
    let payload: Record<string, unknown> | null = null
    await submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        return acceptedResponse(requestId)
      },
    })
    const parsed = parsePrintRequest(payload)
    assert.equal(parsed.relayVersion, '0.1')
    assert.equal(parsed.orderNo, 'ORDER-001')
    assert.equal(parsed.documentName, 'E-Shop ORDER-001')
    assert.deepEqual(parsed.target, { transport: 'windows-queue', queueName: '前台' })
  })

  await test('the client never injects tenant or store identifiers', async () => {
    let payload: Record<string, unknown> = {}
    await submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        return acceptedResponse(requestId)
      },
    })
    assert.deepEqual(Object.keys(payload).sort(), [
      'commandStream', 'documentName', 'orderNo', 'relayVersion', 'requestId', 'target',
    ])
    assert.equal('tenantId' in payload, false)
    assert.equal('storeId' in payload, false)
    assert.equal('idempotencyKey' in payload, false)
  })

  await test('the target queue remains the fixed 前台 Windows queue', async () => {
    let payload: Record<string, unknown> = {}
    await submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        return acceptedResponse(requestId)
      },
    })
    assert.deepEqual(payload.target, { transport: 'windows-queue', queueName: '前台' })
  })

  await test('commandStream byteLength, digest, and base64 are exact', async () => {
    let payload: Record<string, unknown> = {}
    await submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        return acceptedResponse(requestId)
      },
    })
    const stream = payload.commandStream as Record<string, unknown>
    assert.equal(stream.encoding, 'base64')
    assert.equal(stream.byteLength, commandStream.byteLength)
    assert.equal(stream.sha256, createHash('sha256').update(commandStream).digest('hex'))
    assert.equal(stream.data, Buffer.from(commandStream).toString('base64'))
  })

  await test('an invalid success envelope is rejected', async () => {
    await assert.rejects(() => submitEshopTray02CloudPrint({
      orderNo: 'ORDER-001',
      requestId,
      commandStream,
      fetchImpl: async () => acceptedResponse(requestId, { schemaVersion: 2 }),
    }), (error: unknown) => (
      error instanceof EshopTray02CloudClientError
      && error.code === 'ES_TRAY_02_INVALID_RESPONSE'
    ))
  })

  await test('OrderDetailSheet alone owns the new config and enqueue integration', () => {
    const orderSheet = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
    assert.match(orderSheet, /readEshopTray02DeviceCloudEnableState[\s\S]*readEshopTray02CloudEnableState/)
    assert.match(orderSheet, /cloudRelayState !== 'enabled'[\s\S]*openExistingBrowserPrint\(html/)
    assert.match(orderSheet, /renderTicketHtmlToEscPosRaw\(html\)/)
    assert.match(orderSheet, /submitEshopTray02DeviceCloudPrint[\s\S]*submitEshopTray02CloudPrint/)
    assert.equal((orderSheet.match(/await submitPrint\(/g) ?? []).length, 1)
    assert.match(orderSheet, /\|\| printInFlightRef\.current[\s\S]*printInFlightRef\.current = true/)
    assert.match(orderSheet, /const printDisabled = busy \|\| cloudRelayState === 'pending'/)
  })

  await test('the existing cashier completion print path remains QZ/legacy', () => {
    const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
    assert.match(cashier, /submitDesktopReceiptPrint\(/)
    assert.doesNotMatch(cashier, /eShopTrayCloudClient|\/api\/es-tray-02\/config|\/api\/es-tray-02\/print-jobs/)
  })

  await test('the existing 补打小票 path remains DesktopReceipt browser print', () => {
    const records = fs.readFileSync('app/records/page.tsx', 'utf8')
    assert.match(records, /reprintLabel=.*'补打小票'/)
    assert.match(records, /handleSaleRecordReprint/)
    assert.match(records, /printDesktopReceipt\(/)
    assert.doesNotMatch(records, /eShopTrayCloudClient|\/api\/es-tray-02\/config|\/api\/es-tray-02\/print-jobs/)
  })

  await test('all supported locales contain the minimal Relay result messages', () => {
    for (const path of ['lib/i18n/zh.ts', 'lib/i18n/en.ts', 'lib/i18n/km.ts']) {
      const source = fs.readFileSync(path, 'utf8')
      assert.match(source, /trayRelaySubmitted:/)
      assert.match(source, /trayRelayFailed:/)
    }
  })

  console.log(`es-tray Desktop compatibility tests passed (${cases} cases)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
