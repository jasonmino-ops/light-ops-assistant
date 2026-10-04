import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, win32 } from 'node:path'
import os from 'node:os'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveWindowsProviderEntry } from '../src/main/provider/providerProcess'

const roots: string[] = []
const commit = '7785be145d5259991038d17839d322e2694e338c'
const providerArtifactScript = join(__dirname, '../scripts/provider-artifact.mjs')
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function runProviderArtifact(...args: string[]) {
  try {
    return JSON.parse(execFileSync(process.execPath, [providerArtifactScript, ...args], { encoding: 'utf8' }))
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
    throw new Error(stderr.trim() || (error instanceof Error ? error.message : String(error)))
  }
}

async function artifact() {
  const root = await mkdtemp(join(os.tmpdir(), 'provider-artifact-'))
  roots.push(root)
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'eshop-windows-provider',
    version: '0.1.0',
    private: true,
    type: 'commonjs',
    main: 'dist/index.js',
  }))
  await writeFile(join(root, 'dist', 'index.js'), 'console.log("self-contained")\n')
  return root
}

async function providerSource() {
  const root = await mkdtemp(join(os.tmpdir(), 'provider-source-'))
  roots.push(root)
  await mkdir(join(root, 'dist'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'fixture-provider-dependency'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'eshop-windows-provider',
    version: '0.1.0',
    type: 'commonjs',
    main: 'dist/index.js',
    dependencies: { 'fixture-provider-dependency': '1.0.0' },
    engines: { node: '>=22' },
  }))
  await writeFile(join(root, 'dist', 'index.js'), [
    "const dependency = require('fixture-provider-dependency')",
    "if (require.main === module) console.log(JSON.stringify({ ok: true, dependency }))",
    'module.exports = { dependency }',
  ].join('\n'))
  await writeFile(join(root, 'node_modules', 'fixture-provider-dependency', 'package.json'), JSON.stringify({
    name: 'fixture-provider-dependency',
    version: '1.0.0',
    main: 'index.js',
  }))
  await writeFile(join(root, 'node_modules', 'fixture-provider-dependency', 'index.js'), "module.exports = 'bundled-runtime'\n")
  return root
}

