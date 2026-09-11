import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_SHORTCUTS, reviewLegacyShortcuts, ShortcutLifecycle, type LegacyShortcutId, type ShortcutOptions, type ShortcutRegistration, type ShortcutResult, type ShortcutSpec } from '../network-addon/shortcutLifecycle'

const fault = vi.hoisted(() => ({ operation: '', target: '', after: false, action: null as null | (() => Promise<void>), throwError: true, code: 'EIO' }))
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  async function trigger(operation: string, target: string, after: boolean) {
    if (fault.operation !== operation || !target.includes(fault.target) || fault.after !== after) return
    fault.operation = ''
    const action = fault.action; fault.action = null
    if (action) await action()
    if (fault.throwError) throw Object.assign(new Error('injected filesystem failure'), { code: fault.code })
  }
  return { ...actual,
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
      await trigger('copy', String(args[1]), false); await actual.copyFile(...args); await trigger('copy', String(args[1]), true)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await trigger('rename', String(args[1]), false); await actual.rename(...args); await trigger('rename', String(args[1]), true)
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args), sync = handle.sync.bind(handle)
      handle.sync = async () => { await trigger('sync', String(args[0]), false); await sync(); await trigger('sync', String(args[0]), true) }
      return handle
    },
  }
})

describe('object-specific legacy shortcut review', () => {
  it('reviews only the fixed objects and requests independent consent for each observed hash', async () => {
    const hashes = { desktop: 'a'.repeat(64), 'network-formal': 'b'.repeat(64), 'network-test': 'c'.repeat(64) }
    const manager = {
      inspectLegacy: vi.fn(async (id: LegacyShortcutId): Promise<ShortcutResult> => ({ subject: id, status: 'NEEDS_CONFIRMATION', sha256: hashes[id] })),
      migrateLegacy: vi.fn(async (id: LegacyShortcutId, _confirmation: { sha256: string; ownershipConfirmed: true }): Promise<ShortcutResult> => ({ subject: id, status: 'MIGRATED' })),
    }
    const confirm = vi.fn(async (item: ShortcutResult) => item.subject !== 'network-formal')
    expect((await reviewLegacyShortcuts(manager, confirm)).map(item => item.status)).toEqual(['MIGRATED', 'NEEDS_CONFIRMATION', 'MIGRATED'])
    expect(manager.inspectLegacy.mock.calls.map(([id]) => id)).toEqual([...LEGACY_SHORTCUTS])
    expect(confirm.mock.calls.map(([item]) => [item.subject, item.sha256])).toEqual(LEGACY_SHORTCUTS.map(id => [id, hashes[id]]))
    expect(manager.migrateLegacy.mock.calls).toEqual([
      ['desktop', { sha256: hashes.desktop, ownershipConfirmed: true }],
      ['network-test', { sha256: hashes['network-test'], ownershipConfirmed: true }],
    ])
  })
  it('does not migrate or alter real legacy links during a silent review', async () => {
    const f = await fixture(); await f.legacy()
    const original = await readFile(f.oldDesktop), migrate = vi.spyOn(f.lifecycle, 'migrateLegacy')
    expect(await reviewLegacyShortcuts(f.lifecycle)).toContainEqual({ subject: 'desktop', status: 'NEEDS_CONFIRMATION', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(migrate).not.toHaveBeenCalled()
    expect(await readFile(f.oldDesktop)).toEqual(original)
    expect(await allEvents(f)).toEqual([])
  })
  it.each(['rejected', 'confirmation-error', 'inspection-error'])('preserves the actual original and never migrates on %s', async mode => {
    const f = await fixture(); await f.legacy()
    const original = await readFile(f.oldDesktop), migrate = vi.spyOn(f.lifecycle, 'migrateLegacy')
    if (mode === 'inspection-error') vi.spyOn(f.lifecycle, 'inspectLegacy').mockRejectedValueOnce(new Error('read failed'))
    const confirm = vi.fn(async () => { if (mode === 'confirmation-error') throw new Error('dialog failed'); return false })
    const results = await reviewLegacyShortcuts(f.lifecycle, confirm)
    expect(results).toHaveLength(3)
    expect(results[0].status).toBe(mode === 'rejected' ? 'NEEDS_CONFIRMATION' : 'UNAVAILABLE')
    expect(migrate).not.toHaveBeenCalled()
    expect(await readFile(f.oldDesktop)).toEqual(original)
    expect(await allEvents(f)).toEqual([])
  })
  it('contains a migration exception without retrying that object or removing its source', async () => {
    const f = await fixture(); await f.legacy()
    const original = await readFile(f.oldDesktop), migrate = vi.spyOn(f.lifecycle, 'migrateLegacy')
    inject('rename', '.captured.lnk')
    const results = await reviewLegacyShortcuts(f.lifecycle, async () => true)
    expect(results[0]).toEqual({ subject: 'desktop', status: 'UNAVAILABLE', reason: 'LEGACY_REVIEW_FAILED' })
    expect(results.slice(1).map(item => item.status)).toEqual(['ABSENT', 'ABSENT'])
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(await readFile(f.oldDesktop)).toEqual(original)
    expect((await readdir(path.join(f.options.directory, 'files'))).length).toBe(1)
  })
  it('rechecks actual bytes after confirmation and refuses a stale inspected object', async () => {
    const f = await fixture(); await f.legacy()
    const changed = JSON.stringify(f.desktopSpec, null, 2)
    const results = await reviewLegacyShortcuts(f.lifecycle, async item => {
      expect(item.subject).toBe('desktop')
      await writeFile(f.oldDesktop, changed)
      return true
    })
    expect(results[0]).toEqual({ subject: 'desktop', status: 'PRESERVED', reason: 'CONFIRMATION_STALE' })
    expect(await readFile(f.oldDesktop, 'utf8')).toBe(changed)
    expect(await allEvents(f)).toEqual([])
  })
  it.each([undefined, 'not-a-hash', 'A'.repeat(64)])('does not request consent or migrate with invalid observed hash %s', async sha256 => {
    const manager = {
      inspectLegacy: vi.fn(async (id: LegacyShortcutId): Promise<ShortcutResult> => ({ subject: id, status: 'NEEDS_CONFIRMATION', sha256 })),
      migrateLegacy: vi.fn(async (id: LegacyShortcutId): Promise<ShortcutResult> => ({ subject: id, status: 'MIGRATED' })),
    }
    const confirm = vi.fn(async () => true)
    expect((await reviewLegacyShortcuts(manager, confirm)).every(item => item.status === 'UNAVAILABLE')).toBe(true)
    expect(confirm).not.toHaveBeenCalled(); expect(manager.migrateLegacy).not.toHaveBeenCalled()
  })
})
const directories: string[] = []
afterEach(async () => {
  fault.operation = ''; fault.target = ''; fault.after = false; fault.action = null; fault.throwError = true; fault.code = 'EIO'
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
const NETWORK_APP = 'com.elife.eshop.networkprint.addon', DESKTOP_APP = 'com.eshop.desktop.prototype'
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'network-shortcuts-')))
  directories.push(root)
  const desktopDirectory = path.join(root, 'Desktop'), startMenuDirectory = path.join(root, 'Programs'), userData = path.join(root, 'userData')
  const networkInstall = path.join(root, 'Network'), desktopInstall = path.join(root, 'DesktopProgram')
  for (const directory of [desktopDirectory, startMenuDirectory, userData, networkInstall, desktopInstall]) await mkdir(directory)
  const networkExecutable = path.join(networkInstall, 'E-Shop-Network-Print-Addon.exe'), desktopExecutable = path.join(desktopInstall, 'E-Shop 店小二.exe')
  const networkUninstaller = path.join(networkInstall, 'Uninstall E-Shop-Network-Print-Addon.exe')
  await writeFile(networkExecutable, 'verified network program'); await writeFile(desktopExecutable, 'verified original Desktop program'); await writeFile(networkUninstaller, 'verified uninstaller')
  const desktopRegistration: ShortcutRegistration = { source: 'windows-registry', hive: 'HKCU', registryKey: 'Software\\1acbd53d-b2f7-5af7-b432-3048068fa60f',
    appId: DESKTOP_APP, version: '0.4.7', installLocation: desktopInstall, executable: desktopExecutable, shortcutName: 'E-Shop', executableVerified: true }
  const networkRegistration: ShortcutRegistration = { source: 'windows-registry', hive: 'HKCU', registryKey: 'Software\\3b0d00d3-14c9-55d6-bef2-f6474bb2de71',
    appId: NETWORK_APP, version: '0.1.0-commercial-rc.4', installLocation: networkInstall, executable: networkExecutable,
    shortcutName: 'E-Shop Network Print Add-on (TEST ONLY)', executableVerified: true }
  const shell = {
    readShortcutLink: vi.fn(async (file: string) => JSON.parse(await readFile(file, 'utf8')) as ShortcutSpec),
    writeShortcutLink: vi.fn(async (file: string, spec: ShortcutSpec) => { await writeFile(file, JSON.stringify(spec)); return true }),
  }
  const options: ShortcutOptions = { directory: path.join(userData, 'shortcuts'), desktopDirectory, startMenuDirectory,
    networkExecutable, networkUninstaller, shell, readDesktopRegistration: async () => desktopRegistration,
    readNetworkRegistration: async () => networkRegistration, assertNormalDirectory: async () => {} }
  const lifecycle = new ShortcutLifecycle(options)
  const cashier = path.join(desktopDirectory, '店小二收银.lnk'), oldDesktop = path.join(desktopDirectory, 'E-Shop.lnk')
  const desktopSpec: ShortcutSpec = { target: desktopExecutable, args: '', icon: desktopExecutable, iconIndex: 0, appUserModelId: DESKTOP_APP }
  return { root, options, shell, lifecycle, desktopRegistration, networkRegistration, cashier, oldDesktop, desktopSpec,
    fresh: () => new ShortcutLifecycle(options), legacy: async (spec = desktopSpec) => writeFile(oldDesktop, JSON.stringify(spec)) }
}
async function allEvents(f: Awaited<ReturnType<typeof fixture>>) {
  const directory = path.join(f.options.directory, 'events')
  const names = (await readdir(directory)).sort()
  return Promise.all(names.map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'))))
}
function inject(operation: string, target: string, after = false, action?: () => Promise<void>, throwError = true) {
  Object.assign(fault, { operation, target, after, action: action ?? null, throwError })
}

describe('fixed product shortcut transactions on the actual filesystem', () => {
  it('creates only fixed entry specs through private staging; repeats are idempotent across processes', async () => {
    const f = await fixture()
    for (const role of ['cashier', 'manage', 'desktop-binding', 'uninstall'] as const) expect((await f.lifecycle.ensure(role)).status).toBe('CREATED')
    const firstEvents = await allEvents(f)
    expect(await readdir(f.options.desktopDirectory)).toEqual(['店小二收银.lnk'])
    expect((await readdir(f.options.startMenuDirectory)).sort()).toEqual(['Desktop 门店绑定.lnk', 'Network 打印设置.lnk', '卸载 Network Print.lnk'].sort())
    expect(JSON.parse(await readFile(f.cashier, 'utf8'))).toMatchObject({ target: f.options.networkExecutable, args: '--cashier', appUserModelId: NETWORK_APP })
    expect(JSON.parse(await readFile(path.join(f.options.startMenuDirectory, 'Desktop 门店绑定.lnk'), 'utf8'))).toMatchObject({ target: f.desktopRegistration.executable, args: '--admin' })
    for (const [file] of f.shell.writeShortcutLink.mock.calls) expect(file.startsWith(path.join(f.options.directory, 'files') + path.sep)).toBe(true)
    for (const role of ['cashier', 'manage', 'desktop-binding', 'uninstall'] as const) expect((await f.fresh().ensure(role)).status).toBe('UNCHANGED')
    expect(await allEvents(f)).toEqual(firstEvents)
    expect(f.shell.writeShortcutLink).toHaveBeenCalledTimes(4)
  })
  it('does not invent an uninstall target when no validated uninstaller is supplied', async () => {
    const f = await fixture(); delete f.options.networkUninstaller
    expect(await f.fresh().ensure('uninstall')).toEqual({ subject: 'uninstall', status: 'UNAVAILABLE' })
    expect(f.shell.writeShortcutLink).not.toHaveBeenCalled()
  })
  it.each(['../../outside', 'desktop', 'C:\\unknown.lnk', '--cashier'])('rejects arbitrary ensure role %s before writing', async role => {
    const f = await fixture()
    await expect(f.lifecycle.ensure(role as never)).rejects.toThrow('SHORTCUT_ROLE_INVALID')
    expect(f.shell.writeShortcutLink).not.toHaveBeenCalled()
  })
  it('preserves an occupied cashier name and unrelated user links byte-for-byte', async () => {
    const f = await fixture(), user = Buffer.from('my personal shortcut')
    await writeFile(f.cashier, user); await writeFile(path.join(f.options.desktopDirectory, 'User.lnk'), user)
    expect(await f.lifecycle.ensure('cashier')).toMatchObject({ status: 'PRESERVED', reason: 'DESTINATION_OCCUPIED' })
    expect(await readFile(f.cashier)).toEqual(user); expect(f.shell.writeShortcutLink).not.toHaveBeenCalled()
  })
  it('COPYFILE_EXCL closes the check/publish collision window without overwriting user bytes', async () => {
    const f = await fixture()
    inject('copy', '店小二收银.lnk', false, async () => { await writeFile(f.cashier, 'concurrent user file') }, false)
    expect(await f.lifecycle.ensure('cashier')).toMatchObject({ status: 'PRESERVED', reason: 'DESTINATION_OCCUPIED' })
    expect(await readFile(f.cashier, 'utf8')).toBe('concurrent user file')
    expect((await allEvents(f))[0].intent.kind).toBe('CREATE')
  })
  it('records and syncs intent before any public .lnk publication', async () => {
    const f = await fixture()
    inject('copy', '店小二收银.lnk', false, async () => {
      const history = await allEvents(f)
      expect(history).toHaveLength(1); expect(history[0].intent).toMatchObject({ kind: 'CREATE', path: f.cashier })
    }, false)
    expect((await f.lifecycle.ensure('cashier')).status).toBe('CREATED')
  })
  it('keeps unreceipted legacy links until object-specific ownership confirmation', async () => {
    const f = await fixture(); await f.legacy()
    const raw = await readFile(f.oldDesktop)
    expect(await f.lifecycle.inspectLegacy('desktop')).toMatchObject({ status: 'NEEDS_CONFIRMATION', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    await expect(f.lifecycle.migrateLegacy('desktop', { sha256: 'a'.repeat(64), ownershipConfirmed: false } as never)).rejects.toThrow('SHORTCUT_OWNERSHIP_CONFIRMATION_REQUIRED')
    await f.lifecycle.ensure('cashier'); await f.lifecycle.uninstall()
    expect(await readFile(f.oldDesktop)).toEqual(raw)
  })
  it('migrates a confirmed original into verified backups, restores on uninstall, and retains every record', async () => {
    const f = await fixture(); await f.legacy()
    const raw = await readFile(f.oldDesktop), candidate = await f.lifecycle.inspectLegacy('desktop')
    await f.lifecycle.ensure('cashier')
    expect(await f.lifecycle.migrateLegacy('desktop', { sha256: candidate.sha256!, ownershipConfirmed: true })).toMatchObject({ status: 'MIGRATED' })
    await expect(readFile(f.oldDesktop)).rejects.toMatchObject({ code: 'ENOENT' })
    const before = await allEvents(f)
    expect((await f.fresh().uninstall()).map(result => result.status)).toEqual(['REMOVED', 'RESTORED'])
    expect(await readFile(f.oldDesktop)).toEqual(raw)
    const after = await allEvents(f)
    expect(after.slice(0, before.length)).toEqual(before)
    const files = await readdir(path.join(f.options.directory, 'files'))
    expect(files.filter(file => file.endsWith('.captured.lnk'))).toHaveLength(2)
    expect(await f.fresh().uninstall()).toEqual([])
    expect((await f.fresh().ensure('cashier')).status).toBe('CREATED')
  })
  it.each([
    { args: '--admin' }, { args: '--normal' }, { args: '--custom' }, { appUserModelId: NETWORK_APP }, { iconIndex: 1 },
  ])('preserves legacy custom or unknown link %j even when confirmed', async change => {
    const f = await fixture(); await f.legacy({ ...f.desktopSpec, ...change })
    const original = await readFile(f.oldDesktop)
    expect((await f.lifecycle.inspectLegacy('desktop')).status).toBe('PRESERVED')
    expect((await f.lifecycle.migrateLegacy('desktop', { sha256: 'b'.repeat(64), ownershipConfirmed: true })).status).toBe('PRESERVED')
    expect(await readFile(f.oldDesktop)).toEqual(original)
  })
  it.each([
    { source: 'renderer' }, { appId: NETWORK_APP }, { version: '0.4.8' }, { registryKey: 'Software\\other' }, { executableVerified: false },
  ])('rejects untrusted registry evidence %j', async change => {
    const f = await fixture(); await f.legacy()
    Object.assign(f.desktopRegistration, change)
    await expect(f.lifecycle.inspectLegacy('desktop')).rejects.toThrow('SHORTCUT_REGISTRATION_INVALID')
    expect(await readFile(f.oldDesktop, 'utf8')).toBe(JSON.stringify(f.desktopSpec))
  })
  it('accepts an exact validated nondefault Desktop install path and preserves stale confirmation', async () => {
    const f = await fixture(); await f.legacy()
    f.desktopRegistration.hive = 'HKLM'
    const candidate = await f.lifecycle.inspectLegacy('desktop')
    await writeFile(f.oldDesktop, JSON.stringify(f.desktopSpec, null, 2))
    expect(await f.lifecycle.migrateLegacy('desktop', { sha256: candidate.sha256!, ownershipConfirmed: true })).toMatchObject({ status: 'PRESERVED', reason: 'CONFIRMATION_STALE' })
  })
  it('protects a changed owned link during uninstall', async () => {
    const f = await fixture(); await f.lifecycle.ensure('cashier')
    await writeFile(f.cashier, 'user changed this shortcut')
    expect(await f.fresh().uninstall()).toContainEqual({ subject: 'cashier', status: 'PRESERVED', reason: 'OWNED_LINK_CHANGED' })
    expect(await readFile(f.cashier, 'utf8')).toBe('user changed this shortcut')
  })
  it('does not recreate a user-deleted owned shortcut on ordinary repeated ensure', async () => {
    const f = await fixture(); await f.lifecycle.ensure('cashier'); await rename(f.cashier, path.join(f.root, 'user-kept.lnk'))
    expect(await f.fresh().ensure('cashier')).toMatchObject({ status: 'ABSENT', reason: 'USER_REMOVAL_PRESERVED' })
  })
  it('restores only into an absent path and leaves all backup bytes available', async () => {
    const f = await fixture(); await f.legacy()
    const candidate = await f.lifecycle.inspectLegacy('desktop')
    await f.lifecycle.migrateLegacy('desktop', { sha256: candidate.sha256!, ownershipConfirmed: true })
    await writeFile(f.oldDesktop, 'user replacement')
    expect(await f.fresh().uninstall()).toContainEqual({ subject: 'desktop', status: 'PRESERVED', reason: 'RESTORE_DESTINATION_OCCUPIED' })
    expect(await readFile(f.oldDesktop, 'utf8')).toBe('user replacement')
  })
  it('does not restore an old Network shortcut to a program being uninstalled', async () => {
    const f = await fixture(), legacy = path.join(f.options.desktopDirectory, 'E-Shop Network Print Add-on (TEST ONLY).lnk')
    f.networkRegistration.version = '0.1.0-commercial-rc.5'
    await writeFile(legacy, JSON.stringify({ target: f.options.networkExecutable, args: '', icon: f.options.networkExecutable, iconIndex: 0, appUserModelId: NETWORK_APP }))
    const candidate = await f.lifecycle.inspectLegacy('network-test')
    expect(candidate.status).toBe('NEEDS_CONFIRMATION')
    await f.lifecycle.migrateLegacy('network-test', { sha256: candidate.sha256!, ownershipConfirmed: true })
    await f.lifecycle.uninstall()
    await expect(readFile(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(path.join(f.options.directory, 'files'))).length).toBe(2)
  })
  it('recovers a failed pre-copy create as absent and permits a new exclusive create', async () => {
    const f = await fixture(); inject('copy', '店小二收银.lnk')
    await expect(f.lifecycle.ensure('cashier')).rejects.toThrow('injected')
    expect(await f.fresh().recover()).toContainEqual({ subject: 'cashier', status: 'ABSENT', reason: 'PUBLICATION_UNCONFIRMED' })
    expect((await f.fresh().ensure('cashier')).status).toBe('CREATED')
  })
  it('never adopts an ambiguous publication after copy succeeded but its file sync failed', async () => {
    const f = await fixture(); inject('sync', '店小二收银.lnk')
    await expect(f.lifecycle.ensure('cashier')).rejects.toThrow('injected')
    const original = await readFile(f.cashier)
    expect(await f.fresh().recover()).toContainEqual({ subject: 'cashier', status: 'PRESERVED', reason: 'PUBLICATION_UNCONFIRMED' })
    expect((await f.fresh().ensure('cashier')).status).toBe('PRESERVED')
    await f.lifecycle.uninstall(); expect(await readFile(f.cashier)).toEqual(original)
  })
  it('recovers rename completion after loss of its decision and then restores exact Desktop bytes', async () => {
    const f = await fixture(); await f.legacy()
    const original = await readFile(f.oldDesktop), candidate = await f.lifecycle.inspectLegacy('desktop')
    inject('rename', '.captured.lnk', true)
    await expect(f.lifecycle.migrateLegacy('desktop', { sha256: candidate.sha256!, ownershipConfirmed: true })).rejects.toThrow('injected')
    expect(await f.fresh().recover()).toContainEqual({ subject: 'desktop', status: 'MIGRATED' })
    expect(await f.fresh().uninstall()).toContainEqual({ subject: 'desktop', status: 'RESTORED' })
    expect(await readFile(f.oldDesktop)).toEqual(original)
  })
  it('retries a captured file flush before finalizing interrupted capture recovery', async () => {
    const f = await fixture(); await f.legacy()
    const candidate = await f.lifecycle.inspectLegacy('desktop')
    inject('rename', '.captured.lnk', true)
    await expect(f.lifecycle.migrateLegacy('desktop', { sha256: candidate.sha256!, ownershipConfirmed: true })).rejects.toThrow('injected')
    inject('sync', '.captured.lnk')
    await expect(f.fresh().recover()).rejects.toThrow('injected')
    expect(await allEvents(f)).toHaveLength(1)
    expect(await f.fresh().recover()).toContainEqual({ subject: 'desktop', status: 'MIGRATED' })
  })
  it.each(['migration', 'uninstall'])('fails closed on cross-volume %s capture and retains source and backup', async operation => {
    const f = await fixture()
    let source: string, action: () => Promise<unknown>
    if (operation === 'migration') {
      await f.legacy()
      const candidate = await f.lifecycle.inspectLegacy('desktop')
      source = f.oldDesktop
      action = () => f.lifecycle.migrateLegacy('desktop', { sha256: candidate.sha256!, ownershipConfirmed: true })
    } else {
      await f.lifecycle.ensure('cashier')
      source = f.cashier
      action = () => f.lifecycle.uninstall()
    }
    const original = await readFile(source)
    inject('rename', '.captured.lnk'); fault.code = 'EXDEV'
    await expect(action()).rejects.toMatchObject({ code: 'EXDEV' })
    expect(await readFile(source)).toEqual(original)
    const files = await readdir(path.join(f.options.directory, 'files'))
    expect(files.some(file => file.endsWith('.captured.lnk'))).toBe(false)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(await readFile(path.join(f.options.directory, 'files', file))).toEqual(original)
    expect(await f.fresh().recover()).toContainEqual({ subject: operation === 'migration' ? 'desktop' : 'cashier', status: 'PRESERVED', reason: 'CAPTURE_NOT_OBSERVED' })
    expect(await readFile(source)).toEqual(original)
  })
  it('preserves and returns a user mutation observed inside the capture rename window', async () => {
    const f = await fixture(); await f.legacy()
    const candidate = await f.lifecycle.inspectLegacy('desktop')
    const modified = JSON.stringify({ ...f.desktopSpec, args: '--admin' })
    inject('rename', '.captured.lnk', false, async () => { await writeFile(f.oldDesktop, modified) }, false)
    expect((await f.lifecycle.migrateLegacy('desktop', { sha256: candidate.sha256!, ownershipConfirmed: true })).status).toBe('PRESERVED')
    expect(await readFile(f.oldDesktop, 'utf8')).toBe(modified)
    expect((await readdir(path.join(f.options.directory, 'files'))).length).toBe(2)
  })
  it.each(['invalid-json', 'wrong-path', 'missing-event', 'wrong-hash'])('fails closed on historical manifest corruption %s', async corruption => {
    const f = await fixture(); await f.lifecycle.ensure('cashier')
    const event = path.join(f.options.directory, 'events', 'event-000001.json')
    const original = await readFile(f.cashier), data = JSON.parse(await readFile(event, 'utf8'))
    if (corruption === 'invalid-json') await writeFile(event, '{bad')
    else if (corruption === 'wrong-path') { data.intent.path = path.join(f.root, 'arbitrary.lnk'); await writeFile(event, JSON.stringify(data)) }
    else if (corruption === 'missing-event') await rename(event, path.join(f.root, 'retained-event.json'))
    else { data.intent.sha256 = 'a'.repeat(64); await writeFile(event, JSON.stringify(data)) }
    await expect(f.fresh().uninstall()).rejects.toThrow()
    expect(await readFile(f.cashier)).toEqual(original)
  })
  it('rejects corrupt original backup before any uninstall mutation', async () => {
    const f = await fixture(); await f.lifecycle.ensure('cashier')
    const events = await allEvents(f), original = await readFile(f.cashier)
    await writeFile(path.join(f.options.directory, 'files', `${events[0].intent.id}.lnk`), 'corrupted backup')
    await expect(f.fresh().uninstall()).rejects.toThrow('SHORTCUT_BACKUP_INVALID')
    expect(await readFile(f.cashier)).toEqual(original)
  })
  it('refuses a symlinked shortcut destination or history directory without following it', async () => {
    const f = await fixture(), external = path.join(f.root, 'unrelated')
    await writeFile(external, 'unrelated user bytes'); await symlink(external, f.cashier)
    await expect(f.lifecycle.ensure('cashier')).rejects.toThrow('SHORTCUT_UNSAFE_FILE')
    expect(await readFile(external, 'utf8')).toBe('unrelated user bytes')
  })
  it('calls the native checker once per leaf check, never recursively per ancestor, and never caches critical checks', async () => {
    const f = await fixture(), checked = vi.fn(async (_directory: string) => {})
    f.options.assertNormalDirectory = checked
    await f.fresh().ensure('cashier')
    const first = checked.mock.calls.map(([directory]) => directory)
    expect(first).toContain(f.options.desktopDirectory)
    expect(first).toContain(path.join(f.options.directory, 'files'))
    expect(first).not.toContain(f.root)
    expect(first).not.toContain(path.parse(f.root).root)
    checked.mockClear()
    await f.fresh().ensure('cashier')
    expect(checked.mock.calls.map(([directory]) => directory)).toContain(f.options.desktopDirectory)
  })
  it('fails closed if the native leaf-and-ancestor attribute check rejects a directory', async () => {
    const f = await fixture()
    f.options.assertNormalDirectory = async directory => {
      if (directory === f.options.desktopDirectory) throw new Error('SHORTCUT_UNSAFE_DIRECTORY')
    }
    await expect(f.fresh().ensure('cashier')).rejects.toThrow('SHORTCUT_UNSAFE_DIRECTORY')
    expect(await readdir(f.options.desktopDirectory)).toEqual([])
    expect(f.shell.writeShortcutLink).not.toHaveBeenCalled()
  })
  it('keeps Node ancestor checks even when a native checker is supplied', async () => {
    const f = await fixture(), alias = path.join(f.root, 'linked-parent')
    await symlink(f.root, alias)
    f.options.desktopDirectory = path.join(alias, 'Desktop')
    const checked = vi.fn(async (_directory: string) => {})
    f.options.assertNormalDirectory = checked
    await expect(f.fresh().ensure('cashier')).rejects.toThrow('SHORTCUT_UNSAFE_DIRECTORY')
    expect(checked.mock.calls.map(([directory]) => directory)).not.toContain(f.options.desktopDirectory)
    expect(await readdir(path.join(f.root, 'Desktop'))).toEqual([])
  })
  it('rejects non-symlink native file reparse attributes before reading or replacing a public link', async () => {
    const f = await fixture()
    await writeFile(f.cashier, 'cloud placeholder bytes')
    f.options.assertNormalFile = async file => {
      if (file === f.cashier) throw new Error('SHORTCUT_UNSAFE_FILE')
    }
    await expect(f.fresh().ensure('cashier')).rejects.toThrow('SHORTCUT_UNSAFE_FILE')
    expect(await readFile(f.cashier, 'utf8')).toBe('cloud placeholder bytes')
    expect(f.shell.writeShortcutLink).not.toHaveBeenCalled()
  })
  it('rechecks native file attributes after reading and does not cache checks between operations', async () => {
    const f = await fixture(); await f.lifecycle.ensure('cashier')
    let checks = 0
    f.options.assertNormalFile = async file => {
      if (file === f.cashier && ++checks === 2) throw new Error('SHORTCUT_UNSAFE_FILE')
    }
    await expect(f.fresh().uninstall()).rejects.toThrow('SHORTCUT_UNSAFE_FILE')
    expect(checks).toBe(2)
    const original = await readFile(f.cashier)
    checks = 0
    await expect(f.fresh().uninstall()).rejects.toThrow('SHORTCUT_UNSAFE_FILE')
    expect(checks).toBe(2)
    expect(await readFile(f.cashier)).toEqual(original)
  })
  it('serializes separate lifecycle instances using a real exclusive process lock', async () => {
    const f = await fixture()
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const original = f.shell.writeShortcutLink.getMockImplementation()!
    let entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    f.shell.writeShortcutLink.mockImplementationOnce(async (...args) => { entered(); await wait; return original(...args) })
    const first = f.lifecycle.ensure('cashier'); await ready
    await expect(f.fresh().ensure('manage')).rejects.toThrow('SHORTCUT_BUSY')
    release(); expect((await first).status).toBe('CREATED')
  })
})
