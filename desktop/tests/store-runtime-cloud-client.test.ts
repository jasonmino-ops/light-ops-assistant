import { describe, expect, it, vi } from 'vitest'
import { StoreRuntimeCloudClient, StoreRuntimeCloudError, type StoreRuntimeFetch } from '../src/main/storeRuntime/cloudClient'

const device = {
  deviceId: 'device-001',
  tenantId: 'tenant-001',
  storeId: 'store-001',
  storeCode: 'STORE-A',
  status: 'ACTIVE',
  tokenExpiresAt: '2027-01-01T00:00:00.000Z',
  credentialVersion: 1,
}

const binding = {
  id: 'binding-001',
  tenantId: device.tenantId,
  storeId: device.storeId,
  targetType: 'WINDOWS_QUEUE',
  printerName: 'EPSON TM-T82',
  enabled: true,
  version: 1,
  updatedAt: '2026-08-11T00:00:00.000Z',
}

const receipt = {
  schemaVersion: '1',
  receiptId: 'receipt-001',
  storeName: 'E-Shop 测试店',
  storeCode: device.storeCode,
  timestamp: '2026-08-11T00:00:00.000Z',
  currencyCode: 'USD',
  items: [{ name: 'កាហ្វេ / 咖啡', quantity: 1, unitPrice: 2.5, lineTotal: 2.5 }],
  subtotal: 2.5,
  total: 2.5,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Store Runtime cloud client', () => {
  it('reuses the encrypted device bearer identity for bootstrap and task claim', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer encrypted-store-device-token')
      if (url.endsWith('/bootstrap')) {
        return jsonResponse({ runtime: { device, store: { id: device.storeId, code: device.storeCode, name: 'Store A', status: 'ACTIVE' } }, binding })
      }
      return jsonResponse({
        binding,
        task: {
          id: 'task-0001',
          tenantId: device.tenantId,
          storeId: device.storeId,
          taskType: 'PRINT_RECEIPT',
          schemaVersion: 1,
          idempotencyKey: 'receipt:order-0001',
          payload: { receipt },
          printerBinding: { id: binding.id, version: 1, targetType: 'WINDOWS_QUEUE', printerName: binding.printerName },
          status: 'ACCEPTED',
          claimedByDeviceId: device.deviceId,
          leaseExpiresAt: '2026-08-11T00:01:00.000Z',
          attemptCount: 1,
          acceptedAt: '2026-08-11T00:00:00.000Z',
          executingAt: null,
          completedAt: null,
          result: null,
          createdAt: '2026-08-11T00:00:00.000Z',
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
      })
    }) satisfies StoreRuntimeFetch
    const client = new StoreRuntimeCloudClient({
      baseUrl: 'https://elifekh.com/',
      deviceToken: 'encrypted-store-device-token',
      fetchImpl,
    })

    await expect(client.bootstrap()).resolves.toMatchObject({ binding, runtime: { device } })
    await expect(client.claimTask()).resolves.toMatchObject({ task: { id: 'task-0001', payload: { receipt } } })
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://elifekh.com/api/store-runtime/runtime/bootstrap',
      'https://elifekh.com/api/store-runtime/runtime/tasks/claim',
    ])
  })

  it('reports execution results without claiming physical completion', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        state: 'SUCCEEDED',
        resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
        effectBoundary: 'CROSSED',
        physicalCompletionKnown: false,
      })
      return jsonResponse({ task: { id: 'task-0001' } })
    }) satisfies StoreRuntimeFetch
    const client = new StoreRuntimeCloudClient({ baseUrl: 'https://elifekh.com', deviceToken: 'device-token', fetchImpl })
    await client.reportResult('task-0001', {
      state: 'SUCCEEDED',
      resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
      effectBoundary: 'CROSSED',
      physicalCompletionKnown: false,
    })
  })

  it('rejects malformed tasks and maps Cloud/network failures to stable codes', async () => {
    const invalidClient = new StoreRuntimeCloudClient({
      baseUrl: 'https://elifekh.com',
      deviceToken: 'device-token',
      fetchImpl: vi.fn(async () => jsonResponse({ binding, task: { taskType: 'RUN_SCRIPT' } })) satisfies StoreRuntimeFetch,
    })
    await expect(invalidClient.claimTask()).rejects.toMatchObject({ code: 'CLOUD_RESPONSE_INVALID' })

    const deniedClient = new StoreRuntimeCloudClient({
      baseUrl: 'https://elifekh.com',
      deviceToken: 'device-token',
      fetchImpl: vi.fn(async () => jsonResponse({ error: 'DESKTOP_DEVICE_REVOKED' }, 403)) satisfies StoreRuntimeFetch,
    })
    await expect(deniedClient.heartbeat()).rejects.toEqual(new StoreRuntimeCloudError('DESKTOP_DEVICE_REVOKED', 403))

    const offlineClient = new StoreRuntimeCloudClient({
      baseUrl: 'https://elifekh.com',
      deviceToken: 'device-token',
      fetchImpl: vi.fn(async () => { throw new Error('secret network details') }) satisfies StoreRuntimeFetch,
    })
    await expect(offlineClient.heartbeat()).rejects.toMatchObject({ code: 'CLOUD_NETWORK_ERROR' })
  })

  it('requires HTTPS except for explicit localhost development', () => {
    expect(() => new StoreRuntimeCloudClient({
      baseUrl: 'http://cloud.example.com',
      deviceToken: 'device-token',
    })).toThrowError(expect.objectContaining({ code: 'CLOUD_BASE_URL_INSECURE' }))
    expect(() => new StoreRuntimeCloudClient({
      baseUrl: 'http://127.0.0.1:3000',
      deviceToken: 'device-token',
    })).not.toThrow()
  })
})
