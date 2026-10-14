import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as url from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as coordinatorModule from '../network-addon/entryCoordinator'
import * as profileModule from '../network-addon/profile'
import { ColdModeLifecycle } from '../network-addon/coldModeLifecycle'
import { RelayPoller } from '../src/relayPoller'
import * as runtime from '../src/networkRuntime'
import * as contract from '../src/networkContract'
import * as nodes from '../src/networkNodeConfig'
import * as discovery from '../src/networkDiscovery'
import * as rawTransport from '../src/printing/networkRawTcpTransport'
import { RelayResultLog } from '../src/resultLog'

// Execute both complete main-process programs, with real protected profiles,
// journal, lifecycle, runtime guards and poller. Only Electron/OS/physical/HTTP
// ports are replaced. No Add-on process, cloud endpoint or printer is contacted.
const baseline = 'ede397d808cd88347d5c641ff833d1a7a6fe404d'
const repo = path.resolve(__dirname, '../..')
const source = (name: string, old = false) => old
  ? execFileSync('git', ['show', `${baseline}:e-shop-tray/network-addon/${name}.ts`], { cwd: repo, encoding: 'utf8' })
  : readFileSync(path.join(__dirname, `../network-addon/${name}.ts`), 'utf8')
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText
const identity = { installationId: 'settings-test-installation', computerId: 'settings-test-computer', storeCode: 'SETTINGS-TEST', boundAt: '2026-09-10' }
const endpoint = { host: '10.20.30.2', port: 9100 }
const interfaces: ReturnType<typeof os.networkInterfaces> = { LAN: [{ address: '10.20.30.1', netmask: '255.255.255.0',
  family: 'IPv4', internal: false, mac: '00:00:00:00:00:01', cidr: '10.20.30.1/24' }] }
const protector = { protect: (value: string) => Buffer.from(value).toString('base64'),
  unprotect: (value: string) => Buffer.from(value, 'base64').toString() }
const confirmation = { singleAgentConfirmed: true, cashierTabsClosed: true }
const releases: (() => Promise<void>)[] = []
afterEach(async () => { for (const release of releases.splice(0)) await release(); vi.useRealTimers() })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
async function hashes(directory: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(prefix, item.name), file = path.join(directory, item.name)
    if (item.isDirectory()) Object.assign(result, await hashes(file, name))
    else result[name] = createHash('sha256').update(await fs.readFile(file)).digest('hex')
  }
  return result
}
type FixtureOptions = { old?: boolean; args?: string[]; enabled?: boolean; unreachable?: boolean;
  cold?: boolean; fresh?: boolean; missingBinding?: boolean; interruptedRecovery?: boolean }
