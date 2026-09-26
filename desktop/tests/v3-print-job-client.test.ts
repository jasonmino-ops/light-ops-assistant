import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { logger } from '../src/main/logger'
import { V3PrintJobClient } from '../src/main/printing/v3PrintJobClient'

const batch = {
  id: 'batch-a', controlPlaneId: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: 'device-a',
  ownerEpoch: 4, stateVersion: 9, leaseId: 'lease-a', mode: 'V3_ACTIVE' as const,
  expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
}

function reprintResponse(role: 'FRONT' | 'KITCHEN') {
  const bytes = Buffer.from(`${role} reprint`)
  const printJobId = `v3-reprint:${role.toLowerCase()}:11111111-2222-4333-8444-555555555555`
  return new Response(JSON.stringify({
    ok: true,
    job: {
      id: `row-${role.toLowerCase()}`,
      printJobId,
      expiresAt: '2099-01-01T00:00:00.000Z',
      intent: {
        schemaVersion: 3, printJobId, source: 'CLOUD_REMOTE_REPRINT', role, payloadKind: 'RAW_BYTES',
        orderNo: 'ORDER-REPRINT-001', rendererVersion: 'reprint-raw-v1', payloadBase64: bytes.toString('base64'),
        byteLength: bytes.length, payloadHash: createHash('sha256').update(bytes).digest('hex'),
      },
    },
  }), { status: 200 })
}

describe('V3PrintJobClient receive', () => {
  it.each(['FRONT', 'KITCHEN'] as const)('accepts a valid role-specific CLOUD_REMOTE_REPRINT %s claim', async (role) => {
    const client = new V3PrintJobClient('https://example.test', 'credential-value', async () => reprintResponse(role))
    const result = await client.receive(batch)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.job).toMatchObject({
        printJobId: `v3-reprint:${role.toLowerCase()}:11111111-2222-4333-8444-555555555555`,
        source: 'CLOUD_REMOTE_REPRINT', role, payloadKind: 'RAW_BYTES',
      })
    }
  })

  it('surfaces a normalized HTTP failure without logging credentials or response bodies', async () => {
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const client = new V3PrintJobClient('https://example.test', 'credential-value', async (_url, init) => {
      expect(init?.headers).toMatchObject({ Accept: 'application/json', Authorization: 'Bearer credential-value' })
      return new Response(JSON.stringify({ ok: false, error: 'V3_BATCH_STALE', detail: 'must-not-be-logged' }), { status: 409 })
    })
    await expect(client.receive(batch)).resolves.toEqual({
      ok: false,
      error: { operation: 'RECEIVE', category: 'HTTP', code: 'V3_BATCH_STALE', httpStatus: 409 },
    })
    expect(warning).toHaveBeenCalledWith('v3-print-jobs.receive-failed', {
      operation: 'RECEIVE', category: 'HTTP', code: 'V3_BATCH_STALE', httpStatus: 409,
    })
    const logged = JSON.stringify(warning.mock.calls)
    expect(logged).not.toContain('credential-value')
    expect(logged).not.toContain('must-not-be-logged')
    warning.mockRestore()
  })

  it('distinguishes protocol and network failures without exposing thrown error text', async () => {
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const invalid = new V3PrintJobClient('https://example.test', 'credential-value', async () =>
      new Response(JSON.stringify({ ok: true, job: { malformed: true } }), { status: 200 }))
    await expect(invalid.receive(batch)).resolves.toEqual({
      ok: false,
      error: { operation: 'RECEIVE', category: 'PROTOCOL', code: 'V3_RECEIVE_INVALID_RESPONSE', httpStatus: 200 },
    })
    const offline = new V3PrintJobClient('https://example.test', 'credential-value', async () => {
      throw new Error('sensitive transport detail')
    })
    await expect(offline.receive(batch)).resolves.toEqual({
      ok: false,
      error: { operation: 'RECEIVE', category: 'NETWORK', code: 'V3_RECEIVE_NETWORK_ERROR' },
    })
    expect(JSON.stringify(warning.mock.calls)).not.toContain('sensitive transport detail')
    warning.mockRestore()
  })
})

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
