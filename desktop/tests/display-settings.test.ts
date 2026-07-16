import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  displaySettingsPath,
  loadDisplaySettings,
  parseDisplaySettings,
  saveDisplaySettings,
} from '../src/main/displaySettings'

let dirs: string[] = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'display-settings-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('display settings persistence', () => {
  it('returns defaults when file does not exist', () => {
    const dir = tempDir()
    const result = loadDisplaySettings(dir)
    expect(result.settings).toMatchObject({ version: 1, displayMode: 'dual', swapped: false })
    expect(result.recovered).toBe(false)
  })

  it('loads a valid config and ignores unknown fields', () => {
    const dir = tempDir()
    writeFileSync(displaySettingsPath(dir), JSON.stringify({
      version: 1,
      displayMode: 'single',
      swapped: true,
      unknown: 'kept-out',
      employeeDisplay: { id: 7, label: 'Main', internal: true, size: { width: 1920, height: 1080 }, scaleFactor: 1.25 },
    }), 'utf8')
    const result = loadDisplaySettings(dir)
    expect(result.recovered).toBe(false)
    expect(result.settings).toEqual({
      version: 1,
      displayMode: 'single',
      swapped: true,
      employeeDisplay: { id: 7, label: 'Main', internal: true, size: { width: 1920, height: 1080 }, scaleFactor: 1.25 },
      customerDisplay: undefined,
    })
  })

  it('recovers from invalid JSON, wrong version, and missing fields', () => {
    const dir = tempDir()
    const path = displaySettingsPath(dir)
    writeFileSync(path, '{not-json', 'utf8')
    expect(loadDisplaySettings(dir).recovered).toBe(true)
    writeFileSync(path, JSON.stringify({ version: 2, displayMode: 'dual' }), 'utf8')
    expect(loadDisplaySettings(dir).recovered).toBe(true)
    writeFileSync(path, JSON.stringify({ version: 1 }), 'utf8')
    expect(loadDisplaySettings(dir).recovered).toBe(true)
  })

  it('parses old or incomplete display references without blocking startup', () => {
    expect(parseDisplaySettings({
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 1 },
      customerDisplay: { id: 'bad' },
    })).toEqual({
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 1 },
      customerDisplay: undefined,
    })
  })

  it('writes atomically and can read the saved value', () => {
    const dir = tempDir()
    const path = displaySettingsPath(dir)
    saveDisplaySettings(path, {
      version: 1,
      displayMode: 'dual',
      swapped: true,
      employeeDisplay: { id: 2, label: 'Employee' },
      customerDisplay: { id: 1, label: 'Customer' },
    })
    expect(readFileSync(path, 'utf8')).toContain('"version": 1')
    expect(loadDisplaySettings(dir).settings).toMatchObject({
      displayMode: 'dual',
      swapped: true,
      employeeDisplay: { id: 2, label: 'Employee' },
      customerDisplay: { id: 1, label: 'Customer' },
    })
  })

  it('throws on write failure without corrupting an existing file', () => {
    const dir = tempDir()
    const path = displaySettingsPath(dir)
    saveDisplaySettings(path, { version: 1, displayMode: 'single', swapped: false })
    const before = readFileSync(path, 'utf8')
    expect(() => saveDisplaySettings(join(dir, 'missing', 'display-settings.json'), {
      version: 1,
      displayMode: 'dual',
      swapped: false,
    })).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})
