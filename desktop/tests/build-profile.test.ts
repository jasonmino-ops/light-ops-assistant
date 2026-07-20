import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_BUILD_PROFILE_FILE,
  loadDesktopBuildProfile,
  parseDesktopBuildProfile,
  PRODUCTION_BUILD_PROFILE,
} from '../src/main/buildProfile'

const stagingProfile = {
  schemaVersion: 1,
  channel: 'STAGING',
  buildLabel: 'STAGING TEST ONLY',
  baseUrl: 'https://staging.example.com',
  storeCode: 'PREV06C',
  deploymentCommit: 'c95d6eda12027ce4bc29cfac8f99f60a69d81525',
}

describe('Desktop build profile', () => {
  it('parses and locks an HTTPS staging origin', () => {
    expect(parseDesktopBuildProfile(JSON.stringify(stagingProfile))).toMatchObject({
      channel: 'STAGING',
      baseUrl: 'https://staging.example.com',
      storeCode: 'PREV06C',
      locked: true,
    })
  })

  it('rejects origins with credentials, paths, query strings, or non-HTTPS schemes', () => {
    for (const baseUrl of [
      'http://staging.example.com',
      'https://user:pass@staging.example.com',
      'https://staging.example.com/path',
      'https://staging.example.com?token=value',
    ]) {
      expect(parseDesktopBuildProfile(JSON.stringify({ ...stagingProfile, baseUrl }))).toBeNull()
    }
  })

  it('uses the production fallback only for the production app', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'desktop-production-profile-'))
    expect(loadDesktopBuildProfile({ resourcesPath, appName: 'E-Shop Desktop' })).toEqual(PRODUCTION_BUILD_PROFILE)
    expect(() => loadDesktopBuildProfile({ resourcesPath, appName: 'E-Shop Desktop STAGING' }))
      .toThrow('STAGING_BUILD_PROFILE_MISSING')
  })

  it('requires the STAGING product identity for a bundled staging profile', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'desktop-staging-profile-'))
    writeFileSync(join(resourcesPath, DESKTOP_BUILD_PROFILE_FILE), JSON.stringify(stagingProfile))
    expect(loadDesktopBuildProfile({ resourcesPath, appName: 'E-Shop Desktop STAGING' }).channel).toBe('STAGING')
    expect(() => loadDesktopBuildProfile({ resourcesPath, appName: 'E-Shop Desktop' }))
      .toThrow('DESKTOP_BUILD_PROFILE_APP_MISMATCH')
  })
})