describe('deterministic Provider packaging input', () => {
  it('stages a deterministic self-contained bundle instead of Provider node_modules', async () => {
    const sourceA = await providerSource()
    const sourceB = await providerSource()
    const parentA = await mkdtemp(join(os.tmpdir(), 'provider-staged-parent-'))
    const parentB = await mkdtemp(join(os.tmpdir(), 'provider-staged-parent-'))
    roots.push(parentA, parentB)
    const stagedA = join(parentA, 'eshop-windows-provider')
    const stagedB = join(parentB, 'eshop-windows-provider')

    expect(runProviderArtifact('stage', '--source-dir', sourceA, '--artifact-dir', stagedA)).toMatchObject({
      result: 'PASS',
      entrypoint: 'dist/index.js',
      externalImports: [],
    })
    expect(runProviderArtifact('stage', '--source-dir', sourceB, '--artifact-dir', stagedB)).toMatchObject({ result: 'PASS' })
    expect(await readFile(join(stagedA, 'dist', 'index.js'))).toEqual(await readFile(join(stagedB, 'dist', 'index.js')))

    await rm(join(sourceA, 'node_modules'), { recursive: true })
    const smoke = execFileSync(process.execPath, [join(stagedA, 'dist', 'index.js'), '--smoke'], { encoding: 'utf8' })
    expect(JSON.parse(smoke)).toEqual({ ok: true, dependency: 'bundled-runtime' })
    expect((await readdir(stagedA)).sort()).toEqual(['dist', 'package.json'])
    const stagedPackage = JSON.parse(await readFile(join(stagedA, 'package.json'), 'utf8'))
    expect(stagedPackage).not.toHaveProperty('dependencies')
    expect(stagedPackage).not.toHaveProperty('engines')

    runProviderArtifact('write', '--artifact-dir', stagedA, '--provider-commit', commit)
    expect(runProviderArtifact('verify', '--artifact-dir', stagedA, '--provider-commit', commit)).toMatchObject({ result: 'PASS', files: 2 })
    expect((await readdir(stagedA)).sort()).toEqual(['dist', 'package.json', 'provider-artifact-manifest.json'])
  })

  it('makes both Windows workflows build and smoke the same staged bundle', async () => {
    const workspace = 'D:\\a\\light-ops-assistant\\light-ops-assistant'
    const desktop = win32.join(workspace, 'desktop')
    const stagedFromWorkspace = win32.resolve(workspace, '..\\eshop-windows-provider\\artifacts\\eshop-windows-provider')
    const stagedFromDesktop = win32.resolve(desktop, '..\\..\\eshop-windows-provider\\artifacts\\eshop-windows-provider')
    const electronBuilderSource = win32.resolve(desktop, '../../eshop-windows-provider/artifacts/eshop-windows-provider')
    expect(stagedFromDesktop).toBe(stagedFromWorkspace)
    expect(electronBuilderSource).toBe(stagedFromWorkspace)

    const workflows = await Promise.all([
      readFile(join(__dirname, '../../.github/workflows/desktop-release-pilot.yml'), 'utf8'),
      readFile(join(__dirname, '../../.github/workflows/desktop-windows-build.yml'), 'utf8'),
    ])
    for (const workflow of workflows) {
      const unitTests = workflow.indexOf('- name: Unit tests')
      const providerCheckout = workflow.indexOf('- name: Checkout Windows Provider artifact source')
      const providerStage = workflow.indexOf('- name: Stage Provider artifact for Desktop packaging')
      const providerSupervision = workflow.indexOf('- name: Provider supervision pipe integration')
      expect(workflow).toContain('provider-artifact.mjs stage')
      expect(workflow).toContain('--source-dir ep-mb3-provider')
      expect(workflow).toContain('..\\..\\eshop-windows-provider\\artifacts\\eshop-windows-provider\\dist\\index.js')
      expect(workflow).not.toContain('npm run package')
      expect(workflow).not.toContain('Copy-Item -Recurse -Force ep-mb3-provider\\artifacts')
      expect(workflow).not.toContain('..\\ep-mb3-provider\\artifacts\\eshop-windows-provider\\dist\\index.js')
      expect(workflow).toContain("-ArgumentList '.\\tests\\smoke\\provider-supervision-smoke.cjs'")
      expect(workflow).not.toContain('node -e "const {WindowsProviderSupervisor}')
      expect(unitTests).toBeGreaterThanOrEqual(0)
      expect(unitTests).toBeLessThan(providerCheckout)
      expect(providerCheckout).toBeLessThan(providerStage)
      expect(providerStage).toBeLessThan(providerSupervision)
    }

    const desktopPackage = JSON.parse(await readFile(join(__dirname, '../package.json'), 'utf8'))
    expect(desktopPackage.scripts['provider:artifact:verify']).toContain('../../eshop-windows-provider/artifacts/eshop-windows-provider')
    const electronBuilder = await readFile(join(__dirname, '../electron-builder.yml'), 'utf8')
    expect(electronBuilder).toContain('from: ../../eshop-windows-provider/artifacts/eshop-windows-provider')
  })

  it('seals and verifies every packaged Provider byte against the pinned commit', async () => {
    const root = await artifact()
    expect(runProviderArtifact('write', '--artifact-dir', root, '--provider-commit', commit)).toMatchObject({ result: 'PASS', files: 2 })
    expect(runProviderArtifact('verify', '--artifact-dir', root, '--provider-commit', commit)).toMatchObject({
      result: 'PASS',
      providerCommit: commit,
      files: 2,
    })
  })

  it('rejects tampering and a nested node_modules runtime dependency', async () => {
    const root = await artifact()
    runProviderArtifact('write', '--artifact-dir', root, '--provider-commit', commit)
    await writeFile(join(root, 'dist', 'index.js'), 'tampered\n')
    expect(() => runProviderArtifact('verify', '--artifact-dir', root, '--provider-commit', commit)).toThrow('manifest does not match')

    const second = await artifact()
    runProviderArtifact('write', '--artifact-dir', second, '--provider-commit', commit)
    await mkdir(join(second, 'node_modules'))
    expect(() => runProviderArtifact('verify', '--artifact-dir', second, '--provider-commit', commit)).toThrow('must not contain node_modules')

    const third = await artifact()
    runProviderArtifact('write', '--artifact-dir', third, '--provider-commit', commit)
    await writeFile(join(third, 'README.md'), 'development-only material\n')
    expect(() => runProviderArtifact('verify', '--artifact-dir', third, '--provider-commit', commit)).toThrow('non-runtime root entries')

    const fourth = await artifact()
    await writeFile(join(fourth, 'package.json'), JSON.stringify({
      name: 'eshop-windows-provider',
      version: '0.1.0',
      private: true,
      type: 'commonjs',
      main: 'dist/index.js',
      dependencies: { unsafe: '1.0.0' },
    }))
    expect(() => runProviderArtifact('write', '--artifact-dir', fourth, '--provider-commit', commit)).toThrow('non-runtime metadata')
  })

  it('verifies the installed app.asar and Provider resources as one self-contained payload', async () => {
    const resources = await mkdtemp(join(os.tmpdir(), 'installed-resources-'))
    roots.push(resources)
    const appRoot = join(resources, 'app-input')
    const entries = [
      'dist/main/main.js',
      'dist/main/printing/v3PrintingRuntime.js',
      'dist/main/printing/printerSetupService.js',
      'dist/main/printing/freshV3Bootstrap.js',
      'dist/preload/printingSetupPreload.js',
      'dist/renderer/printingSetup/index.html',
      'dist/renderer/printingSetup/printingSetup.css',
      'dist/renderer/printingSetup/printingSetupRenderer.js',
      'package.json',
    ]
    for (const entry of entries) {
      const path = join(appRoot, entry)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, entry === 'package.json' ? '{"name":"eshop-desktop"}' : entry)
    }
    await createPackage(appRoot, join(resources, 'app.asar'))

    const provider = join(resources, 'eshop-windows-provider')
    await mkdir(join(provider, 'dist'), { recursive: true })
    await writeFile(join(provider, 'package.json'), JSON.stringify({
      name: 'eshop-windows-provider',
      version: '0.1.0',
      private: true,
      type: 'commonjs',
      main: 'dist/index.js',
    }))
    await writeFile(join(provider, 'dist', 'index.js'), 'console.log("provider")\n')
    runProviderArtifact('write', '--artifact-dir', provider, '--provider-commit', commit)

    const output = execFileSync(process.execPath, [join(__dirname, '../scripts/verify-installed-resources.mjs'), resources], {
      encoding: 'utf8',
    })
    expect(JSON.parse(output)).toMatchObject({ result: 'PASS', desktopEntries: entries.length, provider: { result: 'PASS' } })
    expect(resolveWindowsProviderEntry({ env: {}, resourcesPath: resources, cwd: appRoot })).toEqual({
      entryPath: join(provider, 'dist', 'index.js'),
      source: 'resources',
    })
  })
})
