import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

export const SHORTCUT_ROLES = ['cashier', 'manage', 'desktop-binding', 'uninstall'] as const
export type ShortcutRole = typeof SHORTCUT_ROLES[number]
export const LEGACY_SHORTCUTS = ['desktop', 'network-formal', 'network-test'] as const
export type LegacyShortcutId = typeof LEGACY_SHORTCUTS[number]
export type ShortcutSpec = { target: string; args: string; icon: string; iconIndex: number; appUserModelId: string }
export type ShortcutShell = {
  readShortcutLink(file: string): ShortcutSpec | Promise<ShortcutSpec>
  // The adapter must call Electron's create operation, only at the supplied
  // private staging path. Electron itself may overwrite, so it never receives
  // the public Desktop/Start Menu destination.
  writeShortcutLink(file: string, spec: ShortcutSpec): boolean | Promise<boolean>
}
export type ShortcutRegistration = {
  source: 'windows-registry'; hive: 'HKCU' | 'HKLM'; registryKey: string
  appId: string; version: string; installLocation: string; executable: string
  shortcutName: string; executableVerified: true
}
export type DesktopRegistration = ShortcutRegistration
export type NetworkRegistration = ShortcutRegistration
export type ShortcutOptions = {
  /** Exactly USER_DATA/shortcuts, outside state and the removable install dir. */
  directory: string
  desktopDirectory: string
  /** Windows Programs/店小二/管理与维护, resolved by the main-process adapter. */
  startMenuDirectory: string
  networkExecutable: string
  /** Only a registry-validated executable supplied by the main process. */
  networkUninstaller?: string
  shell: ShortcutShell
  readDesktopRegistration(): Promise<ShortcutRegistration | null>
  readNetworkRegistration(): Promise<ShortcutRegistration | null>
  /** Windows adapter must reject ALL reparse points, not just symlinks. */
  assertNormalDirectory?: (directory: string) => Promise<void>
  /** Check a regular file plus every ancestor for ALL reparse attributes. */
  assertNormalFile?: (file: string) => Promise<void>
}
export type ShortcutResult = {
  subject: ShortcutRole | LegacyShortcutId
  status: 'CREATED' | 'UNCHANGED' | 'MIGRATED' | 'REMOVED' | 'RESTORED' | 'ABSENT' | 'PRESERVED' | 'UNAVAILABLE' | 'NEEDS_CONFIRMATION'
  reason?: string
  sha256?: string
}
type Kind = 'CREATE' | 'MIGRATE' | 'REMOVE' | 'RESTORE'
type Intent = {
  id: string; kind: Kind; subject: ShortcutRole | LegacyShortcutId; path: string
  spec: ShortcutSpec; sha256: string; bytes: number; originalId: string | null
  registration: ShortcutRegistration | null
}
type Decision = { id: string; outcome: 'APPLIED' | 'PRESERVED' | 'ABSENT'; reason: string }
type Event = { schemaVersion: 1; sequence: number; previous: string; binding: string; intent: Intent | null; decision: Decision | null }
type History = { events: Event[]; hashes: string[]; intents: Intent[]; decisions: Map<string, Decision> }
const MAX_LINK = 128 * 1024, MAX_EVENT = 16 * 1024, MAX_EVENTS = 2048
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const NETWORK_APP = 'com.elife.eshop.networkprint.addon', DESKTOP_APP = 'com.eshop.desktop.prototype'
const NETWORK_KEY = 'Software\\3b0d00d3-14c9-55d6-bef2-f6474bb2de71'
const DESKTOP_KEY = 'Software\\1acbd53d-b2f7-5af7-b432-3048068fa60f'
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const exists = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST'
function fail(code = 'SHORTCUT_HISTORY_INVALID'): never { throw new Error(code) }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || !keys.every(key => Object.hasOwn(value, key))) fail()
  return value as Record<string, unknown>
}
function absolute(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)
    || !path.isAbsolute(value) || path.normalize(value) !== value) fail('SHORTCUT_PATH_INVALID')
  return value
}
function equalPath(left: string, right: string) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
function parseSpec(value: unknown): ShortcutSpec {
  const data = object(value, ['target', 'args', 'icon', 'iconIndex', 'appUserModelId'])
  if (typeof data.args !== 'string' || data.args.length > 64 || typeof data.appUserModelId !== 'string'
    || ![NETWORK_APP, DESKTOP_APP].includes(data.appUserModelId) || data.iconIndex !== 0) fail()
  return { target: absolute(data.target), args: data.args, icon: absolute(data.icon), iconIndex: 0, appUserModelId: data.appUserModelId }
}
function sameSpec(actual: ShortcutSpec, expected: ShortcutSpec) {
  return equalPath(actual.target, expected.target) && actual.args === expected.args && equalPath(actual.icon, expected.icon)
    && actual.iconIndex === expected.iconIndex && actual.appUserModelId === expected.appUserModelId
}
function parseRegistration(value: unknown, desktop: boolean): ShortcutRegistration {
  const data = object(value, ['source', 'hive', 'registryKey', 'appId', 'version', 'installLocation', 'executable', 'shortcutName', 'executableVerified'])
  const location = absolute(data.installLocation), executable = absolute(data.executable)
  if (data.source !== 'windows-registry' || !['HKCU', 'HKLM'].includes(String(data.hive))
    || (!desktop && data.hive !== 'HKCU') || data.registryKey !== (desktop ? DESKTOP_KEY : NETWORK_KEY)
    || data.appId !== (desktop ? DESKTOP_APP : NETWORK_APP) || data.executableVerified !== true
    || (desktop ? data.version !== '0.4.7' : typeof data.version !== 'string' || !/^0\.1\.0(?:-commercial-rc\.[1-9]\d{0,2})?$/.test(data.version))
    || (desktop ? data.shortcutName !== 'E-Shop' : !['E-Shop Network Print Add-on', 'E-Shop Network Print Add-on (TEST ONLY)'].includes(String(data.shortcutName)))
    || !equalPath(executable, path.join(location, desktop ? 'E-Shop 店小二.exe' : 'E-Shop-Network-Print-Addon.exe'))) fail('SHORTCUT_REGISTRATION_INVALID')
  return data as ShortcutRegistration
}

