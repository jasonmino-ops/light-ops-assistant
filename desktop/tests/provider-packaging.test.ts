import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error The verifier is a Node ESM CLI module with runtime exports and no generated declaration file.
import { inspectProviderArtifact, verifyProviderArtifact } from '../scripts/verify-provider-packaging.mjs'

const temporaryRoots: string[] = []

function createProviderFixture() {
  const base = mkdtempSync(join(tmpdir(), 'eshop-provider-packaging-'))
  temporaryRoots.push(base)
  const providerRoot = join(base, 'Program Files', 'E-Shop Desktop', 'resources', 'eshop-windows-provider')
  const contractRoot = join(providerRoot, 'node_modules', '@eshop', 'hrt-contract')
  mkdirSync(join(providerRoot, 'dist'), { recursive: true })
  mkdirSync(join(contractRoot, 'dist'), { recursive: true })
  writeFileSync(
    join(providerRoot, 'package.json'),
    JSON.stringify({ name: 'eshop-windows-provider', main: 'dist/index.js' }),
  )
  writeFileSync(
    join(providerRoot, 'dist', 'index.js'),
    'require("node:fs"); require("@eshop/hrt-contract"); module.exports = { loaded: true };\n',
  )
  writeFileSync(
    join(contractRoot, 'package.json'),
    JSON.stringify({ name: '@eshop/hrt-contract', main: 'dist/index.js' }),
  )
  writeFileSync(join(contractRoot, 'dist', 'index.js'), 'module.exports = { contract: true };\n')
  return { providerRoot, contractRoot }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Provider packaging dependency closure', () => {
  it('scans and resolves the complete external runtime closure in the installed resources layout', () => {
    const { providerRoot } = createProviderFixture()
    const report = verifyProviderArtifact(providerRoot)

    expect(report.emittedDependencyScan.externalRuntimeDependencies).toEqual(['@eshop/hrt-contract'])
    expect(report.emittedDependencyScan.nodeBuiltins).toContain('node:fs')
    expect(report.missingRuntimeDependencies).toEqual([])
    expect(report.entryLoad.passed).toBe(true)
    expect(report.resolution[0].realResolved).toContain(join(providerRoot, 'node_modules'))
  })

  it('fails when the shipped dependency subtree is removed', () => {
    const { providerRoot, contractRoot } = createProviderFixture()
    rmSync(contractRoot, { recursive: true, force: true })

    expect(() => verifyProviderArtifact(providerRoot)).toThrow(/MISSING_RUNTIME_DEPENDENCIES/)
    expect(inspectProviderArtifact(providerRoot).missingRuntimeDependencies).toEqual(['@eshop/hrt-contract'])
  })

  it('keeps resolution package-relative and independent of NODE_PATH', () => {
    const { providerRoot } = createProviderFixture()
    const previousNodePath = process.env.NODE_PATH
    process.env.NODE_PATH = '/definitely/not-a-provider-dependency-root'
    try {
      const report = verifyProviderArtifact(providerRoot)
      expect(report.resolution[0].realResolved).toContain(join(providerRoot, 'node_modules'))
      expect(report.entryPath).toContain(join('resources', 'eshop-windows-provider', 'dist', 'index.js'))
    } finally {
      if (previousNodePath === undefined) delete process.env.NODE_PATH
      else process.env.NODE_PATH = previousNodePath
    }
  })
})
