import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { ExecutionJournal, type ClaimTokenProtector } from '../src/executionJournal'
import { exactObject, parseNetworkMode, type NetworkMode } from '../src/networkContract'
import { NetworkNodeConfig, validateNetworkLiteral, type NetworkNode, type NetworkPrinterConfig } from '../src/networkNodeConfig'
import type { DesktopBindingIdentity } from '../src/desktopBindingIdentity'

export type ProfileIdentity = Pick<DesktopBindingIdentity, 'installationId' | 'computerId' | 'storeCode' | 'boundAt'>
export type LocalTest = { id: string; mode: NetworkMode; endpoint: NetworkNode; networkFingerprint: string;
  hardwareAddress: string;
  outcome: 'INTENT' | 'SUBMITTED' | 'NOT_CROSSED' | 'UNKNOWN' | 'CONFIRMED'; bytes: number; sha256: string }
type ProfileState = { schemaVersion: 1; identity: ProfileIdentity; revision: number; mode: NetworkMode | null;
  enabled: boolean; test: LocalTest | null }

export function bindingTuple(binding: DesktopBindingIdentity): ProfileIdentity {
  return { installationId: binding.installationId, computerId: binding.computerId,
    storeCode: binding.storeCode, boundAt: binding.boundAt }
}
export function sameBinding(left: ProfileIdentity, right: ProfileIdentity): boolean {
  return Object.entries(left).every(([key, value]) => right[key as keyof ProfileIdentity] === value)
}

/** Setup state, not a second business mailbox. Business claims/results remain
 * exclusively in ExecutionJournal. A local TEST is an explicit user action;
 * its durable intent can never be replayed on startup. */
export class NetworkAddonProfile {
  readonly journal: ExecutionJournal
  private state!: ProfileState
  private busy = false
  private faulted = false
  private readonly file: string

  constructor(private readonly options: { directory: string; identity: ProfileIdentity; protector: ClaimTokenProtector;
    interfaces?: ConstructorParameters<typeof NetworkNodeConfig>[0]['interfaces'] }) {
    this.file = path.join(options.directory, 'profile.sealed')
    this.journal = new ExecutionJournal(path.join(options.directory, 'execution-journal.json'), options.protector)
  }

