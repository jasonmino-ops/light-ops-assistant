import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const registration = '833aabe1528fcc768f9b0329246b677f055b42bb'
const prefix = 'docs/desktop/es-print-device-takeover-rc6-foundation'
const product = '0217be8cb6a9f60d01a3ba47f69492a6948c2f8d'
const build = '05e82b2078bf4f5273001923d54de0aef545ebbd'
const governance = 'e4563bbf0dd0e61606dcd6bcb37cc83862abdb30'

function registered(suffix: string) {
  return JSON.parse(execFileSync('git', ['show', registration + ':' + prefix + suffix], {
    cwd: root, encoding: 'utf8',
  }))
}

function cli(file: string, ...args: string[]) {
  return spawnSync(process.execPath, [join(root, 'desktop/scripts', file), ...args], {
    cwd: root, encoding: 'utf8',
  })
}

describe('original RC6 archive successor', () => {
  it('binds the embedded single-package contract to the original Product, Build and rc.15 Add-on', () => {
    const receipt = registered('.json')
    const inputs = registered('-build-inputs.json')
    expect(receipt.productCommit).toBe(product)
    expect(inputs.addon.installerSha256).toBe('a202125706ecf99b90e9b6921db77d0dba6c6ef1d47db30dc04f489517cdc5b7')
    const script = `
      import { createEmbeddedManifest } from './desktop/scripts/single-installer-contract.mjs'
      const inputs = JSON.parse(process.argv[1])
      const addon = { sourceCommit: process.argv[2], version: '0.1.0-commercial-rc.15',
        installerFile: inputs.addon.installerFile, installerSha256: inputs.addon.installerSha256 }
      console.log(JSON.stringify(createEmbeddedManifest({ desktopSourceCommit: process.argv[3], addon })))
    `
    const run = (source: string) => spawnSync(process.execPath, ['--input-type=module', '-e', script,
      JSON.stringify(inputs), source, build], { cwd: root, encoding: 'utf8' })
    const positive = run(governance)
    expect(positive.status).toBe(0)
    expect(JSON.parse(positive.stdout)).toEqual({
      schemaVersion: 1, product: 'E-Shop Desktop Single Installer', desktopVersion: '0.3.0-rc.6',
      desktopSourceCommit: build, productCandidateCommit: product, governanceHeadCommit: governance,
      addon: { product: 'E-Shop Network Print Add-on (TEST ONLY)', version: '0.1.0-commercial-rc.15',
        installerFile: inputs.addon.installerFile, installerSha256: inputs.addon.installerSha256,
        sourceCommit: governance, testOnly: true, published: false, releaseReady: false },
      merchantDelivery: 'single-desktop-installer', addonRuntime: 'separate-process',
    })
    const substitution = run('030286022c1b14018421396525d06888ede1ad8e')
    expect(substitution.status).toBe(1)
    expect(substitution.stderr).toContain('SINGLE_INSTALLER_GOVERNANCE_SOURCE_MISMATCH')
  })

  for (const command of ['write', 'verify']) {
    it(`retains the formal release rejection for RC6 ${command}`, () => {
      const r = cli('release-foundation.mjs', command)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('unsupported prerelease channel for Desktop version 0.3.0-rc.6')
    })
  }

  it('refuses a substituted archive manifest before accepting any installer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rc6-invalid-archive-'))
    try {
      writeFileSync(join(directory, 'BUILD-MANIFEST.json'), JSON.stringify({ version: '0.3.0-rc.6', buildRevision: 'rebuild.1' }))
      const r = cli('verify-original-rc6.mjs', 'archive', directory)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('ORIGINAL_RC6_BUILD_MANIFEST')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a publish action', () => {
    const r = cli('verify-original-rc6.mjs', 'publish')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('ORIGINAL_RC6_USAGE')
  })
})