async function mainFixture(options: FixtureOptions = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'addon-settings-only-'))
  const directory = path.join(root, 'E-Shop-Network-Print-Addon', 'state')
  const profileOptions = { directory, identity, protector, interfaces: () => interfaces }
  const seed = new profileModule.NetworkAddonProfile(profileOptions)
  await fs.mkdir(directory, { recursive: true })
  if (!options.fresh) {
    await seed.open()
    const test = await seed.beginTest({ id: randomUUID(), mode: 'FRONT_ONLY', endpoint,
      networkFingerprint: '1'.repeat(64), hardwareAddress: '02-11-22-33-44-55', bytes: 10, sha256: '2'.repeat(64) })
    await seed.finishTest(test.id, 'SUBMITTED'); await seed.confirmTest(test.id, true, false)
    if (options.interruptedRecovery) {
      await seed.convertMode('SHARED_PRINTER', async () => {})
      const transaction = (await fs.readdir(directory)).find(name => name.startsWith('cold-transaction-'))!
      await fs.rename(path.join(directory, transaction, 'decision.sealed'), path.join(directory, transaction, 'decision.interrupted-evidence'))
    } else if (options.cold) {
      // Real cold conversion provenance, not a forged enabled/cold profile.
      await seed.convertMode('SHARED_PRINTER', async () => {})
      const intermediate = new profileModule.NetworkAddonProfile(profileOptions); await intermediate.open()
      await intermediate.convertMode('FRONT_ONLY', async () => {})
    } else if (options.enabled !== false) await seed.setEnabled(true)
  }
  const before = await hashes(directory)
  const counts = { profiles: 0, pollers: 0, starts: 0, stops: 0, resume: 0, recovery: 0, enables: 0, pauses: 0 }
  let profile!: profileModule.NetworkAddonProfile, lifecycle!: ColdModeLifecycle, poller!: RelayPoller
  let unreachable = options.unreachable ?? false, missingBinding = options.missingBinding ?? false
  let validationHold: ReturnType<typeof deferred> | undefined
  const validateReached = deferred()
  const client = { receive: vi.fn(async () => null), markExecuting: vi.fn(async () => {}), reportResult: vi.fn(async () => {}),
    networkQueueState: vi.fn(async () => ({ pending: 0, claimed: 0, executing: 0, unknown: 0 })) }
  const deliver = vi.fn(async () => ({ bytesWritten: 10, durationMs: 1, effectBoundary: 'CROSSED' as const }))
  const render = vi.fn(async (_request: contract.NetworkRequest) => Uint8Array.from([1, 2, 3]))
  const ready: Promise<unknown>[] = []
  const app = Object.assign(new EventEmitter(), {
    getPath: () => root, setPath: vi.fn(), getVersion: () => 'TEST-ONLY',
    requestSingleInstanceLock: vi.fn(() => true), exit: vi.fn(), quit: vi.fn(),
    getLoginItemSettings: () => ({ launchItems: [] }), setLoginItemSettings: vi.fn(),
    whenReady: () => ({ then: (callback: () => unknown) => {
      const promise = Promise.resolve().then(callback); ready.push(promise); return promise
    } }),
  })
  const windows: FakeWindow[] = []
  class FakeWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } } })
    show = vi.fn(); focus = vi.fn(); hide = vi.fn(); loadFile = vi.fn(async () => {})
    isDestroyed() { return false }
    constructor(_options: unknown) { super(); windows.push(this) }
  }
  let trayMenu: { label: string; click(): void }[] = []
  const electron = { app, BrowserWindow: FakeWindow, dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
    ipcMain: { handle: vi.fn() }, Menu: { buildFromTemplate: (items: typeof trayMenu) => { trayMenu = items; return items } },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString() }, shell: {},
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
  }
  let entryModule = coordinatorModule
  if (options.old) {
    const exports = {}
    runInNewContext(compile(source('entryCoordinator', true)), { exports, require: (name: string) => {
      if (name === 'node:path') return path
      throw new Error(`UNEXPECTED_BASELINE_IMPORT:${name}`)
    } })
    entryModule = exports as typeof coordinatorModule
  }
  const imports: Record<string, unknown> = {
    electron, 'node:crypto': { createHash, randomUUID }, 'node:fs/promises': fs, 'node:child_process': { spawn: () => { throw new Error('NO_REAL_PROCESS') } },
    'node:path': path, 'node:url': url,
    '../src/cloudRelayClient': { CloudRelayClient: class { constructor() { return client } } },
    '../src/desktopBindingIdentity': { desktopBindingIdentityPath: () => 'synthetic-binding', readDesktopBindingIdentity: async () => {
      if (missingBinding) throw new Error('DESKTOP_BINDING_NOT_ACTIVE')
      return { ...identity, deviceSecret: 'synthetic-test-secret' }
    } },
    '../src/managedPrintChildIdentity': { consumeManagedPrintChildIdentity: async () => {
      if (missingBinding) return null
      return { ...identity, deviceSecret: 'synthetic-test-secret', bindingState: 'CLOUD_BOUND' }
    } },
    '../src/networkNodeConfig': { ...nodes, protectNetworkDirectory: async () => {} },
    '../src/networkContract': contract,
    '../src/networkDiscovery': { ...discovery, getWindowsLocalNetworks: async () => ({ interfaces, routes: [] }),
      getWindowsEndpointContinuitySnapshot: async () => ({}),
      assertReachableConfirmedPrinter: async () => {
        validateReached.resolve(); if (validationHold) await validationHold.promise
        if (unreachable) throw new Error('NETWORK_PRINTER_UNREACHABLE')
      },
      validateLocalPrinterEndpoint: () => endpoint, networkContinuityFingerprint: () => '1'.repeat(64),
      readLocalPrinterHardware: async () => '02-11-22-33-44-55', assertConfirmedPrinter: async () => ({ localAddress: '10.20.30.1' }),
      validateConfirmedPrinterPath: async () => {}, assertConfirmedPrinterContinuity: async () => {},
    },
    '../src/printing/networkRawTcpTransport': { ...rawTransport, NetworkRawTcpTransport: class { deliver = deliver } },
    '../src/relayPoller': { RelayPoller: class extends RelayPoller {
      constructor(value: ConstructorParameters<typeof RelayPoller>[0]) { super(value); counts.pollers++; poller = this }
      start() { counts.starts++; super.start() }
      async stopAndWait() { counts.stops++; await super.stopAndWait() }
    } },
    '../src/resultLog': { RelayResultLog },
    '../src/networkRuntime': { ...runtime, createNetworkRenderer: () => ({ render, dispose: vi.fn() }) },
    './profile': { ...profileModule, NetworkAddonProfile: class extends profileModule.NetworkAddonProfile {
      constructor(value: ConstructorParameters<typeof profileModule.NetworkAddonProfile>[0]) {
        super({ ...value, interfaces: () => interfaces }); counts.profiles++; profile = this
      }
    } },
    './coldModeLifecycle': { ColdModeLifecycle: class extends ColdModeLifecycle {
      constructor(value: ConstructorParameters<typeof ColdModeLifecycle>[0]) { super(value); lifecycle = this }
      async resumeAtStartup(...args: Parameters<ColdModeLifecycle['resumeAtStartup']>) { counts.resume++; await super.resumeAtStartup(...args) }
      beginStartupRecovery(...args: Parameters<ColdModeLifecycle['beginStartupRecovery']>) { counts.recovery++; return super.beginStartupRecovery(...args) }
      async enable(...args: Parameters<ColdModeLifecycle['enable']>) { counts.enables++; await super.enable(...args) }
      async pause() { counts.pauses++; await super.pause() }
    } },
    './entryCoordinator': entryModule, './shortcutLifecycle': {}, './shortcutWindows': {},
  }
  type Api = { status(): Promise<Record<string, any>>; perform(action: string, value?: unknown): Promise<any>;
    entry: coordinatorModule.EntryCoordinator; dispatchEntry(intent: coordinatorModule.EntryIntent): Promise<void> }
  const context = { exports: {}, require: (name: string) => {
    if (!(name in imports)) throw new Error(`UNEXPECTED_IMPORT:${name}`)
    return imports[name]
  }, __dirname, process: { platform: 'win32', arch: 'x64', env: {}, execPath: 'synthetic.exe', argv: ['synthetic.exe', ...(options.args ?? ['--settings-only'])] },
  Buffer, Uint8Array, AbortController, AbortSignal, URL, URLSearchParams, Error,
  fetch: () => { throw new Error('NO_REAL_HTTP') }, __api: undefined as Api | undefined }
  runInNewContext(compile(`${source('main', options.old)}\nglobalThis.__api = { status, perform, entry, dispatchEntry };`), context)
  async function settle() {
    // Electron callbacks handle their own rejection (including bad second-instance
    // arguments). Observe completion without bypassing their production catch.
    for (let index = 0; index < ready.length; index++) await ready[index].catch(() => {})
    await Promise.resolve()
  }
  await settle()
  const api = context.__api!
  releases.push(async () => { if (lifecycle) await lifecycle.safeExit() })
  return { ...api, before, directory, app, windows, counts, client, deliver, render, validateReached,
    get profile() { return profile }, get lifecycle() { return lifecycle }, get poller() { return poller },
    get menu() { return trayMenu }, settle,
    reachable() { unreachable = false }, bind() { missingBinding = false },
    holdValidation() { validationHold = deferred(); return validationHold },
    async second(args: string[]) { app.emit('second-instance', {}, ['synthetic.exe', ...args]); await settle() },
    snapshot() { return { ...counts, timers: vi.getTimerCount(), waiting: lifecycle?.recoveryWaiting,
      generation: (lifecycle as unknown as { recoveryGeneration: number })?.recoveryGeneration,
      started: lifecycle?.everStartedPoller, enabled: profile?.snapshot().enabled } },
  }
}