  private nodes(revision = this.state.revision) {
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > 10000) throw new Error('ADDON_INVALID_REVISION')
    return new NetworkNodeConfig({ ...this.options, file: path.join(this.options.directory, `nodes-${revision}.sealed`) })
  }

  private parse(raw: string): ProfileState {
    const state = exactObject(JSON.parse(this.options.protector.unprotect(raw)),
      ['schemaVersion', 'identity', 'revision', 'mode', 'enabled', 'test'])
    const identity = exactObject(state.identity, ['installationId', 'computerId', 'storeCode', 'boundAt'])
    if (state.schemaVersion !== 1 || !sameBinding(this.options.identity, identity as ProfileIdentity)
      || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0 || Number(state.revision) > 10000
      || typeof state.enabled !== 'boolean') throw new Error('ADDON_PROFILE_INVALID_OR_BINDING_CHANGED')
    const mode = state.mode === null ? null : parseNetworkMode(state.mode)
    if ((state.revision === 0) !== (mode === null) || (state.enabled && !mode)) throw new Error('ADDON_PROFILE_INVALID')
    let test: LocalTest | null = null
    if (state.test !== null) {
      const value = exactObject(state.test, ['id', 'mode', 'endpoint', 'networkFingerprint', 'hardwareAddress', 'outcome', 'bytes', 'sha256'])
      if (typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id)
        || typeof value.networkFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.networkFingerprint)
        || typeof value.hardwareAddress !== 'string' || !/^[0-9a-f]{2}(-[0-9a-f]{2}){5}$/.test(value.hardwareAddress)
        || value.hardwareAddress === '00-00-00-00-00-00' || (parseInt(value.hardwareAddress.slice(0, 2), 16) & 1) !== 0
        || !['INTENT', 'SUBMITTED', 'NOT_CROSSED', 'UNKNOWN', 'CONFIRMED'].includes(String(value.outcome))
        || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > 3 * 1024 * 1024
        || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error('ADDON_TEST_RECORD_INVALID')
      test = { id: value.id, mode: parseNetworkMode(value.mode), endpoint: validateNetworkLiteral(value.endpoint),
        hardwareAddress: value.hardwareAddress,
        networkFingerprint: value.networkFingerprint, outcome: value.outcome as LocalTest['outcome'],
        bytes: Number(value.bytes), sha256: value.sha256 }
      if (mode && mode !== test.mode) throw new Error('ADDON_MODE_LOCKED')
      if (state.enabled && test.outcome !== 'CONFIRMED') throw new Error('ADDON_UNCONFIRMED_TEST')
    }
    if (state.enabled && !test) throw new Error('ADDON_UNCONFIRMED_TEST')
    return { schemaVersion: 1, identity: this.options.identity, revision: Number(state.revision), mode,
      enabled: state.enabled, test }
  }

  private async readState() {
    const info = await lstat(this.file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) throw new Error('ADDON_PROFILE_INVALID')
    return this.parse(await readFile(this.file, 'utf8'))
  }

  /** Caller owns the process single-instance lock and protected directory ACL. */
  async open(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    if ((await lstat(this.options.directory)).isSymbolicLink()) throw new Error('ADDON_STATE_LINK_REJECTED')
    let found = true
    try { this.state = await this.readState() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; found = false }
    if (found) {
      // A historical missing/corrupt journal is never an empty first install.
      await this.journal.ensureInitialized()
      if (this.state.revision) await this.readForRecovery()
      return
    }
    // Interrupted initialization leaves evidence. Do not manufacture an empty
    // history if any state/temp/journal/node file already exists.
    if ((await readdir(this.options.directory)).length) throw new Error('ADDON_INITIALIZATION_INCOMPLETE_OR_PROFILE_LOST')
    await this.journal.ensureInitialized({ allowCreate: true })
    await this.persist({ schemaVersion: 1, identity: this.options.identity, revision: 0, mode: null, enabled: false, test: null })
  }

  snapshot(): Readonly<ProfileState> {
    if (!this.state || this.faulted) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
    return structuredClone(this.state)
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy || this.faulted) throw new Error('ADDON_PROFILE_BUSY_OR_FAULTED')
    this.busy = true
    try { return await action() } finally { this.busy = false }
  }

  private async persist(next: ProfileState) {
    const sealed = this.options.protector.protect(JSON.stringify(next))
    // Validate exactly the bytes that will become authoritative.
    this.parse(sealed)
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(sealed, 'utf8'); await handle.sync() } finally { await handle.close() }
      await rename(temporary, this.file)
      const final = await open(this.file, 'r+')
      try { await final.sync() } finally { await final.close() }
      if (process.platform !== 'win32') {
        const directory = await open(this.options.directory, 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
      this.state = next
    } catch (error) { this.faulted = true; throw error }
  }

  async readForRecovery(): Promise<NetworkPrinterConfig> {
    const state = await this.readState()
    const config = await this.nodes(state.revision).readForRecovery()
    if (config.mode !== state.mode) throw new Error('ADDON_MODE_LOCKED')
    return config
  }

  /** Actual runtime config: unlike recovery display, this requires direct LAN. */
  async read(): Promise<NetworkPrinterConfig> {
    const state = await this.readState()
    if (!state.enabled || state.test?.outcome !== 'CONFIRMED') throw new Error('ADDON_PAUSED_OR_UNCONFIGURED')
    const config = await this.nodes(state.revision).read()
    if (config.mode !== state.mode) throw new Error('ADDON_MODE_LOCKED')
    return config
  }

  async setEnabled(enabled: boolean) {
    return this.exclusive(async () => {
      if (enabled) {
        if (!this.state.revision || this.state.test?.outcome !== 'CONFIRMED') throw new Error('ADDON_TEST_CONFIRMATION_REQUIRED')
        await this.journal.ensureInitialized()
        if (this.journal.records().some(record => record.effectBoundary === 'CROSSING_UNKNOWN')) throw new Error('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
        await this.nodes().read()
      }
      await this.persist({ ...this.state, enabled })
    })
  }

  async beginTest(input: Omit<LocalTest, 'outcome'>): Promise<LocalTest> {
    return this.exclusive(async () => {
      if (this.state.enabled) throw new Error('ADDON_PAUSE_REQUIRED')
      if (this.state.test && ['INTENT', 'UNKNOWN', 'SUBMITTED'].includes(this.state.test.outcome)) throw new Error('ADDON_TEST_REVIEW_REQUIRED')
      if (this.state.mode && this.state.mode !== input.mode) throw new Error('ADDON_MODE_LOCKED')
      await this.journal.ensureInitialized()
      if (this.journal.records().some(record => record.effectBoundary === 'CROSSING_UNKNOWN')) throw new Error('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
      if (this.state.revision) await this.readForRecovery()
      const test: LocalTest = { ...input, outcome: 'INTENT' }
      await this.persist({ ...this.state, test })
      return structuredClone(test)
    })
  }

  async finishTest(id: string, outcome: 'SUBMITTED' | 'NOT_CROSSED' | 'UNKNOWN') {
    return this.exclusive(async () => {
      if (this.state.test?.id !== id || this.state.test.outcome !== 'INTENT') throw new Error('ADDON_TEST_STATE_CONFLICT')
      await this.persist({ ...this.state, test: { ...this.state.test, outcome } })
    })
  }

  async confirmTest(id: string, physicalPaperConfirmed: boolean, sameOriginalPrinter: boolean) {
    return this.exclusive(async () => {
      const test = this.state.test
      if (this.state.enabled || !test || test.id !== id || test.outcome !== 'SUBMITTED' || physicalPaperConfirmed !== true) throw new Error('ADDON_TEST_CONFIRMATION_REQUIRED')
      if (this.state.revision && sameOriginalPrinter !== true) throw new Error('ADDON_SAME_PHYSICAL_PRINTER_REQUIRED')
      if (this.state.revision) await this.readForRecovery()
      const revision = this.state.revision + 1
      await this.nodes(revision).save({ mode: test.mode, endpoint: test.endpoint })
      await this.persist({ ...this.state, mode: test.mode, revision, test: { ...test, outcome: 'CONFIRMED' } })
    })
  }
}
