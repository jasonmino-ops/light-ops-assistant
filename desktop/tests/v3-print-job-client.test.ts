import { describe, expect, it, vi } from 'vitest'
import { V3PrintJobClient } from '../src/main/printing/v3PrintJobClient'

describe('V3PrintJobClient durable HELD admission', () => {
  const input = {
    orderNo: 'ORDER-001', printJobId: 'network:canonical-001', role: 'FRONT' as const,
    rendererVersion: 'network-1', expiresAt: '2099-01-01T00:00:00.000Z', payload: new Uint8Array([1, 2, 3]),
  }

  it.each(['DURABLY_HELD', 'DURABLY_ACCEPTED'] as const)('accepts only explicit server durability status %s', async (status) => {
    let requestBody = ''
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body)
      return new Response(JSON.stringify({ ok: true, status }), { status: 200 })
    })
    const client = new V3PrintJobClient('https://example.test', 'token', fetchImpl)
    await expect(client.holdLocal(input)).resolves.toBe(status)
    const body = JSON.parse(requestBody)
    expect(body).toMatchObject({ action: 'HOLD_LOCAL', orderNo: 'ORDER-001', printJobId: 'network:canonical-001', role: 'FRONT' })
    expect(body).not.toHaveProperty('host')
    expect(body).not.toHaveProperty('port')
  })

  it.each([
    new Response(JSON.stringify({ ok: false, error: 'MODE_BLOCKED' }), { status: 409 }),
    new Response(JSON.stringify({ ok: true, status: 'REJECTED' }), { status: 200 }),
  ])('does not promote rejection to durable acceptance', async (response) => {
    const client = new V3PrintJobClient('https://example.test', 'token', async () => response.clone())
    await expect(client.holdLocal(input)).resolves.toBeNull()
  })

  it('fails closed when durable admission is unavailable', async () => {
    const client = new V3PrintJobClient('https://example.test', 'token', async () => { throw new Error('offline') })
    await expect(client.holdLocal(input)).resolves.toBeNull()
  })
})
