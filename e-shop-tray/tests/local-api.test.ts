import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createLocalApi,
  ESHOP_TRAY_ALLOWED_ORIGINS,
  ESHOP_TRAY_FIELD_SANDBOX_ORIGIN,
  ESHOP_TRAY_PROTOCOL_VERSION,
  type PrintTransport,
} from '../src/localApi'
import type { PrintDelivery } from '../src/printing/windowsQueueTransport'

const ORIGIN = 'https://elifekh.com'
const servers: ReturnType<typeof createLocalApi>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

function requestBody(bytes: Uint8Array, requestId = 'tray-test-1') {
  const buffer = Buffer.from(bytes)
  return {
    protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
    requestId,
    commandStream: {
      encoding: 'base64',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      data: buffer.toString('base64'),
    },
  }
}

async function start(transport: PrintTransport, allowedOrigins?: ReadonlySet<string>) {
  const server = createLocalApi({
    version: '0.1.0-test',
    transport,
    allowedOrigins,
    logger: { info() {}, warn() {}, error() {} },
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

function fakeTransport(deliver?: (bytes: Uint8Array) => Promise<PrintDelivery>): PrintTransport {
  return {
    isBusy: () => false,
    deliver: async (bytes) => deliver?.(bytes) ?? ({
      transport: 'windows-queue',
      bytesWritten: bytes.byteLength,
      durationMs: 3,
    }),
  }
}

describe('E-Shop Tray Local API V0.1', () => {
  it('allows only the exact FIELD-SANDBOX Preview origin in the sandbox variant', async () => {
    expect(ESHOP_TRAY_ALLOWED_ORIGINS.has(ESHOP_TRAY_FIELD_SANDBOX_ORIGIN)).toBe(false)
    const fieldSandboxOrigins = new Set([
      ...ESHOP_TRAY_ALLOWED_ORIGINS,
      ESHOP_TRAY_FIELD_SANDBOX_ORIGIN,
    ])
    const baseUrl = await start(fakeTransport(), fieldSandboxOrigins)
    const bytes = Uint8Array.from([0x1b, 0x40, 0x1d, 0x56, 0x00])

    for (const [index, origin] of [ORIGIN, ESHOP_TRAY_FIELD_SANDBOX_ORIGIN].entries()) {
      const health = await fetch(`${baseUrl}/v1/health`, { headers: { Origin: origin } })
      expect(health.status).toBe(200)
      expect(health.headers.get('access-control-allow-origin')).toBe(origin)
      expect(await health.json()).toMatchObject({
        service: 'e-shop-tray',
        protocolVersion: '0.1',
        status: 'online',
      })

      const print = await fetch(`${baseUrl}/v1/print`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-E-Shop-Tray-Protocol': '0.1',
        },
        body: JSON.stringify(requestBody(bytes, `field-sandbox-${index}`)),
      })
      expect(print.status).toBe(200)
      expect(await print.json()).toMatchObject({
        protocolVersion: '0.1',
        status: 'success',
        delivery: { transport: 'windows-queue', bytesWritten: bytes.byteLength },
      })
    }

    const preflight = await fetch(`${baseUrl}/v1/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: ESHOP_TRAY_FIELD_SANDBOX_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ESHOP_TRAY_FIELD_SANDBOX_ORIGIN)

    for (const origin of [
      'https://light-ops-assistant-random.vercel.app',
      'https://unknown.example',
    ]) {
      const health = await fetch(`${baseUrl}/v1/health`, { headers: { Origin: origin } })
      expect(health.status).toBe(403)
      expect(health.headers.get('access-control-allow-origin')).toBeNull()

      const print = await fetch(`${baseUrl}/v1/print`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-E-Shop-Tray-Protocol': '0.1',
        },
        body: JSON.stringify(requestBody(bytes, `rejected-${origin.length}`)),
      })
      expect(print.status).toBe(403)
      expect(await print.json()).toMatchObject({ error: { code: 'ORIGIN_FORBIDDEN' } })
    }
  })

  it('reports health with narrow CORS and private-network compatibility headers', async () => {
    const baseUrl = await start(fakeTransport())
    const response = await fetch(`${baseUrl}/v1/health`, { headers: { Origin: ORIGIN } })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await response.json()).toEqual({
      service: 'e-shop-tray',
      version: '0.1.0-test',
      protocolVersion: '0.1',
      status: 'online',
    })

    const preflight = await fetch(`${baseUrl}/v1/print`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('delivers the exact existing command stream once', async () => {
    const original = Uint8Array.from([0x1b, 0x40, 0x00, 0xff, 0x1d, 0x56, 0x00])
    let delivered: Uint8Array | null = null
    const baseUrl = await start(fakeTransport(async (bytes) => {
      delivered = Uint8Array.from(bytes)
      return { transport: 'windows-queue', bytesWritten: bytes.byteLength, durationMs: 4 }
    }))
    const response = await fetch(`${baseUrl}/v1/print`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'X-E-Shop-Tray-Protocol': '0.1',
      },
      body: JSON.stringify(requestBody(original)),
    })
    expect(response.status).toBe(200)
    expect(delivered).toEqual(original)
    expect(await response.json()).toMatchObject({
      protocolVersion: '0.1',
      requestId: 'tray-test-1',
      status: 'success',
      delivery: { transport: 'windows-queue', bytesWritten: original.byteLength },
    })
  })

  it('rejects untrusted origins, absent browser origins, and altered command streams', async () => {
    const baseUrl = await start(fakeTransport())
    const bytes = Uint8Array.from([1, 2, 3])
    const body = requestBody(bytes)

    for (const origin of ['https://attacker.example', null]) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-E-Shop-Tray-Protocol': '0.1',
      }
      if (origin) headers.Origin = origin
      const response = await fetch(`${baseUrl}/v1/print`, {
        method: 'POST', headers, body: JSON.stringify(body),
      })
      expect(response.status).toBe(403)
    }

    const altered = structuredClone(body)
    altered.commandStream.sha256 = '0'.repeat(64)
    const response = await fetch(`${baseUrl}/v1/print`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'X-E-Shop-Tray-Protocol': '0.1',
      },
      body: JSON.stringify(altered),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'COMMAND_STREAM_DIGEST_MISMATCH' } })
  })

  it('rejects DNS-rebinding host headers and concurrent work instead of queueing', async () => {
    const busyTransport: PrintTransport = {
      isBusy: () => true,
      deliver: async () => { throw new Error('must not run') },
    }
    const baseUrl = await start(busyTransport)
    const body = JSON.stringify(requestBody(Uint8Array.from([1])))
    const busy = await fetch(`${baseUrl}/v1/print`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'X-E-Shop-Tray-Protocol': '0.1',
      },
      body,
    })
    expect(busy.status).toBe(409)
    expect(await busy.json()).toMatchObject({ error: { code: 'TRAY_BUSY' } })

    const server = servers[0]
    const address = server.address() as AddressInfo
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1',
        port: address.port,
        path: '/v1/health',
        headers: { Host: 'public.example', Origin: ORIGIN },
      }, (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode))
      })
      request.once('error', reject)
      request.end()
    })
    expect(reboundStatus).toBe(421)
  })
})
