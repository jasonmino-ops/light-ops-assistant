import { describe, expect, it, vi } from 'vitest'
import { ActivationApiClient, type FetchLike } from '../src/main/activation/activationApiClient'

const device = {
  deviceId: 'device-001',
  tenantId: 'tenant-001',
  storeId: 'store-001',
  storeCode: 'STORE-A',
  status: 'ACTIVE',
  tokenExpiresAt: '2027-01-01T00:00:00.000Z',
  credentialVersion: 1,
}

const subscription = { accessState: 'ACTIVE', status: 'ACTIVE', warning: null }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('activation API client', () => {
  it('sends activate body without logging raw payloads', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        storeCode: 'STORE-A',
        pin: '123456',
        installationId: '11111111-1111-4111-8111-111111111111',
      })
      return jsonResponse({
        deviceToken: 'test-device-token-value-777777777777',
        tokenExpiresAt: device.tokenExpiresAt,
        device,
        subscription,
      }, 201)
    }) satisfies FetchLike
    const client = new ActivationApiClient({ baseUrl: 'https://elifekh.com/', fetchImpl })
    await expect(client.activate({
      storeCode: 'STORE-A',
      pin: '123456',
      installationId: '11111111-1111-4111-8111-111111111111',
    })).resolves.toMatchObject({ ok: true, deviceToken: 'test-device-token-value-777777777777' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://elifekh.com/api/desktop/activate')
  })

  it('sends verify bearer header and maps success schema', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-device-token-value-888888888888')
      return jsonResponse({ ok: true, device, subscription })
    }) satisfies FetchLike
    const client = new ActivationApiClient({ baseUrl: 'https://elifekh.com', fetchImpl })
    await expect(client.verify({ deviceToken: 'test-device-token-value-888888888888' })).resolves.toMatchObject({
      ok: true,
      device,
    })
  })

  it('maps 4xx cloud error responses with public fields only', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'INVALID_PIN' }, 401)) satisfies FetchLike
    const client = new ActivationApiClient({ baseUrl: 'https://elifekh.com', fetchImpl })
    await expect(client.activate({
      storeCode: 'STORE-A',
      pin: '000000',
      installationId: '11111111-1111-4111-8111-111111111111',
    })).resolves.toEqual({
      ok: false,
      kind: 'HTTP',
      status: 401,
      errorCode: 'INVALID_PIN',
    })
  })

  it('distinguishes malformed JSON and malformed schema', async () => {
    const malformedJson = new ActivationApiClient({
      baseUrl: 'https://elifekh.com',
      fetchImpl: vi.fn(async () => new Response('{bad json', { status: 500 })) satisfies FetchLike,
    })
    await expect(malformedJson.verify({ deviceToken: 'test-device-token-value-999999999999' })).resolves.toMatchObject({
      ok: false,
      kind: 'MALFORMED_JSON',
      errorCode: 'MALFORMED_RESPONSE',
    })

    const malformedSchema = new ActivationApiClient({
      baseUrl: 'https://elifekh.com',
      fetchImpl: vi.fn(async () => jsonResponse({ ok: true, device: {}, subscription })) satisfies FetchLike,
    })
    await expect(malformedSchema.verify({ deviceToken: 'test-device-token-value-999999999998' })).resolves.toMatchObject({
      ok: false,
      kind: 'SCHEMA',
      errorCode: 'MALFORMED_RESPONSE',
    })
  })

  it('maps network and timeout failures separately', async () => {
    const networkClient = new ActivationApiClient({
      baseUrl: 'https://elifekh.com',
      fetchImpl: vi.fn(async () => { throw new Error('offline') }) satisfies FetchLike,
    })
    await expect(networkClient.verify({ deviceToken: 'test-device-token-value-net-0000' })).resolves.toMatchObject({
      ok: false,
      kind: 'NETWORK',
      errorCode: 'NETWORK_ERROR',
    })

    const timeoutFetch: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
    const timeoutClient = new ActivationApiClient({
      baseUrl: 'https://elifekh.com',
      fetchImpl: timeoutFetch,
      timeoutMs: 1,
    })
    await expect(timeoutClient.verify({ deviceToken: 'test-device-token-value-timeout' })).resolves.toMatchObject({
      ok: false,
      kind: 'TIMEOUT',
      errorCode: 'REQUEST_TIMEOUT',
    })
  })
})
