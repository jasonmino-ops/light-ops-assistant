import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import pkg from '../package.json'

const root = join(__dirname, '..')
const requiredSizes = [16, 24, 32, 48, 64, 128, 256]
const sourcePath = join(root, 'assets', 'branding', 'eshop-official-avatar-640.png')

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function icoSizes(path: string) {
  const buffer = readFileSync(path)
  expect(buffer.readUInt16LE(0)).toBe(0)
  expect(buffer.readUInt16LE(2)).toBe(1)
  const count = buffer.readUInt16LE(4)
  const sizes: number[] = []
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16
    const width = buffer[offset] || 256
    const height = buffer[offset + 1] || 256
    const bitCount = buffer.readUInt16LE(offset + 6)
    const bytesInRes = buffer.readUInt32LE(offset + 8)
    const imageOffset = buffer.readUInt32LE(offset + 12)
    expect(width).toBe(height)
    expect(bitCount).toBe(32)
    expect(bytesInRes).toBeGreaterThan(0)
    expect(imageOffset).toBeGreaterThanOrEqual(6 + count * 16)
    sizes.push(width)
  }
  return sizes.sort((a, b) => a - b)
}

describe('EP-MB3-05A desktop branding', () => {
  it('keeps the Founder source PNG as a tracked source asset', () => {
    expect(existsSync(sourcePath)).toBe(true)
    const buffer = readFileSync(sourcePath)
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(buffer.readUInt32BE(16)).toBe(640)
    expect(buffer.readUInt32BE(20)).toBe(640)
    expect(buffer[24]).toBe(8)
    expect(buffer[25]).toBe(2)
    expect(sha256(sourcePath)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('generates all ICO files from the official source path', () => {
    const script = readFileSync(join(root, 'scripts', 'generate-icon.cjs'), 'utf8')
    expect(script).toContain('assets", "branding", "eshop-official-avatar-640.png')

    for (const file of ['icon.ico', 'installer-icon.ico', 'uninstaller-icon.ico']) {
      const path = join(root, 'build', file)
      expect(existsSync(path)).toBe(true)
      expect(icoSizes(path)).toEqual(requiredSizes)
    }
  })

  it('keeps desktop product identity stable while isolating the 05A artifact', () => {
    const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    expect(pkg.name).toBe('eshop-desktop')
    expect(pkg.productName).toBe('E-Shop Store OS')
    expect(pkg.version).toBe('1.0.0')
    expect(builder).toContain('appId: com.eshop.desktop')
    expect(builder).toContain('productName: E-Shop Store OS')
    expect(builder).toContain('output: release-ep-mb3-05a')
    expect(builder).toContain('artifactName: "E-Shop-Store-OS-Setup-${version}-EP-MB3-05A-${arch}.${ext}"')
    expect(builder).toContain('icon: build/icon.ico')
    expect(builder).toContain('installerIcon: build/installer-icon.ico')
    expect(builder).toContain('uninstallerIcon: build/uninstaller-icon.ico')
    expect(builder).toContain('shortcutName: "E-Shop Store OS"')
    expect(builder).not.toContain('output: release\n')
    expect(builder).not.toContain('installerHeaderIcon')
  })
})
