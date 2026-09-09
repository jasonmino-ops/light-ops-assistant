import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { ExecutionJournal, type ClaimTokenProtector, type JournalRecord } from '../src/executionJournal'
import { exactObject, parseNetworkMode, type NetworkMode } from '../src/networkContract'
import { NetworkNodeConfig, validateNetworkLiteral, type NetworkNode, type NetworkPrinterConfig } from '../src/networkNodeConfig'
import type { DesktopBindingIdentity } from '../src/desktopBindingIdentity'
import { ColdModeTransaction, sealedHash } from './coldModeTransaction'

export type ProfileIdentity = Pick<DesktopBindingIdentity, 'installationId' | 'computerId' | 'storeCode' | 'boundAt'>
export type LocalTest = { id: string; mode: NetworkMode; endpoint: NetworkNode; networkFingerprint: string;
  hardwareAddress: string;
  outcome: 'INTENT' | 'SUBMITTED' | 'NOT_CROSSED' | 'UNKNOWN' | 'CONFIRMED'; bytes: number; sha256: string }
type Conversion = { schemaVersion: 1; id: string; fromMode: NetworkMode; toMode: NetworkMode;
  fromRevision: number; toRevision: number; originalProfileSha256: string; originalNodeSha256: string;
  originalJournalSha256: string; originalTestSha256: string; previousConversionId: string | null }
type ProfileState = { schemaVersion: 1 | 2; identity: ProfileIdentity; revision: number; mode: NetworkMode | null;
  enabled: boolean; test: LocalTest | null; conversion?: Conversion; coldEnableCheckRequired?: boolean }
export type ColdModePreflightContext = { identity: ProfileIdentity; config: NetworkPrinterConfig; test: LocalTest }

