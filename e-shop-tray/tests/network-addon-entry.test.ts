import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { EntryCoordinator, entryIntent, readCashierEntry, networkLoginItem, type CashierEntry } from '../network-addon/entryCoordinator'
import { NetworkAddonProfile } from '../network-addon/profile'
import { ColdModeLifecycle } from '../network-addon/coldModeLifecycle'

const protector = { protect: (text: string) => Buffer.from(text).toString('base64'), unprotect: (text: string) => Buffer.from(text, 'base64').toString() }
const identity = { installationId: 'test-entry-installation', computerId: 'test-entry-computer', storeCode: 'TEST-ENTRY', boundAt: '2026-09-10' }
const endpoint = { host: '10.20.30.2', port: 9100 }
const interfaces: ReturnType<typeof os.networkInterfaces> = { LAN: [{ address: '10.20.30.1', netmask: '255.255.255.0',
  family: 'IPv4', internal: false, mac: '00:00:00:00:00:01', cidr: '10.20.30.1/24' }] }
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function coordinator(overrides: Partial<ConstructorParameters<typeof EntryCoordinator>[0]> = {}) {
  const ports = { initialize: vi.fn(async () => {}),
    readCashier: vi.fn(async (): Promise<CashierEntry> => ({ config: { mode: 'FRONT_ONLY', endpoint }, revision: 1, warning: false })),
    confirmWarning: vi.fn(async () => true), openCashier: vi.fn(async () => {}), showManagement: vi.fn(),
    errorCode: (error: unknown) => error instanceof Error ? error.message : 'ERROR', ...overrides }
  return { entry: new EntryCoordinator(ports), ports }
}
async function configured() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'addon-entry-'))
  let localInterfaces = interfaces
  const options = { directory, identity, protector, interfaces: () => localInterfaces }
  const profile = new NetworkAddonProfile(options)
  await profile.open()
  const test = await profile.beginTest({ id: randomUUID(), mode: 'FRONT_ONLY', endpoint,
    networkFingerprint: '1'.repeat(64), hardwareAddress: '02-11-22-33-44-55', bytes: 10, sha256: '2'.repeat(64) })
  await profile.finishTest(test.id, 'SUBMITTED'); await profile.confirmTest(test.id, true, false)
  const ports = { client: { networkQueueState: vi.fn(async () => ({ pending: 0, claimed: 0, executing: 0, unknown: 0 })) },
    stopAndWait: vi.fn(async () => {}), assertIdentity: vi.fn(async () => {}), validate: vi.fn(async () => {}), start: vi.fn(), exit: vi.fn(async () => {}) }
  const lifecycle = new ColdModeLifecycle({ profile, ...ports })
  const read = () => readCashierEntry({ profile, restartRequired: lifecycle.restartRequired,
    printingReady: lifecycle.everStartedPoller && profile.snapshot().enabled, assertIdentity: ports.assertIdentity })
  return { directory, options, profile, lifecycle, ports, read, offline() { localInterfaces = {} } }
}
async function bytes(directory: string) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).map(async name => [name, (await readFile(path.join(directory, name))).toString('base64')])))
}

