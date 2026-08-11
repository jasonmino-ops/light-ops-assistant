import { describe, expect, it, vi } from 'vitest'
import { CloudRelayClient, CloudRelayError } from '../src/cloud/cloudClient'

describe('FIELD Cloud Relay client', () => {
  it('uses only HTTPS Cloud endpoints and bearer device auth', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => Response.json({
      runtime: { device: { deviceId: 'device-1', tenantId: 'tenant-1', storeId: 'store-1', storeCode: 'ST169E7000', status: 'ACTIVE', tokenExpiresAt: '2027-01-01T00:00:00.000Z', credentialVersion: 1 } },
    }))
    const client = new CloudRelayClient({ baseUrl: 'https://elifekh.com', fetchImpl: fetchImpl as never })
    await client.bootstrap('device-token-secret')
    expect(fetchImpl).toHaveBeenCalledWith('https://elifekh.com/api/store-runtime/runtime/bootstrap', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer device-token-secret' }),
    }))
  })

  it('rejects public HTTP Cloud origins', () => {
    expect(() => new CloudRelayClient({ baseUrl: 'http://elifekh.com' })).toThrowError(CloudRelayError)
  })
})