/** Product-specific file transaction, not an arbitrary path or execution API.
 * Never reads Desktop credentials, printing state, journal or order data.
 * The main process supplies verified Known Folders and native registry reads;
 * renderer requests may contain only the enums and an observed hash below.
 * Every previous event and every original/captured .lnk is retained.
 */
export class ShortcutLifecycle {
  private readonly options: ShortcutOptions
  private readonly binding: string
  private readonly files: string
  private readonly events: string
  constructor(options: ShortcutOptions) {
    this.options = { ...options }
    for (const field of ['directory', 'desktopDirectory', 'startMenuDirectory', 'networkExecutable'] as const) absolute(options[field])
    if (options.networkUninstaller) absolute(options.networkUninstaller)
    if (path.basename(options.directory) !== 'shortcuts' || path.basename(options.networkExecutable) !== 'E-Shop-Network-Print-Addon.exe'
      || equalPath(options.directory, path.dirname(options.networkExecutable))
      || options.directory.startsWith(`${path.dirname(options.networkExecutable)}${path.sep}`)) fail('SHORTCUT_PATH_INVALID')
    if (process.platform === 'win32' && (!options.assertNormalDirectory || !options.assertNormalFile)) fail('SHORTCUT_NATIVE_PATH_CHECK_REQUIRED')
    this.files = path.join(options.directory, 'files'); this.events = path.join(options.directory, 'events')
    this.binding = digest(JSON.stringify([options.directory, options.desktopDirectory, options.startMenuDirectory, options.networkExecutable]))
  }
  private destination(subject: ShortcutRole | LegacyShortcutId) {
    if ((LEGACY_SHORTCUTS as readonly string[]).includes(subject)) return path.join(this.options.desktopDirectory,
      subject === 'desktop' ? 'E-Shop.lnk' : subject === 'network-formal' ? 'E-Shop Network Print Add-on.lnk' : 'E-Shop Network Print Add-on (TEST ONLY).lnk')
    if (!(SHORTCUT_ROLES as readonly string[]).includes(subject)) fail('SHORTCUT_ROLE_INVALID')
    if (subject === 'cashier') return path.join(this.options.desktopDirectory, '店小二收银.lnk')
    return path.join(this.options.startMenuDirectory,
      subject === 'manage' ? 'Network 打印设置.lnk' : subject === 'desktop-binding' ? 'Desktop 门店绑定.lnk' : '卸载 Network Print.lnk')
  }
  private async normalDirectory(directory: string) {
    // The native callback checks this leaf AND its ancestors in one bounded
    // request. Never spawn a Windows metadata process for every ancestor.
    let current = directory
    while (true) {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) fail('SHORTCUT_UNSAFE_DIRECTORY')
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    await this.options.assertNormalDirectory?.(directory)
  }
  private async regular(file: string, maximum = MAX_LINK): Promise<Buffer> {
    await this.normalDirectory(path.dirname(file))
    const before = await lstat(file)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size <= 0 || before.size > maximum) fail('SHORTCUT_UNSAFE_FILE')
    // Node's symlink flag does not cover OneDrive/cloud placeholders or every
    // Windows reparse type. Missing paths remain ENOENT before this callback.
    await this.options.assertNormalFile?.(file)
    const handle = await open(file, 'r')
    try {
      const current = await handle.stat()
      if (current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size) fail('SHORTCUT_CHANGED')
      const bytes = await handle.readFile(), after = await handle.stat()
      await this.options.assertNormalFile?.(file)
      const final = await lstat(file)
      if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || final.dev !== before.dev || final.ino !== before.ino || final.mtimeMs !== before.mtimeMs) fail('SHORTCUT_CHANGED')
      return bytes
    } finally { await handle.close() }
  }
  private async optional(file: string) { try { return await this.regular(file) } catch (error) { if (missing(error)) return null; throw error } }
  private async syncFile(file: string) {
    // Windows FlushFileBuffers requires a writable handle. 'r' is not an
    // acceptable fallback; any r+/sync failure leaves the intent unresolved.
    const handle = await open(file, 'r+')
    try { await handle.sync() } finally { await handle.close() }
  }
  private async syncDirectory(directory: string) {
    if (process.platform === 'win32') return // Node cannot directory-fsync Windows. No whole-machine power-loss claim.
    const handle = await open(directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
  private async newFile(file: string, bytes: Buffer | string) {
    const handle = await open(file, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  }
  private async initialize() {
    await this.normalDirectory(path.dirname(this.options.directory))
    for (const directory of [this.options.directory, this.files, this.events]) {
      try { await mkdir(directory, { mode: 0o700 }) } catch (error) { if (!exists(error)) throw error }
      await this.normalDirectory(directory)
    }
    await this.normalDirectory(this.options.desktopDirectory)
    await this.normalDirectory(this.options.startMenuDirectory)
  }
  private async locked<T>(body: () => Promise<T>): Promise<T> {
    await this.initialize()
    const file = path.join(this.options.directory, 'operation.lock'), raw = JSON.stringify({ pid: process.pid, nonce: randomUUID() })
    try { await this.newFile(file, raw) } catch (error) {
      if (!exists(error)) throw error
      // Never remove/reassign a lock merely because it is old. A terminated
      // process may leave one: preserve its exact bytes before reclaiming it.
      const previous = await this.regular(file, 1024), data = object(JSON.parse(previous.toString()), ['pid', 'nonce'])
      if (!Number.isInteger(data.pid) || Number(data.pid) <= 0 || typeof data.nonce !== 'string' || !UUID.test(data.nonce)) fail('SHORTCUT_LOCK_INVALID')
      try { process.kill(Number(data.pid), 0); fail('SHORTCUT_BUSY') } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe
      }
      if (!(await this.regular(file, 1024)).equals(previous)) fail('SHORTCUT_BUSY')
      const archived = path.join(this.options.directory, `terminated-lock-${randomUUID()}.json`)
      await rename(file, archived)
      if (!(await this.regular(archived, 1024)).equals(previous)) fail('SHORTCUT_BUSY')
      await this.newFile(file, raw)
    }
    try { return await body() } finally {
      if ((await this.regular(file, 1024)).toString() !== raw) fail('SHORTCUT_LOCK_INVALID')
      await unlink(file) // Only this live operation's transient lock; no history or .lnk is deleted.
    }
  }
  private parseIntent(value: unknown): Intent {
    const data = object(value, ['id', 'kind', 'subject', 'path', 'spec', 'sha256', 'bytes', 'originalId', 'registration'])
    if (typeof data.id !== 'string' || !UUID.test(data.id) || !['CREATE', 'MIGRATE', 'REMOVE', 'RESTORE'].includes(String(data.kind))
      || typeof data.sha256 !== 'string' || !HASH.test(data.sha256) || !Number.isInteger(data.bytes) || Number(data.bytes) < 1 || Number(data.bytes) > MAX_LINK
      || (data.originalId !== null && (typeof data.originalId !== 'string' || !UUID.test(data.originalId)))) fail()
    const legacy = data.kind === 'MIGRATE' || data.kind === 'RESTORE'
    if (!(legacy ? LEGACY_SHORTCUTS : SHORTCUT_ROLES).includes(data.subject as never)
      || data.path !== this.destination(data.subject as Intent['subject'])) fail()
    const spec = parseSpec(data.spec)
    const registration = data.registration === null ? null : parseRegistration(data.registration, data.subject === 'desktop' || data.subject === 'desktop-binding')
    if (legacy && (!registration || spec.args !== '' || spec.target !== registration.executable || spec.appUserModelId !== registration.appId)) fail()
    if (!legacy) {
      const args = data.subject === 'cashier' ? '--cashier' : data.subject === 'manage' ? '--manage' : data.subject === 'desktop-binding' ? '--admin' : ''
      const target = data.subject === 'desktop-binding' ? registration?.executable : data.subject === 'uninstall' ? this.options.networkUninstaller : this.options.networkExecutable
      if (spec.args !== args || (target && !equalPath(spec.target, target)) || (data.subject === 'desktop-binding' && !registration)
        || spec.appUserModelId !== (data.subject === 'desktop-binding' ? DESKTOP_APP : NETWORK_APP)) fail()
    }
    if (!equalPath(spec.icon, spec.target)) fail()
    if ((data.kind === 'MIGRATE' && data.registration === null)
      || (['REMOVE', 'RESTORE'].includes(String(data.kind)) && data.originalId === null)) fail()
    return { ...data, spec } as Intent
  }
  private async history(): Promise<History> {
    const names = (await readdir(this.events)).sort()
    if (names.length > MAX_EVENTS || names.some((name, index) => name !== `event-${String(index + 1).padStart(6, '0')}.json`)) fail()
    const history: History = { events: [], hashes: [], intents: [], decisions: new Map() }
    for (const [index, name] of names.entries()) {
      const raw = await this.regular(path.join(this.events, name), MAX_EVENT)
      const data = object(JSON.parse(raw.toString()), ['schemaVersion', 'sequence', 'previous', 'binding', 'intent', 'decision'])
      if (data.schemaVersion !== 1 || data.sequence !== index + 1 || data.previous !== (history.hashes.at(-1) ?? '0'.repeat(64))
        || data.binding !== this.binding || (data.intent === null) === (data.decision === null)) fail()
      if (data.intent !== null) {
        const intent = this.parseIntent(data.intent)
        if (history.intents.some(old => old.id === intent.id) || history.intents.some(old => !history.decisions.has(old.id))) fail()
        if (intent.originalId !== null && !history.intents.some(old => old.id === intent.originalId && history.decisions.get(old.id)?.outcome === 'APPLIED'
          && old.kind === (intent.kind === 'REMOVE' ? 'CREATE' : 'MIGRATE') && old.subject === intent.subject
          && old.path === intent.path && old.sha256 === intent.sha256 && sameSpec(old.spec, intent.spec))) fail()
        const saved = await this.regular(this.saved(intent))
        if (saved.length !== intent.bytes || digest(saved) !== intent.sha256) fail('SHORTCUT_BACKUP_INVALID')
        history.intents.push(intent)
      } else {
        const decision = object(data.decision, ['id', 'outcome', 'reason'])
        if (typeof decision.id !== 'string' || !history.intents.some(old => old.id === decision.id)
          || history.decisions.has(decision.id) || !['APPLIED', 'PRESERVED', 'ABSENT'].includes(String(decision.outcome))
          || typeof decision.reason !== 'string' || !/^[A-Z_]{1,80}$/.test(decision.reason)) fail()
        history.decisions.set(decision.id, decision as Decision)
      }
      history.events.push(data as Event); history.hashes.push(digest(raw))
      await this.syncFile(path.join(this.events, name))
    }
    await this.syncDirectory(this.events)
    return history
  }
  private async append(history: History, intent: Intent | null, decision: Decision | null) {
    if (history.events.length >= MAX_EVENTS) fail('SHORTCUT_HISTORY_LIMIT')
    const event: Event = { schemaVersion: 1, sequence: history.events.length + 1, previous: history.hashes.at(-1) ?? '0'.repeat(64), binding: this.binding, intent, decision }
    const raw = JSON.stringify(event), temporary = path.join(this.options.directory, `pending-${randomUUID()}.json`)
    const destination = path.join(this.events, `event-${String(event.sequence).padStart(6, '0')}.json`)
    if (Buffer.byteLength(raw) > MAX_EVENT) fail('SHORTCUT_HISTORY_LIMIT')
    await this.newFile(temporary, raw); await this.syncDirectory(this.options.directory)
    if (await this.optional(destination)) fail('SHORTCUT_HISTORY_INVALID')
    // The process lock serializes the append. Stage is durable before the
    // atomic rename; failed post-publication barriers are retried on recovery.
    await rename(temporary, destination); await this.syncFile(destination); await this.syncDirectory(this.events)
    history.events.push(event); history.hashes.push(digest(raw))
    if (intent) history.intents.push(intent)
    if (decision) history.decisions.set(decision.id, decision)
  }
  private saved(intent: Pick<Intent, 'id'>) { return path.join(this.files, `${intent.id}.lnk`) }
  private captured(intent: Pick<Intent, 'id'>) { return path.join(this.files, `${intent.id}.captured.lnk`) }
  private async readSpec(file: string): Promise<ShortcutSpec> {
    const actual = await this.options.shell.readShortcutLink(file)
    return parseSpec({ target: actual.target, args: actual.args, icon: actual.icon, iconIndex: actual.iconIndex, appUserModelId: actual.appUserModelId })
  }
  private async matches(file: string, intent: Pick<Intent, 'sha256' | 'bytes' | 'spec'>) {
    const raw = await this.optional(file)
    return !!raw && raw.length === intent.bytes && digest(raw) === intent.sha256 && sameSpec(await this.readSpec(file), intent.spec)
  }
  private async exclusiveCopy(source: string, destination: string) {
    await this.normalDirectory(path.dirname(destination))
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    await this.syncFile(destination); await this.syncDirectory(path.dirname(destination))
  }
  private async decide(history: History, intent: Intent, outcome: Decision['outcome'], reason: string) {
    await this.append(history, null, { id: intent.id, outcome, reason })
  }
  private async recoverHistory(history: History): Promise<ShortcutResult[]> {
    const results: ShortcutResult[] = []
    for (const intent of history.intents.filter(item => !history.decisions.has(item.id))) {
      if (intent.kind === 'CREATE') {
        // A copy completed without a durable completion receipt is ambiguous:
        // preserve it, never adopt a coincidentally identical user file as ours.
        const raw = await this.optional(intent.path)
        await this.decide(history, intent, raw ? 'PRESERVED' : 'ABSENT', raw ? 'PUBLICATION_UNCONFIRMED' : 'PUBLICATION_NOT_PRESENT')
        results.push({ subject: intent.subject, status: raw ? 'PRESERVED' : 'ABSENT', reason: 'PUBLICATION_UNCONFIRMED' })
      } else if (intent.kind === 'RESTORE') {
        const matches = await this.matches(intent.path, intent)
        if (matches) { await this.syncFile(intent.path); await this.syncDirectory(path.dirname(intent.path)) }
        await this.decide(history, intent, matches ? 'APPLIED' : 'PRESERVED', matches ? 'RESTORE_OBSERVED' : 'RESTORE_DESTINATION_PRESERVED')
        results.push({ subject: intent.subject, status: matches ? 'RESTORED' : 'PRESERVED' })
      } else {
        const captured = await this.optional(this.captured(intent))
        if (captured && digest(captured) === intent.sha256 && captured.length === intent.bytes) {
          // Retry barriers lost with the interrupted rename before recording
          // completion, including the Windows writable-handle file flush.
          await this.syncFile(this.captured(intent)); await this.syncDirectory(this.files)
          await this.syncDirectory(path.dirname(intent.path))
          await this.decide(history, intent, 'APPLIED', 'CAPTURE_OBSERVED')
          results.push({ subject: intent.subject, status: intent.kind === 'MIGRATE' ? 'MIGRATED' : 'REMOVED' })
        } else if (captured) {
          // If the public file changed in the rename window, put the captured
          // bytes back ONLY into a vacant path. Both versions stay archived.
          try { await this.exclusiveCopy(this.captured(intent), intent.path) } catch (error) { if (!exists(error)) throw error }
          await this.decide(history, intent, 'PRESERVED', 'CHANGED_DURING_CAPTURE')
          results.push({ subject: intent.subject, status: 'PRESERVED', reason: 'CHANGED_DURING_CAPTURE' })
        } else {
          if (!await this.optional(intent.path)) fail('SHORTCUT_CAPTURE_UNRESOLVED')
          await this.decide(history, intent, 'PRESERVED', 'CAPTURE_NOT_OBSERVED')
          results.push({ subject: intent.subject, status: 'PRESERVED', reason: 'CAPTURE_NOT_OBSERVED' })
        }
      }
    }
    return results
  }
  async recover(): Promise<ShortcutResult[]> { return this.locked(async () => this.recoverHistory(await this.history())) }
  private async registration(desktop: boolean) {
    const raw = await (desktop ? this.options.readDesktopRegistration() : this.options.readNetworkRegistration())
    if (raw === null) return null
    const registration = parseRegistration(raw, desktop)
    if (!desktop && !equalPath(registration.executable, this.options.networkExecutable)) fail('SHORTCUT_REGISTRATION_INVALID')
    await this.normalDirectory(path.dirname(registration.executable))
    const executable = await lstat(registration.executable)
    if (!executable.isFile() || executable.isSymbolicLink() || executable.nlink !== 1 || executable.size < 1) fail('SHORTCUT_REGISTRATION_INVALID')
    return registration
  }
  private async roleSpec(role: ShortcutRole): Promise<{ spec: ShortcutSpec; registration: ShortcutRegistration | null } | null> {
    this.destination(role)
    const registration = role === 'desktop-binding' ? await this.registration(true) : null
    const target = role === 'desktop-binding' ? registration?.executable : role === 'uninstall' ? this.options.networkUninstaller : this.options.networkExecutable
    if (!target) return null
    const args = role === 'cashier' ? '--cashier' : role === 'manage' ? '--manage' : role === 'desktop-binding' ? '--admin' : ''
    return { spec: { target, args, icon: target, iconIndex: 0, appUserModelId: role === 'desktop-binding' ? DESKTOP_APP : NETWORK_APP }, registration }
  }
  private owner(history: History, role: ShortcutRole) {
    return [...history.intents].reverse().find(intent => intent.kind === 'CREATE' && intent.subject === role
      && history.decisions.get(intent.id)?.outcome === 'APPLIED'
      && !history.intents.some(removal => removal.kind === 'REMOVE' && removal.originalId === intent.id && history.decisions.get(removal.id)?.outcome === 'APPLIED'))
  }
  async ensure(role: ShortcutRole): Promise<ShortcutResult> {
    if (!(SHORTCUT_ROLES as readonly string[]).includes(role)) fail('SHORTCUT_ROLE_INVALID')
    return this.locked(async () => {
      const history = await this.history(); await this.recoverHistory(history)
      const expected = await this.roleSpec(role)
      if (!expected) return { subject: role, status: 'UNAVAILABLE' }
      const destination = this.destination(role), existing = await this.optional(destination), owner = this.owner(history, role)
      if (existing) {
        if (owner && await this.matches(destination, owner) && sameSpec(owner.spec, expected.spec)) return { subject: role, status: 'UNCHANGED', sha256: owner.sha256 }
        return { subject: role, status: 'PRESERVED', reason: owner ? 'OWNED_LINK_CHANGED' : 'DESTINATION_OCCUPIED' }
      }
      if (owner) return { subject: role, status: 'ABSENT', reason: 'USER_REMOVAL_PRESERVED' }
      const id = randomUUID(), staged = this.saved({ id })
      if (await this.optional(staged)) fail('SHORTCUT_STAGE_OCCUPIED')
      if (!await this.options.shell.writeShortcutLink(staged, expected.spec)) fail('SHORTCUT_WRITE_FAILED')
      await this.syncFile(staged)
      const raw = await this.regular(staged)
      if (!sameSpec(await this.readSpec(staged), expected.spec)) fail('SHORTCUT_SPEC_MISMATCH')
      const intent: Intent = { id, kind: 'CREATE', subject: role, path: destination, spec: expected.spec,
        sha256: digest(raw), bytes: raw.length, originalId: null, registration: expected.registration }
      await this.syncDirectory(this.files); await this.append(history, intent, null)
      try { await this.exclusiveCopy(staged, destination) } catch (error) {
        if (!exists(error)) throw error
        await this.decide(history, intent, 'PRESERVED', 'DESTINATION_OCCUPIED')
        return { subject: role, status: 'PRESERVED', reason: 'DESTINATION_OCCUPIED' }
      }
      if (!await this.matches(destination, intent)) fail('SHORTCUT_CHANGED_AFTER_CREATE')
      await this.decide(history, intent, 'APPLIED', 'EXCLUSIVE_CREATE_VERIFIED')
      return { subject: role, status: 'CREATED', sha256: intent.sha256 }
    })
  }
  private async legacy(id: LegacyShortcutId): Promise<{ result: ShortcutResult; spec?: ShortcutSpec; registration?: ShortcutRegistration; raw?: Buffer }> {
    if (!(LEGACY_SHORTCUTS as readonly string[]).includes(id)) fail('SHORTCUT_ROLE_INVALID')
    const file = this.destination(id), raw = await this.optional(file)
    if (!raw) return { result: { subject: id, status: 'ABSENT' } }
    const registration = await this.registration(id === 'desktop')
    if (!registration || (id !== 'desktop' && registration.shortcutName !== path.basename(file, '.lnk'))) return { result: { subject: id, status: 'UNAVAILABLE', reason: 'NO_MATCHING_REGISTRATION' } }
    const spec: ShortcutSpec = { target: registration.executable, args: '', icon: registration.executable, iconIndex: 0, appUserModelId: registration.appId }
    let actual: ShortcutSpec
    try { actual = await this.readSpec(file) } catch { return { result: { subject: id, status: 'PRESERVED', reason: 'CUSTOM_OR_UNKNOWN_LINK' } } }
    if (!sameSpec(actual, spec)) return { result: { subject: id, status: 'PRESERVED', reason: 'CUSTOM_OR_UNKNOWN_LINK' } }
    if (!(await this.regular(file)).equals(raw)) fail('SHORTCUT_CHANGED')
    return { result: { subject: id, status: 'NEEDS_CONFIRMATION', sha256: digest(raw) }, spec, registration, raw }
  }
  async inspectLegacy(id: LegacyShortcutId): Promise<ShortcutResult> {
    return this.locked(async () => { const history = await this.history(); await this.recoverHistory(history); return (await this.legacy(id)).result })
  }
  private async capture(history: History, intent: Intent): Promise<boolean> {
    if (!await this.matches(intent.path, intent)) {
      await this.decide(history, intent, 'PRESERVED', 'SOURCE_CHANGED'); return false
    }
    if (await this.optional(this.captured(intent))) fail('SHORTCUT_CAPTURE_OCCUPIED')
    await rename(intent.path, this.captured(intent)) // Recoverable, never permanent deletion.
    await this.syncDirectory(path.dirname(intent.path)); await this.syncFile(this.captured(intent)); await this.syncDirectory(this.files)
    if (!await this.matches(this.captured(intent), intent)) {
      await this.recoverHistory(history); return false
    }
    await this.decide(history, intent, 'APPLIED', 'EXACT_LINK_CAPTURED'); return true
  }
  async migrateLegacy(id: LegacyShortcutId, confirmation: { sha256: string; ownershipConfirmed: true }): Promise<ShortcutResult> {
    if (!(LEGACY_SHORTCUTS as readonly string[]).includes(id)) fail('SHORTCUT_ROLE_INVALID')
    const data = object(confirmation, ['sha256', 'ownershipConfirmed'])
    if (data.ownershipConfirmed !== true || typeof data.sha256 !== 'string' || !HASH.test(data.sha256)) fail('SHORTCUT_OWNERSHIP_CONFIRMATION_REQUIRED')
    const confirmedHash = data.sha256
    return this.locked(async () => {
      const history = await this.history(); await this.recoverHistory(history)
      const candidate = await this.legacy(id)
      if (candidate.result.status !== 'NEEDS_CONFIRMATION') return candidate.result
      if (candidate.result.sha256 !== confirmedHash) return { subject: id, status: 'PRESERVED', reason: 'CONFIRMATION_STALE' }
      const intent: Intent = { id: randomUUID(), kind: 'MIGRATE', subject: id, path: this.destination(id), spec: candidate.spec!,
        sha256: confirmedHash, bytes: candidate.raw!.length, originalId: null, registration: candidate.registration! }
      await this.newFile(this.saved(intent), candidate.raw!); await this.syncDirectory(this.files)
      if (!await this.matches(this.saved(intent), intent)) fail('SHORTCUT_BACKUP_INVALID')
      await this.append(history, intent, null)
      return { subject: id, status: await this.capture(history, intent) ? 'MIGRATED' : 'PRESERVED' }
    })
  }
  async uninstall(): Promise<ShortcutResult[]> {
    return this.locked(async () => {
      const history = await this.history(), results = await this.recoverHistory(history)
      for (const role of SHORTCUT_ROLES) {
        const owner = this.owner(history, role)
        if (!owner) continue
        const raw = await this.optional(owner.path)
        if (!raw) { results.push({ subject: role, status: 'ABSENT' }); continue }
        if (!await this.matches(owner.path, owner)) { results.push({ subject: role, status: 'PRESERVED', reason: 'OWNED_LINK_CHANGED' }); continue }
        const intent: Intent = { ...owner, id: randomUUID(), kind: 'REMOVE', originalId: owner.id }
        await this.newFile(this.saved(intent), raw); await this.syncDirectory(this.files)
        await this.append(history, intent, null)
        results.push({ subject: role, status: await this.capture(history, intent) ? 'REMOVED' : 'PRESERVED' })
      }
      for (const migrated of history.intents.filter(intent => intent.kind === 'MIGRATE' && history.decisions.get(intent.id)?.outcome === 'APPLIED')) {
        // Network is being removed. Retain its old links in the archive, but
        // do not restore public shortcuts pointing at the departing program.
        if (migrated.subject !== 'desktop') continue
        if (history.intents.some(intent => intent.kind === 'RESTORE' && intent.originalId === migrated.id && history.decisions.get(intent.id)?.outcome === 'APPLIED')) continue
        if (await this.optional(migrated.path)) { results.push({ subject: migrated.subject, status: 'PRESERVED', reason: 'RESTORE_DESTINATION_OCCUPIED' }); continue }
        const registration = await this.registration(migrated.subject === 'desktop')
        if (!registration || !equalPath(registration.executable, migrated.spec.target)) { results.push({ subject: migrated.subject, status: 'UNAVAILABLE', reason: 'ORIGINAL_PRODUCT_UNAVAILABLE' }); continue }
        const intent: Intent = { ...migrated, id: randomUUID(), kind: 'RESTORE', originalId: migrated.id }
        await this.newFile(this.saved(intent), await this.regular(this.saved(migrated))); await this.syncDirectory(this.files)
        await this.append(history, intent, null)
        try { await this.exclusiveCopy(this.saved(intent), intent.path) } catch (error) {
          if (!exists(error)) throw error
          await this.decide(history, intent, 'PRESERVED', 'RESTORE_DESTINATION_OCCUPIED')
          results.push({ subject: intent.subject, status: 'PRESERVED', reason: 'RESTORE_DESTINATION_OCCUPIED' }); continue
        }
        if (!await this.matches(intent.path, intent)) fail('SHORTCUT_RESTORE_CHANGED')
        await this.decide(history, intent, 'APPLIED', 'EXCLUSIVE_RESTORE_VERIFIED')
        results.push({ subject: intent.subject, status: 'RESTORED' })
      }
      return results
    })
  }
}

/** Review only the three known legacy objects. Silence is not confirmation. */
export async function reviewLegacyShortcuts(
  manager: Pick<ShortcutLifecycle, 'inspectLegacy' | 'migrateLegacy'>,
  confirm?: (item: ShortcutResult) => Promise<boolean>,
): Promise<ShortcutResult[]> {
  const results: ShortcutResult[] = []
  for (const id of LEGACY_SHORTCUTS) {
    try {
      const item = await manager.inspectLegacy(id)
      if (item.subject !== id) fail('SHORTCUT_REVIEW_CANDIDATE_INVALID')
      const hash = item.sha256
      if (item.status === 'NEEDS_CONFIRMATION') {
        if (typeof hash !== 'string' || !HASH.test(hash)) fail('SHORTCUT_REVIEW_CANDIDATE_INVALID')
        // Capture the observed hash before the independent UI decision. The
        // lifecycle rechecks the current bytes when this decision is applied.
        if (confirm && await confirm({ ...item }) === true) {
          results.push(await manager.migrateLegacy(id, { sha256: hash, ownershipConfirmed: true }))
          continue
        }
      }
      results.push(item)
    } catch {
      // No retry or inferred consent for a failed item; other fixed objects
      // remain independently reviewable. Never expose filesystem error data.
      results.push({ subject: id, status: 'UNAVAILABLE', reason: 'LEGACY_REVIEW_FAILED' })
    }
  }
  return results
}