async function mainCashierFixture(hold?: 'ticket-fetch' | 'final-identity') {
  const filename = path.join(__dirname, '../network-addon/main.ts'), source = await readFile(filename, 'utf8')
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const functions = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'openCashier')
  const server = parsed.statements.filter(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'SERVER'))
  expect(functions).toHaveLength(1); expect(server).toHaveLength(1)
  // Execute the actual source function and fixed SERVER declaration. Only OS,
  // identity and HTTP boundaries are substituted; no parallel launcher exists.
  const compiled = ts.transpileModule(`${server[0].getText(parsed)}\n${functions[0].getText(parsed)}\nopenCashier`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename,
  }).outputText
  const reached = deferred(), release = deferred(), ticket = `ecl_v1_${'T'.repeat(40)}`
  const bound = { installationId: 'synthetic-bound-store-installation', deviceSecret: 'synthetic-bound-store-secret', storeCode: 'TEST-BOUND-STORE' }
  const chrome = 'C:\\Users\\Fixture\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
  const unref = vi.fn()
  const spawn = vi.fn((executable: string, args: string[], options: { shell: boolean; detached: boolean; stdio: string; windowsHide: boolean }) => {
    const child = Object.assign(new EventEmitter(), { unref })
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  let identityReads = 0
  const assertIdentity = vi.fn(async () => {
    if (++identityReads === 2 && hold === 'final-identity') { reached.resolve(); await release.promise }
  })
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (hold === 'ticket-fetch') { reached.resolve(); await release.promise }
    return { ok: true, text: async () => JSON.stringify({ ticket }) }
  })
  const context = { process: { env: { LOCALAPPDATA: 'C:\\Users\\Fixture\\AppData\\Local' } }, path: path.win32,
    lstat: vi.fn(async (candidate: string) => { expect(candidate).toBe(chrome); return { isFile: () => true, isSymbolicLink: () => false } }),
    assertIdentity, fetch, spawn, binding: bound, entry: undefined as EntryCoordinator | undefined,
    URL, URLSearchParams, AbortSignal, Error }
  const openCashier = runInNewContext(compiled, context, { filename, timeout: 1000 }) as (config: CashierEntry['config']) => Promise<void>
  return { openCashier, attach(entry: EntryCoordinator) { context.entry = entry }, reached, release, ticket, bound, chrome,
    spawn, unref, fetch, assertIdentity }
}

describe('the actual main-process cashier launcher', () => {
  it.each(['ticket-fetch', 'final-identity'] as const)('does not spawn Chrome when safe exit starts during %s', async hold => {
    const launcher = await mainCashierFixture(hold), f = coordinator({ openCashier: launcher.openCashier })
    launcher.attach(f.entry)
    const launch = f.entry.launchCashier(), rejected = expect(launch).rejects.toThrow('ADDON_EXIT_IN_PROGRESS')
    await launcher.reached.promise
    expect(launcher.fetch).toHaveBeenCalledTimes(1); expect(launcher.spawn).not.toHaveBeenCalled()
    const finish = vi.fn(async () => {}), exiting = f.entry.exit(finish)
    expect(f.entry.isExiting).toBe(true); expect(finish).not.toHaveBeenCalled()
    launcher.release.resolve()
    await Promise.all([rejected, exiting])
    expect(launcher.spawn).not.toHaveBeenCalled(); expect(launcher.unref).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledTimes(1); expect(f.entry.entryCode).toBe('ADDON_EXIT_IN_PROGRESS')
    expect(launcher.assertIdentity).toHaveBeenCalledTimes(2)
  })

  it.each(['FRONT_ONLY', 'SHARED_PRINTER'] as const)('opens the bound store ticket at the fixed Network cashier URL in %s', async mode => {
    const launcher = await mainCashierFixture()
    const f = coordinator({ openCashier: launcher.openCashier,
      readCashier: async () => ({ config: { mode, endpoint }, revision: 1, warning: false }) })
    launcher.attach(f.entry); await f.entry.launchCashier()
    expect(launcher.fetch).toHaveBeenCalledTimes(1)
    const [requestUrl, request] = launcher.fetch.mock.calls[0]
    expect(requestUrl).toBe('https://elifekh.com/api/computer-client/bindings/self/launch-ticket')
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', body: '{}',
      headers: { 'Content-Type': 'application/json', 'x-installation-id': launcher.bound.installationId,
        Authorization: `Bearer ${launcher.bound.deviceSecret}` } })
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(launcher.spawn).toHaveBeenCalledTimes(1)
    const [executable, args, options] = launcher.spawn.mock.calls[0]
    expect(executable).toBe(launcher.chrome); expect(args).toHaveLength(1)
    expect(options).toEqual({ shell: false, detached: true, stdio: 'ignore', windowsHide: false })
    const url = new URL(args[0])
    expect(url.origin).toBe('https://elifekh.com'); expect(url.pathname).toBe('/cashier/launch'); expect(url.search).toBe('')
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({ ticket: launcher.ticket, networkPrint: 'v01', networkMode: mode })
    // Store selection remains server-bound to this installation's one-time
    // ticket, never a freely supplied store parameter or legacy print fallback.
    expect(args[0]).not.toContain(launcher.bound.deviceSecret); expect(args[0]).not.toContain('storeCode=')
    expect(launcher.unref).toHaveBeenCalledTimes(1); expect(launcher.assertIdentity).toHaveBeenCalledTimes(2)
    expect(f.entry.entryCode).toBe('ENTRY_OPENED')
  })
})

