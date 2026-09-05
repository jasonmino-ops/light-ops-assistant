import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { CloudRelayClient, CloudRelayError, readCloudRelayConfig } from '../src/cloudRelayClient'

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
