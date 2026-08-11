import assert from 'node:assert/strict'
import {
  ESHOP_TRAY_PROTOCOL_VERSION,
  locateEshopTray,
  normalizeEshopTrayBaseUrl,
  submitEshopTrayPrint,
} from '../lib/eShopTrayClient'

async function main() {
  assert.equal(normalizeEshopTrayBaseUrl('http://192.168.18.10'), 'http://192.168.18.10:17631')
  assert.equal(normalizeEshopTrayBaseUrl('http://e-shop-tray.local:17631/'), 'http://e-shop-tray.local:17631')
  assert.equal(normalizeEshopTrayBaseUrl('https://192.168.18.10:17631'), null)
  assert.equal(normalizeEshopTrayBaseUrl('http://public.example:17631'), null)
  assert.equal(normalizeEshopTrayBaseUrl('http://192.168.18.10:9000'), null)

  const fetchCalls: Array<{ url: string; init?: RequestInit & { targetAddressSpace?: string } }> = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url.endsWith('/v1/health')) {
      return Response.json({
        service: 'e-shop-tray',
        version: '0.1.0',
        protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
        status: 'online',
      })
    }
    const body = JSON.parse(String(init?.body)) as {
      requestId: string
      commandStream: { byteLength: number }
    }
    return Response.json({
      protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
      requestId: body.requestId,
      status: 'success',
      delivery: {
        transport: 'windows-queue',
        bytesWritten: body.commandStream.byteLength,
        durationMs: 5,
      },
    })
  }

  const endpoint = await locateEshopTray({
    candidates: ['http://192.168.18.10:17631'],
    fetchImpl: fetchImpl as typeof fetch,
  })
  assert.ok(endpoint)
  const bytes = Uint8Array.from([0x1b, 0x40, 0x00, 0xff, 0x1d, 0x56, 0x00])
  const snapshot = Uint8Array.from(bytes)
  const result = await submitEshopTrayPrint(endpoint, bytes, {
    fetchImpl: fetchImpl as typeof fetch,
    requestId: 'browser-test-1',
  })
  assert.equal(result.status, 'success')
  assert.equal(result.delivery.bytesWritten, bytes.byteLength)
  assert.deepEqual(bytes, snapshot, 'Runtime Client must not mutate the existing command stream')
  assert.equal(fetchCalls[0].init?.targetAddressSpace, 'local')
  assert.equal(fetchCalls[1].init?.targetAddressSpace, 'local')
  assert.equal(fetchCalls[1].init?.credentials, 'omit')
  assert.equal(fetchCalls[1].init?.method, 'POST')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