describe('the single resident entry coordinator', () => {
  it('reads only the exact current-user product login item and preserves a Windows-disabled entry', () => {
    const row = { name: 'EShopNetworkPrintAddon', scope: 'user', path: 'C:\\Apps\\E-Shop-Network-Print-Addon.exe', args: [], enabled: false }
    expect(networkLoginItem([row], row.path)).toEqual({ enabled: false, background: false })
    expect(networkLoginItem([{ ...row, args: ['--background'], enabled: true }], row.path.toLowerCase()))
      .toEqual({ enabled: true, background: true })
    for (const change of [{ name: 'Other' }, { scope: 'machine' }, { path: 'C:\\Other.exe' }, { args: ['--custom'] }]) {
      expect(networkLoginItem([{ ...row, ...change }], row.path)).toBeNull()
    }
    expect(networkLoginItem([], row.path)).toBeNull()
    expect(networkLoginItem([row, row], row.path)).toBeNull()
  })
  it('keeps explicit shortcut maintenance available after missing binding without retrying initialization', async () => {
    const f = coordinator({ initialize: vi.fn(async () => { throw new Error('DESKTOP_BINDING_NOT_ACTIVE') }) })
    await expect(f.entry.initialize()).rejects.toThrow('DESKTOP_BINDING_NOT_ACTIVE')
    const maintenance = vi.fn(async () => 'management-only')
    await expect(f.entry.runOperation(maintenance, false, true)).resolves.toBe('management-only')
    expect(f.ports.initialize).toHaveBeenCalledTimes(1)
    expect(f.ports.openCashier).not.toHaveBeenCalled()
    await expect(f.entry.launchCashier()).rejects.toThrow('DESKTOP_BINDING_NOT_ACTIVE')
    expect(f.ports.openCashier).not.toHaveBeenCalled()
    await f.entry.exit(async () => {})
    expect(() => f.entry.runOperation(maintenance, false, true)).toThrow('ADDON_EXIT_IN_PROGRESS')
  })

  it('recognizes only explicit intents and preserves no-argument management compatibility', () => {
    expect(entryIntent(['program.exe'])).toBe('manage')
    for (const intent of ['cashier', 'manage', 'background'] as const) expect(entryIntent(['program.exe', `--${intent}`])).toBe(intent)
    expect(entryIntent(['program.exe', '--cashier=https://other.example'])).toBe('manage')
    expect(() => entryIntent(['--cashier', '--manage'])).toThrow('ADDON_ENTRY_ARGUMENTS_REJECTED')
    expect(() => entryIntent(['--cashier', '--cashier'])).toThrow('ADDON_ENTRY_ARGUMENTS_REJECTED')
  })

  it('coalesces initialization and concurrent startup/second-instance/tray clicks into one ticket/spawn', async () => {
    const init = deferred(), entered = deferred(), opened = deferred()
    const f = coordinator({ initialize: vi.fn(() => init.promise), openCashier: vi.fn(async () => { entered.resolve(); await opened.promise }) })
    const initial = f.entry.initialize(), one = f.entry.launchCashier(), two = f.entry.launchCashier()
    expect(one).toBe(two); expect(f.entry.busy).toBe(true)
    await Promise.resolve(); expect(f.ports.initialize).toHaveBeenCalledTimes(1); expect(f.ports.readCashier).not.toHaveBeenCalled()
    init.resolve(); await initial; await entered.promise
    expect(f.ports.openCashier).toHaveBeenCalledTimes(1); expect(f.entry.entryPending).toBe(true)
    opened.resolve(); await Promise.all([one, two])
    expect(f.entry.entryPending).toBe(false); expect(f.entry.entryCode).toBe('ENTRY_OPENED')
    await f.entry.launchCashier(); expect(f.ports.openCashier).toHaveBeenCalledTimes(2); expect(f.ports.initialize).toHaveBeenCalledTimes(1)
  })

  it('does not run setup initialization concurrently with a management operation', async () => {
    const init = deferred(), action = vi.fn(async () => {})
    const f = coordinator({ initialize: vi.fn(() => init.promise) })
    const startup = f.entry.initialize(), operation = f.entry.runOperation(action)
    await Promise.resolve(); expect(action).not.toHaveBeenCalled()
    await expect(f.entry.runOperation(async () => {})).rejects.toThrow('ADDON_BUSY')
    init.resolve(); await Promise.all([startup, operation])
    expect(f.ports.initialize).toHaveBeenCalledTimes(1); expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not automatically retry failed binding and opens setup for an explicit cashier request', async () => {
    const initialize = vi.fn().mockRejectedValueOnce(new Error('DESKTOP_BINDING_NOT_ACTIVE')).mockResolvedValue(undefined)
    const f = coordinator({ initialize })
    await expect(f.entry.dispatch('cashier')).rejects.toThrow('DESKTOP_BINDING_NOT_ACTIVE')
    await expect(f.entry.launchCashier()).rejects.toThrow('DESKTOP_BINDING_NOT_ACTIVE')
    expect(initialize).toHaveBeenCalledTimes(1); expect(f.ports.openCashier).not.toHaveBeenCalled()
    expect(f.ports.showManagement).toHaveBeenCalledTimes(2); expect(f.entry.entryCode).toBe('DESKTOP_BINDING_NOT_ACTIVE')
    await f.entry.runOperation(async () => {}, true)
    await f.entry.launchCashier(); expect(initialize).toHaveBeenCalledTimes(2); expect(f.ports.openCashier).toHaveBeenCalledTimes(1)
  })

  it('management/background intents initialize without opening a cashier or duplicating the service', async () => {
    const f = coordinator()
    await f.entry.dispatch('background'); expect(f.ports.showManagement).not.toHaveBeenCalled()
    await f.entry.dispatch('manage'); expect(f.ports.showManagement).toHaveBeenCalledTimes(1)
    expect(f.ports.initialize).toHaveBeenCalledTimes(1); expect(f.ports.openCashier).not.toHaveBeenCalled()
  })

  it('requires explicit warning consent, coalesces the prompt and blocks concurrent enable/mode operations', async () => {
    const prompt = deferred<boolean>(), entered = deferred()
    const f = coordinator({ readCashier: vi.fn(async (): Promise<CashierEntry> => ({ config: { mode: 'FRONT_ONLY', endpoint }, revision: 1, warning: true })),
      confirmWarning: vi.fn(async () => { entered.resolve(); return prompt.promise }) })
    const one = f.entry.launchCashier(), two = f.entry.launchCashier(); await entered.promise
    await expect(f.entry.runOperation(async () => {})).rejects.toThrow('ADDON_BUSY')
    expect(f.ports.confirmWarning).toHaveBeenCalledTimes(1)
    prompt.resolve(false); await Promise.all([one, two])
    expect(f.ports.openCashier).not.toHaveBeenCalled(); expect(f.entry.entryCode).toBe('ENTRY_CANCELLED')
  })

  it('waits for a mode operation and rejects its restart-required aftermath before any ticket', async () => {
    const working = deferred(), entered = deferred(); let needsRestart = false
    const f = coordinator({ readCashier: vi.fn(async (): Promise<CashierEntry> => {
      if (needsRestart) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
      return { config: { mode: 'FRONT_ONLY', endpoint }, revision: 1, warning: false }
    }) })
    await f.entry.initialize()
    const operation = f.entry.runOperation(async () => { entered.resolve(); await working.promise; needsRestart = true })
    await entered.promise
    const launch = f.entry.launchCashier(); const rejected = expect(launch).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await Promise.resolve(); expect(f.ports.readCashier).not.toHaveBeenCalled()
    working.resolve(); await operation; await rejected
    expect(f.ports.openCashier).not.toHaveBeenCalled()
  })

  it('safe exit cancels a pending warning before launching and keeps exit available after failure', async () => {
    const prompt = deferred<boolean>(), entered = deferred()
    const f = coordinator({ readCashier: vi.fn(async (): Promise<CashierEntry> => ({ config: { mode: 'FRONT_ONLY', endpoint }, revision: 1, warning: true })),
      confirmWarning: vi.fn(async () => { entered.resolve(); return prompt.promise }) })
    const launch = f.entry.launchCashier(); const rejected = expect(launch).rejects.toThrow('ADDON_EXIT_IN_PROGRESS')
    await entered.promise
    const exit = vi.fn().mockRejectedValueOnce(new Error('EXIT_FAILED')).mockResolvedValue(undefined)
    const exiting = f.entry.exit(exit), failed = expect(exiting).rejects.toThrow('EXIT_FAILED')
    await expect(f.entry.launchCashier()).rejects.toThrow('ADDON_EXIT_IN_PROGRESS')
    prompt.resolve(true); await rejected; await failed
    expect(f.ports.openCashier).not.toHaveBeenCalled(); expect(f.ports.showManagement).not.toHaveBeenCalled()
    await f.entry.exit(exit); expect(exit).toHaveBeenCalledTimes(2)
  })

  it('safe exit waits for initialization without starting another service', async () => {
    const init = deferred(), exit = vi.fn(async () => {})
    const f = coordinator({ initialize: vi.fn(() => init.promise) })
    const startup = f.entry.initialize(), exiting = f.entry.exit(exit)
    await Promise.resolve(); expect(exit).not.toHaveBeenCalled()
    init.resolve(); await Promise.all([startup, exiting]); expect(exit).toHaveBeenCalledTimes(1)
    expect(f.ports.openCashier).not.toHaveBeenCalled(); expect(f.ports.initialize).toHaveBeenCalledTimes(1)
  })

  it('keeps launch failure separate, does not silently retry and permits a later explicit click', async () => {
    const openCashier = vi.fn().mockRejectedValueOnce(new Error('ADDON_BROWSER_AUTH_FAILED')).mockResolvedValue(undefined)
    const f = coordinator({ openCashier })
    await expect(f.entry.launchCashier()).rejects.toThrow('ADDON_BROWSER_AUTH_FAILED')
    expect(f.entry.entryCode).toBe('ADDON_BROWSER_AUTH_FAILED'); expect(f.entry.entryPending).toBe(false)
    expect(openCashier).toHaveBeenCalledTimes(1); expect(f.ports.showManagement).toHaveBeenCalledTimes(1)
    await f.entry.launchCashier(); expect(openCashier).toHaveBeenCalledTimes(2)
  })

  it('rechecks cold/configuration admission after a warning and never launches stale mode data', async () => {
    let reads = 0
    const f = coordinator({ readCashier: vi.fn(async (): Promise<CashierEntry> => {
      if (++reads > 1) throw new Error('ADDON_COLD_EXPLICIT_ENABLE_REQUIRED')
      return { config: { mode: 'FRONT_ONLY', endpoint }, revision: 1, warning: true }
    }) })
    await expect(f.entry.launchCashier()).rejects.toThrow('ADDON_COLD_EXPLICIT_ENABLE_REQUIRED')
    expect(f.ports.openCashier).not.toHaveBeenCalled()
  })
})

