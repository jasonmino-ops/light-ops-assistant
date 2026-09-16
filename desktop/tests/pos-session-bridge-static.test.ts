import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PosSessionBridge } from '../src/main/posSessionBridge'

const source = (relative: string) => readFileSync(join(__dirname, '..', relative), 'utf8')
const bridgeSource = source('src/main/posSessionBridge.ts')
const ipcRouterSource = source('src/main/ipcRouter.ts')
const channelsSource = source('src/shared/ipcChannels.ts')
const preloadSource = source('src/preload/employeePreload.ts')
const customerPreloadSource = source('src/preload/customerPreload.ts')
const endpointSource = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'pos-session', 'desktop', 'route.ts'),
  'utf8',
)
const revokeSource = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'desktop', 'devices', '[id]', 'revoke', 'route.ts'),
  'utf8',
)

const derivedToken = `${'a'.repeat(96)}.${'b'.repeat(43)}`
const payload = {
  ok: true,
  browserDeviceId: 'desktop-device-123',
  storeCode: 'STORE-A',
  token: derivedToken,
  expiresAt: '2027-01-01T00:00:00.000Z',
}

describe('Desktop managed POS-session bridge', () => {
  it('uses the safeStorage credential only as the main-process Authorization header', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    const bridge = new PosSessionBridge({
      baseUrl: 'https://example.test/',
      credentialReader: {
        readCredential: async () => ({
          ok: true as const,
          credential: { schemaVersion: 1 as const, deviceToken: `edt_v1_${'c'.repeat(43)}` },
        }),
      },
      fetchImpl,
    })

    await bridge.prepare()
    expect(await bridge.take()).toEqual({
      browserDeviceId: payload.browserDeviceId,
      storeCode: payload.storeCode,
      token: payload.token,
      expiresAt: payload.expiresAt,
    })
    expect(await bridge.take()).toBeNull()
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/api/pos-session/desktop',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: `Bearer edt_v1_${'c'.repeat(43)}` }),
      }),
    )
  })

  it('does not call the adapter without a readable credential and rejects malformed payloads', async () => {
    const missingFetch = vi.fn()
    const missing = new PosSessionBridge({
      baseUrl: 'https://example.test',
      credentialReader: { readCredential: async () => ({ ok: false as const, reason: 'missing' }) },
      fetchImpl: missingFetch,
    })
    expect(await missing.take()).toBeNull()
    expect(missingFetch).not.toHaveBeenCalled()

    const malformed = new PosSessionBridge({
      baseUrl: 'https://example.test',
      credentialReader: {
        readCredential: async () => ({
          ok: true as const,
          credential: { schemaVersion: 1 as const, deviceToken: `edt_v1_${'d'.repeat(43)}` },
        }),
      },
      fetchImpl: async () => new Response(JSON.stringify({ ...payload, browserDeviceId: 'forged' })),
    })
    expect(await malformed.take()).toBeNull()
  })

  it('keeps the Desktop credential in main and exposes only the derived session through one channel', () => {
    expect(channelsSource).toContain("POS_SESSION_TAKE: 'eshop:pos-session:take'")
    expect(ipcRouterSource).toContain('new CredentialStore')
    expect(ipcRouterSource).toContain('new PosSessionBridge')
    expect(ipcRouterSource).toContain("authorize(windowManager, event, IPC_CHANNELS.POS_SESSION_TAKE, 'invoke')")
    expect(ipcRouterSource).toContain("!== 'employee'")
    expect(ipcRouterSource).toContain('event.senderFrame')
    expect(ipcRouterSource).toContain('isAllowedNavigation(event.senderFrame.url, config)')
    expect(preloadSource).toContain("'eshop:pos-session:take'")
    expect(preloadSource).toContain("window.localStorage.setItem('cashier:deviceId'")
    expect(preloadSource).toContain('cashier:posDeviceToken:${value.storeCode}')
    expect(preloadSource).toContain('window.location.reload()')
    expect(preloadSource).not.toContain('edt_v1_')
    expect(preloadSource).not.toMatch(/exposeInMainWorld\([^\n]+(?:posDeviceToken|deviceToken|posSession)/i)
    expect(customerPreloadSource).not.toContain('eshop:pos-session:take')
    expect(bridgeSource).not.toMatch(/logger|console\.|argv|location\./)
  })

  it('derives scope server-side, serializes issuance/revoke, and cascades revocation', () => {
    expect(endpointSource).toContain('getDesktopDeviceContext(req)')
    expect(endpointSource).toContain('FOR UPDATE')
    expect(endpointSource).toContain('browserDeviceIdForDesktop(device.id)')
    expect(endpointSource).toContain("issuedBy: 'DESKTOP_DEVICE'")
    expect(endpointSource).toContain('issuedByUserId: null')
    expect(endpointSource).not.toMatch(/req\.json|searchParams|x-tenant-id|x-store-id/)
    expect(revokeSource).toContain('browserDeviceId: `desktop-${device.id}`')
    expect(revokeSource).toContain("revocationReason: 'DESKTOP_DEVICE_REVOKED'")
    expect(revokeSource).toContain('activeSlot: null')
  })
})