export function isColdJournalSettled(record: JournalRecord): boolean {
  if (!record.reported) return false
  if (record.state === 'ABANDONED') return record.effectBoundary === 'NOT_CROSSED'
    && (record.result === undefined || record.result?.effectBoundary === 'NOT_CROSSED')
  return record.state === 'TERMINAL' && !!record.result
    && ['NOT_CROSSED', 'CROSSED'].includes(record.effectBoundary)
    && record.result.effectBoundary === record.effectBoundary
    && ['SUCCEEDED', 'FAILED'].includes(record.result.state) && record.result.physicalCompletionKnown === false
}

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
  private needsRestart = false
  private recoveredPaused = false
  private transactionProtected = false
  private readonly file: string
  private readonly transactions: ColdModeTransaction

  constructor(private readonly options: { directory: string; identity: ProfileIdentity; protector: ClaimTokenProtector;
    interfaces?: ConstructorParameters<typeof NetworkNodeConfig>[0]['interfaces'] }) {
    this.file = path.join(options.directory, 'profile.sealed')
    this.transactions = new ColdModeTransaction(options.directory, options.protector)
    this.journal = new ExecutionJournal(path.join(options.directory, 'execution-journal.json'), options.protector)
  }

  private nodes(revision = this.state.revision) {
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > 10000) throw new Error('ADDON_INVALID_REVISION')
    return new NetworkNodeConfig({ ...this.options, file: path.join(this.options.directory, `nodes-${revision}.sealed`) })
  }

  private parse(raw: string): ProfileState {
    const decoded = JSON.parse(this.options.protector.unprotect(raw))
    const state = exactObject(decoded, decoded?.schemaVersion === 2
      ? ['schemaVersion', 'identity', 'revision', 'mode', 'enabled', 'test', 'conversion', 'coldEnableCheckRequired']
      : ['schemaVersion', 'identity', 'revision', 'mode', 'enabled', 'test'])
    const identity = exactObject(state.identity, ['installationId', 'computerId', 'storeCode', 'boundAt'])
    if ((state.schemaVersion !== 1 && state.schemaVersion !== 2) || !sameBinding(this.options.identity, identity as ProfileIdentity)
      || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0 || Number(state.revision) > 10000
      || typeof state.enabled !== 'boolean') throw new Error('ADDON_PROFILE_INVALID_OR_BINDING_CHANGED')
    const mode = state.mode === null ? null : parseNetworkMode(state.mode)
    if ((state.revision === 0) !== (mode === null) || (state.enabled && !mode)) throw new Error('ADDON_PROFILE_INVALID')
    let conversion: Conversion | undefined
    if (state.schemaVersion === 2) {
      const value = exactObject(state.conversion, ['schemaVersion', 'id', 'fromMode', 'toMode', 'fromRevision', 'toRevision',
        'originalProfileSha256', 'originalNodeSha256', 'originalJournalSha256', 'originalTestSha256', 'previousConversionId'])
      if (value.schemaVersion !== 1 || typeof value.id !== 'string' || !/^cold-transaction-\d{5}-[0-9a-f-]{36}$/.test(value.id)
        || !Number.isSafeInteger(value.fromRevision) || Number(value.fromRevision) < 1
        || value.toRevision !== Number(value.fromRevision) + 1 || Number(value.toRevision) > Number(state.revision)
        || ![value.originalProfileSha256, value.originalNodeSha256, value.originalJournalSha256, value.originalTestSha256]
          .every(hash => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))
        || (value.previousConversionId !== null && (typeof value.previousConversionId !== 'string'
          || !/^cold-transaction-\d{5}-[0-9a-f-]{36}$/.test(value.previousConversionId)))
        || typeof state.coldEnableCheckRequired !== 'boolean' || (state.enabled && state.coldEnableCheckRequired)) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
      conversion = { ...value, fromMode: parseNetworkMode(value.fromMode), toMode: parseNetworkMode(value.toMode) } as Conversion
      if (conversion.fromMode === conversion.toMode || conversion.toMode !== mode) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
    }
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
      if (mode && mode !== test.mode && !conversion) throw new Error('ADDON_MODE_LOCKED')
      if (state.enabled && test.outcome !== 'CONFIRMED') throw new Error('ADDON_UNCONFIRMED_TEST')
    }
    if (state.enabled && !test) throw new Error('ADDON_UNCONFIRMED_TEST')
    return { schemaVersion: state.schemaVersion as 1 | 2, identity: this.options.identity, revision: Number(state.revision), mode,
      enabled: state.enabled, test, ...(conversion ? { conversion, coldEnableCheckRequired: state.coldEnableCheckRequired as boolean } : {}) }
  }

  private async validateProvenance(state: ProfileState, seen = new Set<string>()): Promise<void> {
    const conversion = state.conversion
    if (!conversion) return
    if (seen.size >= 10000 || seen.has(conversion.id)) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
    seen.add(conversion.id)
    const raw = await this.transactions.original(conversion.id, 'profile.sealed')
    if (sealedHash(raw) !== conversion.originalProfileSha256) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
    const original = this.parse(raw)
    const nodeRaw = await this.transactions.original(conversion.id, `nodes-${conversion.fromRevision}.sealed`)
    const journalRaw = await this.transactions.original(conversion.id, 'execution-journal.json')
    if (original.enabled || original.mode !== conversion.fromMode || original.revision !== conversion.fromRevision
      || original.test?.outcome !== 'CONFIRMED' || sealedHash(JSON.stringify(original.test)) !== conversion.originalTestSha256
      || sealedHash(nodeRaw) !== conversion.originalNodeSha256 || sealedHash(journalRaw) !== conversion.originalJournalSha256
      || (original.conversion?.id ?? null) !== conversion.previousConversionId
      || (state.test?.mode !== state.mode && !isDeepStrictEqual(state.test, original.test))) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
    if (sealedHash(await this.transactions.readRegular(path.join(this.options.directory, `nodes-${conversion.fromRevision}.sealed`), 32768))
      !== conversion.originalNodeSha256) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
    const from = await this.nodes(conversion.fromRevision).readForRecovery()
    const to = await this.nodes(conversion.toRevision).readForRecovery()
    if (from.mode !== conversion.fromMode || to.mode !== conversion.toMode
      || JSON.stringify(from.endpoint) !== JSON.stringify(to.endpoint)) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
    await this.validateProvenance(original, seen)
  }

  private async readState() {
    const info = await lstat(this.file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) throw new Error('ADDON_PROFILE_INVALID')
    return this.parse(await readFile(this.file, 'utf8'))
  }

  /** Caller owns the process single-instance lock and protected directory ACL. */
  async open(): Promise<void> {
    if (this.faulted || this.needsRestart) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
    try {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    if ((await lstat(this.options.directory)).isSymbolicLink()) throw new Error('ADDON_STATE_LINK_REJECTED')
    this.recoveredPaused = await this.transactions.recover()
    this.transactionProtected = (await this.transactions.names()).length > 0
    let found = true
    try { this.state = await this.readState() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; found = false }
    if (found) {
      // A historical missing/corrupt journal is never an empty first install.
      await this.journal.ensureInitialized()
      if (this.state.revision) {
        await this.readForRecovery()
        if (this.state.schemaVersion === 2) {
          await this.transactions.syncFile(path.join(this.options.directory, `nodes-${this.state.revision}.sealed`))
          await this.transactions.syncDirectory(this.options.directory)
        }
      }
      if (this.recoveredPaused && this.state.enabled) {
        await this.persist({ ...this.state, enabled: false,
          ...(this.state.schemaVersion === 2 ? { coldEnableCheckRequired: true } : {}) })
      }
      return
    }
    // Interrupted initialization leaves evidence. Do not manufacture an empty
    // history if any state/temp/journal/node file already exists.
    if ((await readdir(this.options.directory)).length) throw new Error('ADDON_INITIALIZATION_INCOMPLETE_OR_PROFILE_LOST')
    await this.journal.ensureInitialized({ allowCreate: true })
    await this.persist({ schemaVersion: 1, identity: this.options.identity, revision: 0, mode: null, enabled: false, test: null })
    } catch (error) { this.faulted = true; throw error }
  }

  get restartRequired() { return this.faulted || this.needsRestart }
  get recoveryPaused() { return this.recoveredPaused }

  private assertUsable() {
    if (!this.state || this.restartRequired) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
  }

  snapshot(): Readonly<ProfileState & { coldEnableCheckRequired: boolean }> {
    this.assertUsable()
    return { ...structuredClone(this.state), coldEnableCheckRequired: this.state.coldEnableCheckRequired ?? false }
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy || this.restartRequired) throw new Error('ADDON_PROFILE_BUSY_OR_FAULTED')
    this.busy = true
    try { return await action() } finally { this.busy = false }
  }

  private async persist(next: ProfileState) {
    const sealed = this.options.protector.protect(JSON.stringify(next))
    // Validate exactly the bytes that will become authoritative.
    this.parse(sealed)
    if (this.transactionProtected || this.state?.schemaVersion === 2 || next.schemaVersion === 2) {
      try {
        await this.transactions.commit({ id: await this.transactions.nextId(), originalFiles: [], nextProfile: sealed, prepare: async () => {} })
        this.state = next
        return
      } catch (error) { this.faulted = true; throw error }
    }
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
    this.assertUsable()
    const state = await this.readState()
    await this.validateProvenance(state)
    const config = await this.nodes(state.revision).readForRecovery()
    if (config.mode !== state.mode) throw new Error('ADDON_MODE_LOCKED')
    return config
  }

  /** Actual runtime config: unlike recovery display, this requires direct LAN. */
  async read(): Promise<NetworkPrinterConfig> {
    this.assertUsable()
    const state = await this.readState()
    await this.validateProvenance(state)
    if (!state.enabled || state.test?.outcome !== 'CONFIRMED') throw new Error('ADDON_PAUSED_OR_UNCONFIGURED')
    const config = await this.nodes(state.revision).read()
    if (config.mode !== state.mode) throw new Error('ADDON_MODE_LOCKED')
    return config
  }

  async setEnabled(enabled: boolean) {
    return this.exclusive(async () => {
      if (enabled) {
        if (!this.state.revision || this.state.test?.outcome !== 'CONFIRMED') throw new Error('ADDON_TEST_CONFIRMATION_REQUIRED')
        await this.readForRecovery()
        await this.journal.ensureInitialized()
        if (this.journal.records().some(record => record.effectBoundary === 'CROSSING_UNKNOWN')) throw new Error('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
        await this.nodes().read()
      }
      await this.persist({ ...this.state, enabled,
        ...(this.state.schemaVersion === 2 && enabled ? { coldEnableCheckRequired: false } : {}) })
      if (enabled) this.recoveredPaused = false
    })
  }

  private async assertSettledJournal() {
    await this.journal.ensureInitialized()
    if (this.journal.records().some(record => !isColdJournalSettled(record))) throw new Error('ADDON_COLD_LOCAL_WORK_UNSETTLED')
  }

  /** Caller has stopped the existing worker, owns its single-instance lock,
   * and proves this process was already paused when it started. No TCP here. */
  async convertMode(input: NetworkMode, preflight: (context: ColdModePreflightContext) => Promise<void>): Promise<void> {
    this.assertUsable()
    const mode = parseNetworkMode(input)
    if (mode === this.state.mode) throw new Error('ADDON_COLD_SAME_MODE')
    return this.exclusive(async () => {
      try {
        if (this.state.enabled) throw new Error('ADDON_COLD_PAUSE_REQUIRED')
        const test = this.state.test
        if (!this.state.mode || !this.state.revision || test?.outcome !== 'CONFIRMED') throw new Error('ADDON_COLD_SETTLED_TEST_REQUIRED')
        if (this.state.revision >= 10000) throw new Error('ADDON_INVALID_REVISION')
        const config = await this.readForRecovery()
        if (JSON.stringify(test.endpoint) !== JSON.stringify(config.endpoint)) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
        await this.assertSettledJournal()
        const context = { identity: structuredClone(this.options.identity), config, test: structuredClone(test) }
        await preflight(structuredClone(context))
        const originalRaw = await this.transactions.readRegular(this.file, 32768)
        const original = this.parse(originalRaw)
        if (!isDeepStrictEqual(original, this.state)) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
        const nodeName = `nodes-${this.state.revision}.sealed`
        const journalRaw = await this.transactions.readRegular(this.journal.filePath)
        const id = await this.transactions.nextId()
        const revision = this.state.revision + 1
        const conversion: Conversion = { schemaVersion: 1, id, fromMode: this.state.mode, toMode: mode,
          fromRevision: this.state.revision, toRevision: revision, originalProfileSha256: sealedHash(originalRaw),
          originalNodeSha256: sealedHash(await this.transactions.readRegular(path.join(this.options.directory, nodeName), 32768)),
          originalJournalSha256: sealedHash(journalRaw), originalTestSha256: sealedHash(JSON.stringify(original.test)),
          previousConversionId: this.state.conversion?.id ?? null }
        const next: ProfileState = { ...this.state, schemaVersion: 2, mode, revision, enabled: false,
          coldEnableCheckRequired: true, conversion }
        const sealed = this.options.protector.protect(JSON.stringify(next))
        this.parse(sealed)
        this.transactionProtected = true
        await this.transactions.commit({ id, originalFiles: [nodeName, 'execution-journal.json'], nextProfile: sealed,
          prepare: async () => {
            await this.nodes(revision).save({ mode, endpoint: config.endpoint })
            await this.transactions.syncFile(path.join(this.options.directory, `nodes-${revision}.sealed`))
            await this.transactions.syncDirectory(this.options.directory)
            await this.assertSettledJournal()
            await preflight(structuredClone(context))
            await this.assertSettledJournal()
            if (await this.transactions.readRegular(this.journal.filePath) !== journalRaw
              || await this.transactions.readRegular(this.file, 32768) !== originalRaw) throw new Error('ADDON_COLD_LOCAL_WORK_UNSETTLED')
          } })
        this.state = next
      } finally { this.needsRestart = true }
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