describe('cashier admission against the real protected profile and cold lifecycle', () => {
  it('opens an ordinary paused/offline configured store only after warning; preserves all state and starts no poller', async () => {
    const f = await configured(), before = await bytes(f.directory)
    f.offline()
    await expect(f.profile.read()).rejects.toThrow('ADDON_PAUSED_OR_UNCONFIGURED')
    const c = coordinator({ initialize: () => f.lifecycle.resumeAtStartup(), readCashier: f.read })
    await c.entry.launchCashier()
    expect(c.ports.confirmWarning).toHaveBeenCalledTimes(1)
    expect(c.ports.openCashier).toHaveBeenCalledWith({ mode: 'FRONT_ONLY', endpoint })
    expect(f.ports.start).not.toHaveBeenCalled(); expect(f.ports.client.networkQueueState).not.toHaveBeenCalled()
    expect(f.profile.snapshot().enabled).toBe(false); expect(await bytes(f.directory)).toEqual(before)
  })

  it('keeps the existing enabled startup as the only automatic resume and does not resume on later cashier clicks', async () => {
    const f = await configured()
    await f.profile.setEnabled(true)
    const next = new NetworkAddonProfile(f.options); await next.open()
    const lifecycle = new ColdModeLifecycle({ profile: next, ...f.ports })
    const c = coordinator({ initialize: () => lifecycle.resumeAtStartup(), readCashier: () => readCashierEntry({ profile: next,
      restartRequired: lifecycle.restartRequired, printingReady: lifecycle.everStartedPoller, assertIdentity: f.ports.assertIdentity }) })
    await c.entry.launchCashier(); await c.entry.launchCashier()
    expect(f.ports.start).toHaveBeenCalledTimes(1); expect(c.ports.confirmWarning).not.toHaveBeenCalled()
    await lifecycle.pause(); await c.entry.launchCashier()
    expect(f.ports.start).toHaveBeenCalledTimes(1); expect(c.ports.confirmWarning).toHaveBeenCalledTimes(1)
  })

  it('permits an explicitly acknowledged browser launch after startup printer validation failed, without starting it', async () => {
    const f = await configured(); await f.profile.setEnabled(true)
    const next = new NetworkAddonProfile(f.options); await next.open()
    f.ports.validate.mockRejectedValue(new Error('NETWORK_DEVICE_IDENTITY_UNAVAILABLE'))
    const lifecycle = new ColdModeLifecycle({ profile: next, ...f.ports })
    const c = coordinator({ initialize: async () => { try { await lifecycle.resumeAtStartup() } catch { /* main retains print diagnostic */ } },
      readCashier: () => readCashierEntry({ profile: next, restartRequired: lifecycle.restartRequired,
        printingReady: lifecycle.everStartedPoller, assertIdentity: f.ports.assertIdentity }) })
    await c.entry.launchCashier()
    expect(c.ports.confirmWarning).toHaveBeenCalledTimes(1); expect(c.ports.openCashier).toHaveBeenCalledTimes(1)
    expect(f.ports.start).not.toHaveBeenCalled()
  })

  it('rejects changed binding and corrupt persisted config before a warning or launch', async () => {
    const f = await configured(), c = coordinator({ readCashier: f.read })
    f.ports.assertIdentity.mockRejectedValue(new Error('NETWORK_BINDING_CHANGED_RESTART_REQUIRED'))
    await expect(c.entry.launchCashier()).rejects.toThrow('NETWORK_BINDING_CHANGED_RESTART_REQUIRED')
    f.ports.assertIdentity.mockResolvedValue(undefined)
    await writeFile(path.join(f.directory, 'nodes-1.sealed'), protector.protect('{}'))
    await expect(c.entry.launchCashier()).rejects.toThrow()
    expect(c.ports.confirmWarning).not.toHaveBeenCalled(); expect(c.ports.openCashier).not.toHaveBeenCalled()
  })

  it('blocks first-time configuration, unconfirmed TEST, cold activation and restart-required states', async () => {
    const f = await configured()
    const fresh = new NetworkAddonProfile({ ...f.options, directory: await mkdtemp(path.join(os.tmpdir(), 'addon-entry-empty-')) })
    await fresh.open()
    await expect(readCashierEntry({ profile: fresh, restartRequired: false, printingReady: false, assertIdentity: f.ports.assertIdentity }))
      .rejects.toThrow('ADDON_CASHIER_SETUP_REQUIRED')
    await f.profile.beginTest({ ...f.profile.snapshot().test!, id: randomUUID() })
    await expect(f.read()).rejects.toThrow('ADDON_TEST_CONFIRMATION_REQUIRED')
    const cold = await configured()
    await cold.lifecycle.convertAndExit('SHARED_PRINTER', { cashierTabsClosed: true, singleAgentConfirmed: true })
    await expect(cold.read()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    const next = new NetworkAddonProfile(cold.options); await next.open()
    const c = coordinator({ readCashier: () => readCashierEntry({ profile: next, restartRequired: false,
      printingReady: false, assertIdentity: cold.ports.assertIdentity }) })
    await expect(c.entry.launchCashier()).rejects.toThrow('ADDON_COLD_EXPLICIT_ENABLE_REQUIRED')
    expect(c.ports.openCashier).not.toHaveBeenCalled(); expect(c.ports.confirmWarning).not.toHaveBeenCalled()
  })
})
