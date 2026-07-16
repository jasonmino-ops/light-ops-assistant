import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_DISPLAY_SETTINGS,
  type DisplayAssignmentSettings,
  type DisplayMode,
  type DisplayReference,
} from './displayAssignment'

export type DisplaySettingsLoadResult = {
  settings: DisplayAssignmentSettings
  path: string
  recovered: boolean
  error?: string
}

export function displaySettingsPath(userDataDir: string): string {
  return join(userDataDir, 'display-settings.json')
}

export function loadDisplaySettings(userDataDir: string): DisplaySettingsLoadResult {
  const path = displaySettingsPath(userDataDir)
  if (!existsSync(path)) {
    return { settings: { ...DEFAULT_DISPLAY_SETTINGS }, path, recovered: false }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const settings = parseDisplaySettings(parsed)
    if (!settings) {
      return { settings: { ...DEFAULT_DISPLAY_SETTINGS }, path, recovered: true, error: 'INVALID_DISPLAY_SETTINGS' }
    }
    return { settings, path, recovered: false }
  } catch (error) {
    return { settings: { ...DEFAULT_DISPLAY_SETTINGS }, path, recovered: true, error: String(error) }
  }
}

export function saveDisplaySettings(path: string, settings: DisplayAssignmentSettings): void {
  const valid = parseDisplaySettings(settings)
  if (!valid) throw new Error('INVALID_DISPLAY_SETTINGS')
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, `${JSON.stringify(valid, null, 2)}\n`, 'utf8')
  renameSync(tmpPath, path)
}

export function parseDisplaySettings(value: unknown): DisplayAssignmentSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.version !== 1) return null
  const displayMode = parseMode(input.displayMode)
  if (!displayMode) return null
  return {
    version: 1,
    displayMode,
    swapped: input.swapped === true,
    employeeDisplay: parseReference(input.employeeDisplay),
    customerDisplay: parseReference(input.customerDisplay),
  }
}

function parseMode(value: unknown): DisplayMode | null {
  return value === 'single' || value === 'dual' ? value : null
}

function parseReference(value: unknown): DisplayReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (typeof input.id !== 'number' || !Number.isFinite(input.id)) return undefined
  const out: DisplayReference = { id: input.id }
  if (typeof input.label === 'string') out.label = input.label
  if (typeof input.internal === 'boolean') out.internal = input.internal
  if (input.size && typeof input.size === 'object' && !Array.isArray(input.size)) {
    const size = input.size as Record<string, unknown>
    if (typeof size.width === 'number' && Number.isFinite(size.width)
      && typeof size.height === 'number' && Number.isFinite(size.height)) {
      out.size = { width: size.width, height: size.height }
    }
  }
  if (typeof input.scaleFactor === 'number' && Number.isFinite(input.scaleFactor)) {
    out.scaleFactor = input.scaleFactor
  }
  return out
}
