import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { resolveWindowsProviderEntry } from '../src/main/provider/providerProcess'
import { stableUserDataPath } from '../src/main/appPaths'

describe('Windows installer readiness', () => {
  it('resolves the packaged Provider from Electron resources', () => {
    const root = join(tmpdir(), `eshop-provider-resources-${process.pid}-${Date.now()}`)
    const entry = join(root, 'eshop-windows-provider', 'dist', 'index.js')
    mkdirSync(join(root, 'eshop-windows-provider', 'dist'), { recursive: true })
    writeFileSync(entry, 'module.exports = {}')

    expect(resolveWindowsProviderEntry({ env: {}, resourcesPath: root, cwd: tmpdir() })).toEqual({
      entryPath: entry,
      source: 'resources',
    })
  })

  it('keeps user data in the legacy eshop-desktop directory for upgrade preservation', () => {
    const path = stableUserDataPath('/Users/store/AppData/Roaming')
    expect(path).toBe('/Users/store/AppData/Roaming/eshop-desktop')
    expect(path).not.toContain('E-Shop Store OS')
  })
})
