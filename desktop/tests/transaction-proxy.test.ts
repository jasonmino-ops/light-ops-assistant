import { describe, expect, it } from 'vitest'
import { DesktopTransactionProxy } from '../src/main/desktopTransactionProxy'

function credentialStore() {
  return {
    readCredential: async () => ({ ok: true as const, credential: { schemaVersion: 1 as const, deviceToken: 'edt_v1_secret_not_for_renderer' } }),
  }
}

describe('Desktop transaction proxy', () => {
  it('allows a fixed POS sale operation and never returns the EDT token', async () => {
    let seenUrl = ''
    let seenHeaders: HeadersInit | undefined
    const proxy = new DesktopTransactionProxy({
      credentialStore: credentialStore() as never,
      baseUrl: 'https://example.test/',
      fetchImpl: async (url, init) => {
        seenUrl = String(url)
        seenHeaders = init?.headers
        return new Response(JSON.stringify({ orderNo: 'S-1' }), {
          status: 201,
          headers: { 'content-type': 'application/json', 'Idempotency-Replayed': 'true' },
        })
      },
    })
    const result = await proxy.request({
      operation: 'POS_SALE_CREATE',
      payload: { storeCode: 'STORE-A', items: [{ barcode: 'A', quantity: 1 }], paymentMethod: 'CASH', idempotencyKey: 'desktop-sale-test-key-001' },
    })
    expect(result).toEqual({ ok: true, status: 201, body: { orderNo: 'S-1' }, idempotencyReplayed: true })
    expect(seenUrl).toBe('https://example.test/api/cashier/sales')
    expect(new Headers(seenHeaders).get('authorization')).toBe('Bearer edt_v1_secret_not_for_renderer')
    expect(new Headers(seenHeaders).get('idempotency-key')).toBe('desktop-sale-test-key-001')
    expect(JSON.stringify(result)).not.toContain('edt_v1_secret_not_for_renderer')
  })

  it('rejects non-allowlisted operations before reading a credential or networking', async () => {
    let fetched = false
    const proxy = new DesktopTransactionProxy({
      credentialStore: credentialStore() as never,
      baseUrl: 'https://example.test',
      fetchImpl: async () => {
        fetched = true
        return new Response('{}')
      },
    })
    const result = await proxy.request({ operation: 'POS_SALE_CREATE', payload: { url: 'https://attacker.test' } })
    expect(result.error).toBe('DESKTOP_PROXY_OPERATION_REJECTED')
    expect(fetched).toBe(false)
  })

  it('opens the activation recovery path when secure EDT storage is unavailable', async () => {
    let recoveryError = ''
    const proxy = new DesktopTransactionProxy({
      credentialStore: { readCredential: async () => ({ ok: false as const, reason: 'missing' }) } as never,
      baseUrl: 'https://example.test',
      onDesktopAuthorizationFailure: (error) => { recoveryError = error },
    })
    const result = await proxy.request({
      operation: 'POS_SALE_CREATE',
      payload: { storeCode: 'STORE-A', items: [{ barcode: 'A', quantity: 1 }], paymentMethod: 'CASH', idempotencyKey: 'desktop-sale-test-key-002' },
    })
    expect(result.error).toBe('DESKTOP_DEVICE_UNAUTHORIZED')
    expect(recoveryError).toBe('DESKTOP_DEVICE_UNAUTHORIZED')
  })
})
