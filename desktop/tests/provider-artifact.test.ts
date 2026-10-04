import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import os from 'node:os'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveWindowsProviderEntry } from '../src/main/provider/providerProcess'
// @ts-expect-error Build-time ESM script intentionally has no runtime TS surface.
import { verifyProviderArtifact, writeProviderArtifactManifest } from '../scripts/provider-artifact.mjs'

const roots: string[] = []
const commit = '7785be145d5259991038d17839d322e2694e338c'
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function artifact() {
  const root = await mkdtemp(join(os.tmpdir(), 'provider-artifact-'))
  roots.push(root)
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'eshop-windows-provider', version: '0.1.0' }))
  await writeFile(join(root, 'dist', 'index.js'), 'console.log("self-contained")\n')
  return root
}

describe('deterministic Provider packaging input', () => {
  it('seals and verifies every packaged Provider byte against the pinned commit', async () => {
    const root = await artifact()
    await expect(writeProviderArtifactManifest(root, commit)).resolves.toMatchObject({ result: 'PASS', files: 2 })
    await expect(verifyProviderArtifact(root, commit)).resolves.toMatchObject({
      result: 'PASS',
      providerCommit: commit,
      files: 2,
    })
  })

  it('rejects tampering and a nested node_modules runtime dependency', async () => {
    const root = await artifact()
    await writeProviderArtifactManifest(root, commit)
    await writeFile(join(root, 'dist', 'index.js'), 'tampered\n')
    await expect(verifyProviderArtifact(root, commit)).rejects.toThrow('manifest does not match')

    const second = await artifact()
    await writeProviderArtifactManifest(second, commit)
    await mkdir(join(second, 'node_modules'))
    await expect(verifyProviderArtifact(second, commit)).rejects.toThrow('must not contain node_modules')
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
    await writeFile(join(provider, 'package.json'), '{"name":"eshop-windows-provider","version":"0.1.0"}')
    await writeFile(join(provider, 'dist', 'index.js'), 'console.log("provider")\n')
    await writeProviderArtifactManifest(provider, commit)

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
