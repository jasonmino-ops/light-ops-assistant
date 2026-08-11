import assert from 'node:assert/strict'
import {
  clearEshopTrayBaseUrl,
  ESHOP_TRAY_STORAGE_KEY,
  ESHOP_TRAY_PROTOCOL_VERSION,
  EshopTrayClientError,
  locateEshopTray,
  normalizeEshopTrayAddress,
  normalizeEshopTrayBaseUrl,
  readSavedEshopTrayBaseUrl,
  saveEshopTrayBaseUrl,
  submitEshopTrayPrint,
  testEshopTrayConnection,
  type EshopTrayStorage,
} from '../lib/eShopTrayClient'

async function main() {
  assert.equal(normalizeEshopTrayBaseUrl('http://192.168.18.10'), 'http://192.168.18.10:17631')
  assert.equal(normalizeEshopTrayBaseUrl('http://e-shop-tray.local:17631/'), 'http://e-shop-tray.local:17631')
  assert.equal(normalizeEshopTrayBaseUrl('https://192.168.18.10:17631'), null)
  assert.equal(normalizeEshopTrayBaseUrl('http://public.example:17631'), null)
  assert.equal(normalizeEshopTrayBaseUrl('http://192.168.18.10:9000'), null)
  assert.equal(normalizeEshopTrayAddress('192.168.18.48'), 'http://192.168.18.48:17631')
  assert.equal(normalizeEshopTrayAddress(' e-shop-tray.local '), 'http://e-shop-tray.local:17631')
  assert.equal(normalizeEshopTrayAddress('192.168.18.48:9000'), null)
  assert.equal(normalizeEshopTrayAddress('public.example'), null)

  const storageValues = new Map<string, string>()
  const storage: EshopTrayStorage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
    removeItem: (key) => storageValues.delete(key),
  }
  assert.equal(saveEshopTrayBaseUrl('192.168.18.48', storage), 'http://192.168.18.48:17631')
  assert.equal(storageValues.get(ESHOP_TRAY_STORAGE_KEY), 'http://192.168.18.48:17631')
  assert.equal(readSavedEshopTrayBaseUrl(storage), 'http://192.168.18.48:17631', 'saved endpoint survives a page refresh read')
  clearEshopTrayBaseUrl(storage)
  assert.equal(readSavedEshopTrayBaseUrl(storage), null)

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
  const testedEndpoint = await testEshopTrayConnection('192.168.18.10', {
    fetchImpl: fetchImpl as typeof fetch,
  })
  assert.equal(testedEndpoint.baseUrl, 'http://192.168.18.10:17631')
  assert.equal(testedEndpoint.health.status, 'online')
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
  assert.equal(fetchCalls[2].init?.credentials, 'omit')
  assert.equal(fetchCalls[2].init?.method, 'POST')

  await assert.rejects(
    testEshopTrayConnection('192.168.18.10', {
      fetchImpl: (async () => Response.json({
        service: 'e-shop-tray',
        version: '0.1.0',
        protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
        status: 'busy',
      })) as typeof fetch,
    }),
    (error) => error instanceof EshopTrayClientError && error.code === 'TRAY_CONNECTION_FAILED',
  )
  await assert.rejects(
    testEshopTrayConnection('192.168.18.10', {
      fetchImpl: (async () => { throw new TypeError('network unavailable') }) as typeof fetch,
    }),
    (error) => error instanceof EshopTrayClientError && error.code === 'TRAY_CONNECTION_FAILED',
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
