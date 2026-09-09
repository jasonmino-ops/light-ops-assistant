import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { CloudRelayClient, CloudRelayError, readCloudRelayConfig } from '../src/cloudRelayClient'
import { NETWORK_MODE_GUARD_CLIENT_VERSION } from '../src/networkContract'

const token = `ecp_v1_${'q'.repeat(43)}`
const bytes = Buffer.from([0x1b, 0x40])
const request = {
  relayVersion: '0.1',
  requestId: 'request-0001',
  orderNo: 'ORDER-001',
  documentName: 'receipt',
  target: { transport: 'windows-queue', queueName: '前台' },
  commandStream: {
    encoding: 'base64',
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    data: bytes.toString('base64'),
  },
}
const responseJob = {
  productionContract: true,
  schemaVersion: 1,
  job: {
    id: 'relay-job-0001',
    schemaVersion: 1,
    idempotencyKey: request.requestId,
    requestHash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    claimAttempt: 1,
    claimToken: token,
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    request,
  },
}

function client(fetchImpl: typeof fetch) {
  return new CloudRelayClient({
    config: { baseUrl: 'https://relay.example.test' },
    credential: { installationId: 'installation-0000001', deviceSecret: `ecc_v1_${'s'.repeat(43)}` },
    fetchImpl,
  })
}