function uiFixture(old = false) {
  const elements = new Map<string, any>()
  const element = (id: string): any => {
    if (!elements.has(id)) elements.set(id, { textContent: '', checked: false, disabled: false, dataset: {}, options: [],
      value: '', addEventListener: vi.fn(), replaceChildren: vi.fn(), append: vi.fn() })
    return elements.get(id)
  }
  const context = { exports: {}, document: { getElementById: element,
    querySelector: (query: string) => query === 'main' ? element('main') : { value: 'FRONT_ONLY' }, querySelectorAll: () => [] },
  window: { networkAddon: { invoke: () => new Promise(() => {}) } }, setInterval: vi.fn(),
  __render: undefined as ((state: Record<string, any>) => void) | undefined }
  runInNewContext(compile(`${source('ui', old)}\nglobalThis.__render = render;`), context)
  return { element, render: context.__render! }
}

describe('M1 actual main settings-only lifecycle', () => {
  it.each([false, true])('enabled settings-only, unreachable=%s: zero automatic activity and byte-identical profile/journal', async unreachable => {
    const f = await mainFixture({ unreachable })
    expect(await f.status()).toMatchObject({ activation: 'PENDING', enabled: true, code: 'SETTINGS_ONLY_PENDING', settingsRequest: 1 })
    expect(f.snapshot()).toMatchObject({ profiles: 1, pollers: 1, starts: 0, stops: 0, resume: 0, recovery: 0, timers: 0, generation: 0 })
    await vi.advanceTimersByTimeAsync(120_000)
    for (const spy of [f.client.receive, f.client.markExecuting, f.client.reportResult, f.client.networkQueueState, f.deliver, f.render]) expect(spy).not.toHaveBeenCalled()
    const after = await hashes(f.directory)
    expect(after).toEqual(f.before)
    console.info('M1_PROFILE_JOURNAL_EVIDENCE', JSON.stringify({ unreachable, before: f.before, after }))
    expect(Object.keys(f.before)).toContain('profile.sealed')
    expect(f.profile.journal.records()).toEqual([])
  })

  it.each([false, true])('paused/first setup stays pending without automatic activation (fresh=%s)', async fresh => {
    const f = await mainFixture({ enabled: false, fresh })
    expect(await f.status()).toMatchObject({ activation: 'PENDING', enabled: false })
    expect(f.snapshot()).toMatchObject({ starts: 0, resume: 0, recovery: 0, timers: 0 })
    if (fresh) {
      expect(f.before).toEqual({})
      expect(Object.keys(await hashes(f.directory))).toEqual(expect.arrayContaining(['profile.sealed', 'execution-journal.json']))
    } else expect(await hashes(f.directory)).toEqual(f.before)
  })

  it('retains existing interrupted profile.open recovery without activation or journal rewriting', async () => {
    const f = await mainFixture({ interruptedRecovery: true })
    const after = await hashes(f.directory)
    expect(f.profile.recoveryPaused).toBe(true)
    expect(f.profile.snapshot()).toMatchObject({ enabled: false, mode: 'FRONT_ONLY' })
    expect(after['profile.sealed']).not.toBe(f.before['profile.sealed'])
    expect(after['execution-journal.json']).toBe(f.before['execution-journal.json'])
    expect(after['nodes-1.sealed']).toBe(f.before['nodes-1.sealed'])
    expect(f.snapshot()).toMatchObject({ starts: 0, resume: 0, recovery: 0, timers: 0 })
    expect(f.client.receive).not.toHaveBeenCalled(); expect(f.deliver).not.toHaveBeenCalled()
    console.info('M1_EXISTING_PROFILE_RECOVERY_EVIDENCE', JSON.stringify({ before: f.before, after,
      explanation: 'Existing profile.open restores original FRONT_ONLY authority after an interrupted cold conversion; journal unchanged.' }))
  })

  it('rejects conflicting second-instance intents without consuming pending activation', async () => {
    const f = await mainFixture()
    for (const args of [['--settings-only', '--manage'], ['--settings-only', '--silent-shortcuts'], ['--settings-only', '--install-shortcuts']]) {
      await f.second(args)
    }
    expect(f.snapshot()).toMatchObject({ starts: 0, resume: 0, recovery: 0, timers: 0 })
    expect(await f.status()).toMatchObject({ activation: 'PENDING', enabled: true })
  })

  it('UI, normal second-instance and Tray converge during validation and consume startup exactly once', async () => {
    const f = await mainFixture(), hold = f.holdValidation()
    const ui = f.perform('enable', confirmation)
    await f.validateReached.promise
    const second = f.second(['--background'])
    f.menu.find(item => item.label === '管理与维护')!.click()
    expect(f.counts.resume).toBe(1)
    hold.resolve(); await Promise.all([ui, second]); await f.settle()
    expect(await f.status()).toMatchObject({ activation: 'DONE', enabled: true, code: 'RUNNING' })
    expect(f.snapshot()).toMatchObject({ pollers: 1, starts: 1, resume: 1, enables: 0, pauses: 0 })
    await f.second(['--manage']); await f.second(['--background'])
    expect(f.counts.starts).toBe(1)
  })

  it.each(['second', 'tray', 'ui'] as const)('a sole %s request starts the pending runtime through the shared activation', async trigger => {
    const f = await mainFixture()
    if (trigger === 'ui') await f.perform('enable', confirmation)
    else if (trigger === 'second') await f.second(['--background'])
    else { f.menu.find(item => item.label === '管理与维护')!.click(); await f.entry.activate() }
    expect(f.counts.resume).toBe(1); expect(f.counts.starts).toBe(1); expect(f.counts.enables).toBe(0)
  })

  it('RUNNING + settings only shows/focuses setup; it neither pauses nor restarts', async () => {
    const f = await mainFixture({ args: ['--manage'] }), before = f.snapshot(), bytes = await hashes(f.directory)
    await f.second(['--settings-only']); await f.second(['--settings-only'])
    expect(f.snapshot()).toEqual(before)
    expect(await hashes(f.directory)).toEqual(bytes)
    expect(await f.status()).toMatchObject({ activation: 'DONE', code: 'RUNNING', enabled: true, settingsRequest: 2 })
    expect(f.windows).toHaveLength(1); expect(f.windows[0].show).toHaveBeenCalledTimes(2); expect(f.windows[0].focus).toHaveBeenCalledTimes(2)
    const ui = uiFixture(); ui.render(await f.status()); expect(ui.element('main').dataset.view).toBe('setup')
  })

  it('settings retryBinding initializes dependencies but never consumes activation', async () => {
    const f = await mainFixture({ missingBinding: true })
    expect(f.counts.profiles).toBe(0); f.bind(); await f.perform('retryBinding', {})
    expect(await f.status()).toMatchObject({ activation: 'PENDING', enabled: true, code: 'SETTINGS_ONLY_PENDING' })
    expect(f.snapshot()).toMatchObject({ starts: 0, resume: 0, timers: 0 })
  })

  it('settings-only second-instance retries a resident process that started before the handoff', async () => {
    const f = await mainFixture({ missingBinding: true })
    expect(f.counts.profiles).toBe(0)

    f.bind()
    await f.second(['--settings-only'])

    expect(f.counts.profiles).toBe(1)
    expect(await f.status()).toMatchObject({ activation: 'PENDING', enabled: true, code: 'SETTINGS_ONLY_PENDING' })
    expect(f.snapshot()).toMatchObject({ starts: 0, resume: 0, timers: 0 })
    expect(f.windows).toHaveLength(1)
  })

  it('normal retryBinding retains existing automatic startup after the explicit retry', async () => {
    const f = await mainFixture({ args: ['--manage'], missingBinding: true })
    f.bind(); await f.perform('retryBinding', {})
    expect(await f.status()).toMatchObject({ activation: 'DONE', enabled: true, code: 'RUNNING' })
    expect(f.counts.starts).toBe(1)
  })

  it('pending enabled=false uses existing enable after consuming the no-op startup; later entries do not restart it', async () => {
    const f = await mainFixture({ enabled: false })
    await f.perform('enable', confirmation); await f.second(['--background'])
    expect(await f.status()).toMatchObject({ activation: 'DONE', enabled: true, code: 'RUNNING' })
    expect(f.snapshot()).toMatchObject({ resume: 1, enables: 1, starts: 1 })
  })

  it('pause during pending retains disabled state through later startup; a deliberate enable still works', async () => {
    const f = await mainFixture()
    await f.perform('pause', {}); await f.second(['--manage'])
    expect(f.counts.starts).toBe(0); expect(f.profile.snapshot().enabled).toBe(false)
    await f.perform('enable', confirmation); expect(f.counts.starts).toBe(1)
  })

  it('exit waits for in-flight startup, drains it, and forbids later activation', async () => {
    const f = await mainFixture(), hold = f.holdValidation(), start = f.perform('enable', confirmation)
    await f.validateReached.promise
    const exit = f.perform('exit', {}); hold.resolve(); await Promise.all([start, exit])
    expect(f.lifecycle.restartRequired).toBe(true); expect(vi.getTimerCount()).toBe(0)
    expect(() => f.entry.activate()).toThrow('ADDON_EXIT_IN_PROGRESS')
  })

  it('even an unexpected activation rejection is consumed once; only dependency failure is retryable', async () => {
    const activateAtStartup = vi.fn(async () => { throw new Error('ADDON_PROFILE_RESTART_REQUIRED') })
    const entry = new coordinatorModule.EntryCoordinator({ initialize: async () => {}, activateAtStartup,
      readCashier: async () => ({ config: { mode: 'FRONT_ONLY', endpoint }, revision: 1, warning: false }),
      confirmWarning: async () => false, openCashier: async () => {}, showManagement: () => {}, errorCode: () => 'ERROR' })
    await expect(entry.activate()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expect(entry.activate()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    expect(activateAtStartup).toHaveBeenCalledTimes(1)
  })

  it('neutral PENDING presentation preserves explicit pause-before-TEST and explicit enable confirmation', async () => {
    const f = await mainFixture(), ui = uiFixture()
    ui.element('single-agent').checked = true; ui.element('test-ready').checked = true
    ui.render(await f.status())
    expect(ui.element('main').dataset.view).toBe('setup')
    expect(ui.element('pill').textContent).toBe('自动打印未启动')
    expect(ui.element('status-message').textContent).toContain('尚未启动自动打印')
    expect(ui.element('enable').disabled).toBe(false); expect(ui.element('test').disabled).toBe(true)
    await expect(f.perform('enable', { ...confirmation, singleAgentConfirmed: false })).rejects.toThrow('ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED')
    expect(f.counts.resume).toBe(0)
    await f.perform('pause', {}); ui.render(await f.status()); expect(ui.element('test').disabled).toBe(false)
  })

  it('TEST and physical confirmation reuse the old path and never activate either settings-only or paused manage', async () => {
    for (const old of [true, false]) {
      const f = await mainFixture({ old, args: old ? ['--manage'] : ['--settings-only'], enabled: false })
      const result = await f.perform('test', { mode: 'FRONT_ONLY', role: 'FRONT', ...endpoint })
      expect(f.deliver).toHaveBeenCalledTimes(1)
      expect(f.render.mock.calls[0][0].requestId).toMatch(/^TEST-/)
      expect(f.render.mock.calls[0][0].order.totalAmount).toBe(0)
      await f.perform('confirmTest', { id: result.testId, paperConfirmed: true, sameOriginalPrinter: true, ...confirmation })
      expect(f.profile.snapshot()).toMatchObject({ enabled: false, test: { outcome: 'CONFIRMED' } })
      expect(f.counts.starts).toBe(0); expect(f.client.receive).not.toHaveBeenCalled(); expect(f.client.markExecuting).not.toHaveBeenCalled()
      if (!old) expect(await f.status()).toMatchObject({ activation: 'PENDING' })
    }
  })

  it.each(['--manage', '--cashier', '--background', '--settings-only', '--install-shortcuts', '--uninstall-shortcuts', '--silent-shortcuts'])
    ('settings + %s fails before initialization, single-instance admission or activation', async conflict => {
      const f = await mainFixture({ args: ['--settings-only', conflict] })
      expect(f.app.exit).toHaveBeenCalledWith(8); expect(f.app.requestSingleInstanceLock).not.toHaveBeenCalled()
      expect(f.snapshot()).toMatchObject({ profiles: 0, pollers: 0, starts: 0, timers: 0 })
    })
})

describe('RC10 baseline differential — actual full main source', () => {
  for (const args of [[], ['--manage'], ['--cashier'], ['--background']]) {
    it.each(['reachable', 'unreachable', 'cold', 'paused'] as const)(`${args.join(' ') || 'no args'} / %s`, async condition => {
      const snapshots: unknown[] = []
      for (const old of [true, false]) {
        const f = await mainFixture({ old, args, enabled: condition !== 'paused', unreachable: condition === 'unreachable', cold: condition === 'cold' })
        const first = { ...f.snapshot(), code: (await f.status()).code }
        if (condition === 'unreachable') {
          await vi.advanceTimersByTimeAsync(29_999); expect(f.counts.resume).toBe(1)
          f.reachable(); await vi.advanceTimersByTimeAsync(1)
          // The real validator loads files; flush async disk work before comparing.
          for (let i = 0; i < 100 && !f.lifecycle.everStartedPoller; i++) await new Promise(resolve => setImmediate(resolve))
          expect(f.lifecycle.everStartedPoller).toBe(true)
        }
        snapshots.push({ first, after: { ...f.snapshot(), code: (await f.status()).code } })
        await f.lifecycle.safeExit(); vi.clearAllTimers()
      }
      expect(snapshots[1]).toEqual(snapshots[0])
    })
  }

  it('moves the startup try/catch verbatim and leaves TEST and protected core byte-identical', () => {
    const declaration = (text: string, name: string) => {
      const parsed = ts.createSourceFile('main.ts', text, ts.ScriptTarget.ES2022, true)
      return parsed.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name) as ts.FunctionDeclaration
    }
    const previous = source('main', true), current = source('main')
    const tryBlock = (node: ts.FunctionDeclaration) => node.body!.statements.find(ts.isTryStatement)!.getText()
    expect(tryBlock(declaration(current, 'activateAtStartup'))).toBe(tryBlock(declaration(previous, 'initialize')))
    expect(declaration(current, 'sendTest').getText()).toContain('TEST 请确认打印目标 · 非营业订单')
    expect(declaration(current, 'sendTest').getText()).toContain('beginReplacementTest')
    for (const file of ['network-addon/coldModeTransaction.ts', 'src/networkRuntime.ts', 'src/relayPoller.ts',
      'src/executionJournal.ts', 'src/printing/networkRawTcpTransport.ts']) {
      expect(readFileSync(path.join(repo, 'e-shop-tray', file))).toEqual(execFileSync('git', ['show', `${baseline}:e-shop-tray/${file}`], { cwd: repo }))
    }
  })
})
