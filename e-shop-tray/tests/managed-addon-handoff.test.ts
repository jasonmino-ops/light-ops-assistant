import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  managedAddonBindingIdentity,
  managedAddonHandoffPath,
  parseManagedAddonHandoff,
} from '../src/desktopBindingIdentity'

const valid = {
  schemaVersion: 1,
  audience: 'eshop-managed-network-print-addon',
  browserDeviceId: 'desktop-device-123',
  storeCode: 'STORE-A',
  token: `${'a'.repeat(96)}.${'b'.repeat(43)}`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  nonce: '123e4567-e89b-12d3-a456-426614174000',
}

describe('bounded DesktopDevice managed Add-on handoff', () => {
  it('accepts the exact short-lived handoff shape and derives no legacy identity file', () => {
    const parsed = parseManagedAddonHandoff(JSON.stringify(valid))
    expect(parsed).toEqual(valid)
    expect(managedAddonBindingIdentity(parsed)).toMatchObject({
      source: 'desktop-device-handoff',
      browserDeviceId: valid.browserDeviceId,
      storeCode: valid.storeCode,
    })
    expect(managedAddonHandoffPath('C:\\Users\\Desktop\\AppData\\Roaming')).toContain('handoff.bin')
  })

  it.each([
    ['missing token', { ...valid, token: '' }],
    ['expired', { ...valid, expiresAt: '2020-01-01T00:00:00.000Z' }],
    ['wrong audience', { ...valid, audience: 'other-addon' }],
    ['wrong store code', { ...valid, storeCode: 'bad code' }],
    ['extra field', { ...valid, unexpected: true }],
    ['wrong browser device', { ...valid, browserDeviceId: 'other-device' }],
  ])('rejects %s fail-closed', (_name, value) => {
    expect(() => parseManagedAddonHandoff(JSON.stringify(value))).toThrow('DESKTOP_ADDON_HANDOFF_INVALID')
  })

  it('keeps server-derived context and local single-use protection fail-closed', async () => {
    const source = await readFile(path.join(__dirname, '..', 'network-addon', 'main.ts'), 'utf8')
    expect(source).toContain("const managedRuntime = process.argv.includes('--settings-only')")
    expect(source).toContain("if (!child) throw new Error('PRINT_CHILD_HANDOFF_UNAVAILABLE')")
    expect(source).toContain("managedPrintChild = false")
    expect(source).toContain('readDesktopBindingIdentity(desktopBindingIdentityPath(app.getPath(\'appData\')))')
    expect(source).toContain('row.managedAddonContext !== true')
    expect(source).toContain("row.principal !== 'DESKTOP_POS_DEVICE'")
    expect(source).toContain('await rename(source, consumed)')
    expect(source).toContain('DESKTOP_ADDON_HANDOFF_REPLAYED')
    expect(source).toContain('await unlink(consumed)')
  })
})