describe('cold conversion Network-only queue and receive guards', () => {
  const body = { productionContract: true, schemaVersion: 2, bindingId: 'bound-device', storeCode: 'STORE-TEST' }
  const network = (fetchImpl: typeof fetch) => new CloudRelayClient({
    config: { baseUrl: 'https://relay.example.test' }, credential: { installationId: 'installation-test', deviceSecret: 'ecc_v1_test-only' },
    network: { bindingId: body.bindingId, storeCode: body.storeCode }, fetchImpl,
  })
  it('readiness is authenticated GET/no-store/no-body and returns only exact store counts', async () => {
    const relay = network(async (_url, init) => {
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
      expect(init?.body).toBeUndefined()
      const headers = new Headers(init?.headers)
      expect(headers.get('x-es-tray-version')).toBe(NETWORK_MODE_GUARD_CLIENT_VERSION)
      expect(headers.get('x-installation-id')).toBe('installation-test')
      expect(headers.get('authorization')).toBe('Bearer ecc_v1_test-only')
      return Response.json({ ...body, observedAt: new Date().toISOString(), queue: { pending: 1, claimed: 2, executing: 3, unknown: 4 } })
    })
    await expect(relay.networkQueueState()).resolves.toEqual({ pending: 1, claimed: 2, executing: 3, unknown: 4 })
  })
  it.each(['store', 'binding', 'negative', 'fraction', 'extra', 'schema', 'date'])('rejects %s readiness mismatch without claiming', async mutation => {
    const response = { ...body, observedAt: new Date().toISOString(), queue: { pending: 0, claimed: 0, executing: 0, unknown: 0 } } as Record<string, unknown>
    if (mutation === 'store') response.storeCode = 'OTHER'
    if (mutation === 'binding') response.bindingId = 'OTHER'
    if (mutation === 'schema') response.schemaVersion = 1
    if (mutation === 'date') response.observedAt = 'not-a-date'
    if (mutation === 'negative') (response.queue as Record<string, number>).pending = -1
    if (mutation === 'fraction') (response.queue as Record<string, number>).unknown = 0.5
    if (mutation === 'extra') response.host = '10.1.1.5'
    const calls: string[] = []
    await expect(network(async (_url, init) => { calls.push(init!.method!); return Response.json(response) }).networkQueueState())
      .rejects.toThrow('NETWORK_INVALID_QUEUE_STATE')
    expect(calls).toEqual(['GET'])
  })
  it.each(['FRONT_ONLY', 'SHARED_PRINTER'] as const)('guarded %s receive uses the new rejected-by-old-server version and requires its exact echo', async mode => {
    const relay = network(async (_url, init) => {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('x-es-tray-version')).toBe(NETWORK_MODE_GUARD_CLIENT_VERSION)
      expect(new Headers(init?.headers).get('x-es-network-mode')).toBe(mode)
      return Response.json({ ...body, modeGuard: mode, job: null })
    })
    await expect(relay.receive(mode)).resolves.toBeNull()
    for (const reply of [{ ...body, job: null }, { ...body, modeGuard: 'OTHER', job: null }]) {
      await expect(network(async () => Response.json(reply)).receive(mode)).rejects.toThrow('NETWORK_INVALID_RESPONSE')
    }
  })
  it('unextended v2 remains its previous request/response; v1 cannot invoke a Network control', async () => {
    await expect(network(async (_url, init) => {
      expect(new Headers(init?.headers).get('x-es-tray-version')).toBe('network-0.1.1')
      expect(new Headers(init?.headers).has('x-es-network-mode')).toBe(false)
      return Response.json({ ...body, job: null })
    }).receive()).resolves.toBeNull()
    const fetchImpl = vi.fn()
    await expect(client(fetchImpl).networkQueueState()).rejects.toThrow('NETWORK_MODE_GUARD_REQUIRES_V2')
    await expect(client(fetchImpl).receive('FRONT_ONLY')).rejects.toThrow('NETWORK_MODE_GUARD_REQUIRES_V2')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('old-server 426 is returned, not retried with a legacy client version', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: 'ES_TRAY_02_CLIENT_UPGRADE_REQUIRED' }, { status: 426 }))
    await expect(network(fetchImpl).receive('FRONT_ONLY')).rejects.toMatchObject({ code: 'ES_TRAY_02_CLIENT_UPGRADE_REQUIRED', httpStatus: 426 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('Tray 0.1.3 cloud relay client', () => {
  it('accepts only an HTTPS origin configuration', () => {
    expect(readCloudRelayConfig({ ES_TRAY_02_CLOUD_URL: 'https://relay.example.test' })).toEqual({ baseUrl: 'https://relay.example.test' })
    expect(readCloudRelayConfig({ ES_TRAY_02_CLOUD_URL: 'https://relay.example.test/path' })).toBeNull()
    expect(readCloudRelayConfig({ ES_TRAY_02_CLOUD_URL: 'http://relay.example.test' })).toBeNull()
  })

  it('receives and validates a claim using ComputerBinding credentials', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('x-installation-id')).toBe('installation-0000001')
      expect(headers.get('x-es-tray-version')).toBe('0.1.3')
      expect(headers.get('authorization')).toMatch(/^Bearer ecc_v1_/)
      return new Response(JSON.stringify(responseJob), { status: 200 })
    }) as unknown as typeof fetch
    const received = await client(fetchImpl).receive()
    expect(received?.claimToken).toBe(token)
    expect(received?.commandStream).toEqual(Uint8Array.from(bytes))
  })

  it('uses the executing and result endpoints with claim proof', async () => {
    const paths: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      paths.push(String(input))
      const body = JSON.parse(String(init?.body))
      expect(body.claimAttempt).toBe(1)
      expect(body.claimToken).toBe(token)
      const status = String(input).endsWith('/executing') ? 'EXECUTING' : body.state
      return new Response(JSON.stringify({ productionContract: true, job: { status } }), { status: 200 })
    }) as unknown as typeof fetch
    const relay = client(fetchImpl)
    const proof = { id: 'relay-job-0001', claimAttempt: 1, claimToken: token }
    await relay.markExecuting(proof)
    await relay.reportResult(proof, {
      state: 'SUCCEEDED',
      resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
      effectBoundary: 'CROSSED',
      physicalCompletionKnown: false,
    })
    expect(paths).toEqual([
      'https://relay.example.test/api/es-tray-02/print-jobs/relay-job-0001/executing',
      'https://relay.example.test/api/es-tray-02/print-jobs/relay-job-0001/result',
    ])
  })

  it('rejects tampered jobs and never invokes the Windows layer', async () => {
    const tampered = structuredClone(responseJob)
    tampered.job.requestHash = '0'.repeat(64)
    const relay = client(async () => new Response(JSON.stringify(tampered), { status: 200 }))
    await expect(relay.receive()).rejects.toBeInstanceOf(CloudRelayError)
  })

  it('retains HTTP status and bounded server code for ACK recovery decisions', async () => {
    const relay = client(async () => new Response(JSON.stringify({ error: 'ES_TRAY_02_STALE_CLAIM' }), { status: 409 }))
    await expect(relay.reportResult(
      { id: 'relay-job-0001', claimAttempt: 1, claimToken: token },
      { state: 'FAILED', resultCode: 'FAILED', effectBoundary: 'NOT_CROSSED', physicalCompletionKnown: false },
    )).rejects.toMatchObject({ code: 'ES_TRAY_02_STALE_CLAIM', httpStatus: 409 })
  })
})
