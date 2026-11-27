import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { TrustedPrintOrigins } from '../src/main/printing/trustedPrintOrigins'

const cutoff = '2026-11-24T00:00:00.000Z'
const scope = { tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: 'bound-device', executionStartAt: cutoff }
const base = 'https://shop.example'
const effect = (no: string, role: string) => 'network:' + createHash('sha256').update('cashier-network-v2:' + no + ':' + role).digest('hex')
const frame = { url: base + '/cashier' }
function harness() {
  let observe!: (e: any) => void
  const webRequest = { onBeforeSendHeaders() {}, onResponseStarted(_filter: unknown, cb: (e: any) => void) { observe = cb } }
  const origins = new TrustedPrintOrigins()
  origins.attach({ id: 41, mainFrame: frame, isDestroyed: () => false, session: { webRequest } } as any, base)
  const send = (no: string, delta: number, overrides = {}, roles = ['FRONT', 'KITCHEN']) => {
    const fact = { tenantId: scope.tenantId, storeId: scope.storeId, deviceId: scope.ownerDeviceId, orderNo: no,
      occurredAt: new Date(Date.parse(cutoff) + delta).toISOString(), roles }
    observe({ webContentsId: 41, frame, method: 'POST', resourceType: 'xhr', url: base + '/api/cashier/sales', statusCode: 201,
      fromCache: false, responseHeaders: { 'X-EShop-Print-Origin': [Buffer.from(JSON.stringify(fact)).toString('base64url')] }, ...overrides })
  }
  return { send, origins }
}
for (const role of ['FRONT', 'KITCHEN'] as const) it('preserves concurrent observed events and rejects old or wrong device ' + role, () => {
  const { origins, send } = harness()
  send('OLD', -1); send('EQUAL', 0); send('NEW', 1)
  expect(origins.eligible(scope, role, effect('OLD', role))).toBe(false)
  expect(origins.eligible(scope, role, effect('EQUAL', role))).toBe(false)
  expect(origins.eligible(scope, role, effect('NEW', role))).toBe(true)
  expect(origins.eligible({ ...scope, ownerDeviceId: 'other' }, role, effect('NEW', role))).toBeNull()
  expect(origins.eligible({ ...scope, storeId: 'other' }, role, effect('NEW', role))).toBeNull()
})
it('requires a response to the employee top-frame HTTPS POST on its actual business route', () => {
  const { origins, send } = harness()
  for (const change of [{ webContentsId: undefined }, { webContentsId: 4 }, { frame: { url: frame.url } }, { fromCache: true },
    { url: 'https://another.example/api/cashier/sales' }, { url: base + '/other' }, { method: 'GET' }, { resourceType: 'image' }, { statusCode: 403 }]) {
    send('FORGED', 1, change)
    expect(origins.eligible(scope, 'FRONT', effect('FORGED', 'FRONT'))).toBeNull()
  }
})
it('conflicting origins fall back to server confirmation and dining claims cannot attest FRONT', () => {
  const { origins, send } = harness()
  send('ONE', 1); send('ONE', -5)
  expect(origins.eligible(scope, 'FRONT', effect('ONE', 'FRONT'))).toBeNull()
  send('BATCH.1', 1, { url: base + '/api/dine-in/sessions/s1/kitchen/claim' }, ['FRONT'])
  expect(origins.eligible(scope, 'FRONT', effect('BATCH.1', 'FRONT'))).toBeNull()
  send('BATCH.1', 1, { url: base + '/api/dine-in/sessions/s1/kitchen/claim' }, ['KITCHEN'])
  expect(origins.eligible(scope, 'KITCHEN', effect('BATCH.1', 'KITCHEN'))).toBe(true)
})
