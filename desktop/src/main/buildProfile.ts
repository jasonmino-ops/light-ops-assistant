import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type DesktopBuildChannel = 'PRODUCTION' | 'STAGING'

export type DesktopBuildProfile = {
  schemaVersion: 1
  channel: DesktopBuildChannel
  buildLabel: string
  baseUrl: string
  storeCode: string
  deploymentCommit: string | null
  locked: boolean
}

export const DESKTOP_BUILD_PROFILE_FILE = 'desktop-build-profile.json'

export const PRODUCTION_BUILD_PROFILE: DesktopBuildProfile = {
  schemaVersion: 1,
  channel: 'PRODUCTION',
  buildLabel: 'PRODUCTION',
  baseUrl: 'https://elifekh.com',
  storeCode: '',
  deploymentCommit: null,
  locked: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedHttpsOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function parseDesktopBuildProfile(raw: string): DesktopBuildProfile | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || parsed.channel !== 'STAGING') return null
    const baseUrl = normalizedHttpsOrigin(parsed.baseUrl)
    if (!baseUrl) return null
    if (typeof parsed.buildLabel !== 'string' || !/^STAGING(?:[ A-Z0-9_-]*)$/.test(parsed.buildLabel)) return null
    if (typeof parsed.storeCode !== 'string' || !/^[A-Z0-9]{3,64}$/.test(parsed.storeCode)) return null
    if (typeof parsed.deploymentCommit !== 'string' || !/^[0-9a-f]{40}$/.test(parsed.deploymentCommit)) return null
    return {
      schemaVersion: 1,
      channel: 'STAGING',
      buildLabel: parsed.buildLabel,
      baseUrl,
      storeCode: parsed.storeCode,
      deploymentCommit: parsed.deploymentCommit,
      locked: true,
    }
  } catch {
    return null
  }
}

export function loadDesktopBuildProfile(input: {
  resourcesPath: string
  appName: string
}): DesktopBuildProfile {
  const expectsStaging = /\bSTAGING\b/i.test(input.appName)
  const profilePath = join(input.resourcesPath, DESKTOP_BUILD_PROFILE_FILE)

  if (!existsSync(profilePath)) {
    if (expectsStaging) throw new Error('STAGING_BUILD_PROFILE_MISSING')
    return PRODUCTION_BUILD_PROFILE
  }

  const profile = parseDesktopBuildProfile(readFileSync(profilePath, 'utf8'))
  if (!profile) throw new Error('DESKTOP_BUILD_PROFILE_INVALID')
  if (!expectsStaging) throw new Error('DESKTOP_BUILD_PROFILE_APP_MISMATCH')
  return profile
}
