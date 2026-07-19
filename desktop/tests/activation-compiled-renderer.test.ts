import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const verifier = require('../scripts/verify-activation-compiled-renderer.cjs') as {
  MISSING_ARTIFACT_MESSAGE: string
  assertNoCommonJsOrEsmRuntime(source: string): void
  requiredCheckpointStages: string[]
  runCli(options: {
    desktopRoot?: string
    argv?: string[]
    stdout?: { write(input: string): void }
    stderr?: { write(input: string): void }
  }): Promise<number>
  toPosixPath(value: string): string
  verifyCompiledActivationRenderer(options: { desktopRoot: string }): Promise<{
    result: 'PASS'
    checkpointStages: string[]
    consoleErrors: string[]
    watchdogTriggered: boolean
    dom: {
      title: string
      formHidden: boolean
      storeCode: string
      pinInputPresent: boolean
      pinDisabled: boolean
    }
  }>
}

const desktopRoot = join(__dirname, '..')
const verifierScript = join(desktopRoot, 'scripts', 'verify-activation-compiled-renderer.cjs')
const smokeScript = join(desktopRoot, 'tests', 'smoke', 'activation-window-smoke.cjs')
const tempRoots: string[] = []

const htmlFixture = [
  '<!doctype html>',
  '<html>',
  '<body>',
  '<form id="activation-form" hidden>',
  '<input id="store-code" />',
  '<input id="pin" />',
  '</form>',
  '<script src="./activationRenderer.js"></script>',
  '</body>',
  '</html>',
].join('\n')

const preloadFixture = [
  "const { contextBridge } = require('electron')",
  "contextBridge.exposeInMainWorld('eshopDesktopActivation', {})",
].join('\n')

const browserCompatibleRendererFixture = `
(function () {
  const api = window.eshopDesktopActivation
  void api.reportStartupCheckpoint({ stage: 'script-started' })
  void api.reportStartupCheckpoint({ stage: 'bridge-detected' })
  api.onStateChanged(function () {})
  void api.reportStartupCheckpoint({ stage: 'subscribed' })

  const form = document.querySelector('#activation-form')
  const storeCode = document.querySelector('#store-code')
  const pin = document.querySelector('#pin')
  const title = document.querySelector('#state-title')
  document.querySelector('#state-detail')
  document.querySelector('#status-code')
  document.querySelector('#activate-button')
  document.querySelector('#retry-button')
  document.querySelector('#reset-button')
  document.querySelector('#quit-button')
  document.querySelector('#busy')

  void (async function () {
    void api.reportStartupCheckpoint({ stage: 'get-state-started' })
    const result = await api.getState()
    void api.reportStartupCheckpoint({ stage: 'get-state-succeeded', stateKind: result.state.kind })
    title.textContent = '激活此收银台'
    form.hidden = false
    storeCode.value = result.state.storeCodeHint
    pin.disabled = false
    void api.reportStartupCheckpoint({ stage: 'rendered', stateKind: result.state.kind })
  })()
})()
`

function makeTempDesktopRoot() {
  const root = mkdtempSync(join(tmpdir(), 'activation-compiled-verifier-'))
  tempRoots.push(root)
  return root
}

function writeArtifactTree(root: string, rendererSource = browserCompatibleRendererFixture) {
  const activationDir = join(root, 'dist', 'renderer', 'activation')
  const preloadDir = join(root, 'dist', 'preload')
  mkdirSync(activationDir, { recursive: true })
  mkdirSync(preloadDir, { recursive: true })
  writeFileSync(join(activationDir, 'activationRenderer.js'), rendererSource)
  writeFileSync(join(activationDir, 'index.html'), htmlFixture)
  writeFileSync(join(preloadDir, 'activationPreload.js'), preloadFixture)
}

describe('compiled activation renderer verifier', () => {
  afterEach(() => {
    while (tempRoots.length) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true })
    }
  })

  it('passes browser classic-script compatible renderer artifacts without building dist', async () => {
    const root = makeTempDesktopRoot()
    writeArtifactTree(root)

    const result = await verifier.verifyCompiledActivationRenderer({ desktopRoot: root })

    expect(result.result).toBe('PASS')
    expect(result.checkpointStages).toEqual(verifier.requiredCheckpointStages)
    expect(result.consoleErrors).toEqual([])
    expect(result.watchdogTriggered).toBe(false)
    expect(result.dom).toMatchObject({
      title: '激活此收银台',
      formHidden: false,
      storeCode: 'STORE-A',
      pinInputPresent: true,
      pinDisabled: false,
    })
  })

  it('fails fast when the compiled renderer artifact is missing', async () => {
    const root = makeTempDesktopRoot()

    await expect(verifier.verifyCompiledActivationRenderer({ desktopRoot: root })).rejects.toThrow(
      verifier.MISSING_ARTIFACT_MESSAGE,
    )
  })

  it('returns a non-zero CLI result for missing dist instead of swallowing failures', async () => {
    const root = makeTempDesktopRoot()
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await verifier.runCli({
      desktopRoot: root,
      argv: [],
      stdout: { write: (input: string) => stdout.push(input) },
      stderr: { write: (input: string) => stderr.push(input) },
    })

    expect(exitCode).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('')).toContain(verifier.MISSING_ARTIFACT_MESSAGE)
  })

  it('rejects empty compiled renderer artifacts', async () => {
    const root = makeTempDesktopRoot()
    writeArtifactTree(root, '   \n')

    await expect(verifier.verifyCompiledActivationRenderer({ desktopRoot: root })).rejects.toThrow(
      /Compiled activation renderer artifact is empty/,
    )
  })

  it('rejects CommonJS runtime traces in the compiled renderer', async () => {
    const root = makeTempDesktopRoot()
    writeArtifactTree(
      root,
      [
        'Object.defineProperty(exports, "__esModule", { value: true });',
        'module.exports = {}',
        "const dependency = require('./x')",
        browserCompatibleRendererFixture,
      ].join('\n'),
    )

    await expect(verifier.verifyCompiledActivationRenderer({ desktopRoot: root })).rejects.toThrow(
      /CommonJS exports prologue/,
    )
  })

  it('rejects ESM import and export syntax that cannot run as a classic script', () => {
    expect(() => verifier.assertNoCommonJsOrEsmRuntime("import x from './x.js'\n")).toThrow(/ESM import/)
    expect(() => verifier.assertNoCommonJsOrEsmRuntime('export {}\n')).toThrow(/ESM export/)
  })

  it('keeps the verifier independent from npm, npx, tsc, and electron-builder', () => {
    const script = readFileSync(verifierScript, 'utf8')

    expect(script).not.toMatch(/require\(['"]node:child_process['"]\)/)
    expect(script).not.toMatch(/\bspawn(?:Sync)?\b|\bexecFile(?:Sync)?\b/)
    expect(script).not.toMatch(/\bnpm\.cmd\b|\bnpx\b|\btsc\b|\belectron-builder\b/)
  })

  it('normalizes Windows-style path separators for stable verifier output', () => {
    expect(verifier.toPosixPath('dist\\renderer\\activation\\activationRenderer.js')).toBe(
      'dist/renderer/activation/activationRenderer.js',
    )
  })

  it('keeps default Electron page detection in the Activation smoke gate', () => {
    const smoke = readFileSync(smokeScript, 'utf8')

    expect(smoke).toContain("document.title === 'Electron'")
    expect(smoke).toMatch(/welcome to electron\|electron quick start\|electron fiddle\|electron default/i)
    expect(smoke).toContain('Electron default page detected')
  })
})
