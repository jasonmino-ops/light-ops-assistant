import type { NetworkPrinterConfig } from '../src/networkNodeConfig'
import type { NetworkAddonProfile } from './profile'
import path from 'node:path'

export function networkLoginItem(items: readonly { name: string; scope: string; path: string; args: string[]; enabled: boolean }[], executable: string) {
  const normalize = (value: string) => path.win32.normalize(value).toLowerCase()
  const matches = items.filter(item => item.name === 'EShopNetworkPrintAddon' && item.scope === 'user'
    && normalize(item.path) === normalize(executable))
  if (matches.length !== 1) return null
  const item = matches[0]
  if (typeof item.enabled !== 'boolean' || !(item.args.length === 0 || (item.args.length === 1 && item.args[0] === '--background'))) return null
  return { enabled: item.enabled, background: item.args.length === 1 }
}

export type EntryIntent = 'cashier' | 'manage' | 'background'
export function entryIntent(argv: readonly string[]): EntryIntent {
  const intents = argv.filter(value => ['--cashier', '--manage', '--background'].includes(value))
  if (intents.length > 1) throw new Error('ADDON_ENTRY_ARGUMENTS_REJECTED')
  // Existing Windows Run entries have no arguments and retain their old behavior.
  return intents[0] === '--cashier' ? 'cashier' : intents[0] === '--background' ? 'background' : 'manage'
}

export type CashierEntry = { config: NetworkPrinterConfig; revision: number; warning: boolean }
export function cashierBlocker(state: ReturnType<NetworkAddonProfile['snapshot']> | undefined, restartRequired: boolean): string | null {
  if (restartRequired) return 'ADDON_PROFILE_RESTART_REQUIRED'
  if (!state) return 'DESKTOP_BINDING_NOT_ACTIVE'
  if (state.coldEnableCheckRequired) return 'ADDON_COLD_EXPLICIT_ENABLE_REQUIRED'
  if (!state.revision || !state.mode) return 'ADDON_CASHIER_SETUP_REQUIRED'
  if (state.test?.outcome !== 'CONFIRMED') return 'ADDON_TEST_CONFIRMATION_REQUIRED'
  return null
}

/** Read-only browser admission. It never activates printing, checks a live LAN,
 * repairs a profile, or manufactures a missing binding/configuration. */
export async function readCashierEntry(options: {
  profile: NetworkAddonProfile; restartRequired: boolean; printingReady: boolean; assertIdentity(): Promise<void>
}): Promise<CashierEntry> {
  const state = options.profile.snapshot()
  const blocked = cashierBlocker(state, options.restartRequired || options.profile.restartRequired)
  if (blocked) throw new Error(blocked)
  const config = await options.profile.readForRecovery()
  await options.assertIdentity()
  const current = options.profile.snapshot()
  const changed = cashierBlocker(current, options.restartRequired || options.profile.restartRequired)
  if (changed) throw new Error(changed)
  if (current.revision !== state.revision || config.mode !== current.mode
    || current.test?.endpoint.host !== config.endpoint.host || current.test.endpoint.port !== config.endpoint.port) {
    throw new Error('ADDON_ENTRY_CONFIGURATION_CHANGED')
  }
  return { config, revision: current.revision, warning: !current.enabled || !options.printingReady }
}

type Options = {
  initialize(): Promise<void>
  readCashier(): Promise<CashierEntry>
  confirmWarning(): Promise<boolean>
  openCashier(config: NetworkPrinterConfig): Promise<void>
  showManagement(): void
  errorCode(error: unknown): string
}

/** One resident process owns initialization, management operations and browser
 * admission. Concurrent cashier requests share one confirmation/ticket/spawn. */
export class EntryCoordinator {
  private initialization: Promise<void> | undefined
  private initializing = false
  private operation: Promise<unknown> | undefined
  private entry: Promise<void> | undefined
  private exitOperation: Promise<void> | undefined
  private exiting = false
  private launchCode = 'ENTRY_IDLE'

  constructor(private readonly options: Options) {}
  get busy() { return this.initializing || !!this.operation || !!this.entry || !!this.exitOperation }
  get entryPending() { return !!this.entry }
  get entryCode() { return this.launchCode }
  get isExiting() { return this.exiting }

  private assertOpen() { if (this.exiting) throw new Error('ADDON_EXIT_IN_PROGRESS') }
  initialize(): Promise<void> {
    this.assertOpen()
    if (!this.initialization) {
      this.initializing = true
      this.initialization = Promise.resolve().then(() => this.options.initialize()).finally(() => { this.initializing = false })
    }
    return this.initialization
  }

  runOperation<T>(action: () => Promise<T>, retryInitialization = false, maintenanceOnly = false): Promise<T> {
    this.assertOpen()
    if (this.operation || this.entry) return Promise.reject(new Error('ADDON_BUSY'))
    const pending = Promise.resolve().then(async () => {
      if (retryInitialization) {
        // Explicit retry only. Failed startup is retained until this action.
        try { await this.initialization } catch { /* The caller requested a new binding read. */ }
        this.assertOpen(); this.initialization = undefined
        await this.initialize()
      } else if (maintenanceOnly) {
        // Shortcut/binding maintenance must remain reachable when first-time
        // binding initialization failed. It never retries or enables printing.
        try { await this.initialization } catch { /* Preserve the original setup failure. */ }
      } else { await this.initialize() }
      this.assertOpen()
      return action()
    }).finally(() => { if (this.operation === pending) this.operation = undefined })
    this.operation = pending
    return pending
  }

  launchCashier(): Promise<void> {
    if (this.exiting) return Promise.reject(new Error('ADDON_EXIT_IN_PROGRESS'))
    if (this.entry) return this.entry
    this.launchCode = 'ENTRY_OPENING'
    const pending = Promise.resolve().then(async () => {
      await this.initialize()
      // A mode change can close the process while a click is queued. Recheck
      // admission only after it settles; never launch using the old mode.
      try { await this.operation } catch { /* Re-read the authoritative gates below. */ }
      this.assertOpen()
      const first = await this.options.readCashier()
      let approvedWarning = false
      if (first.warning) {
        this.launchCode = 'ENTRY_PRINT_WARNING'
        approvedWarning = await this.options.confirmWarning()
        if (!approvedWarning) { this.launchCode = 'ENTRY_CANCELLED'; return }
      }
      this.assertOpen()
      let current = await this.options.readCashier()
      if (current.warning && !approvedWarning) {
        this.launchCode = 'ENTRY_PRINT_WARNING'
        if (!await this.options.confirmWarning()) { this.launchCode = 'ENTRY_CANCELLED'; return }
        this.assertOpen(); current = await this.options.readCashier()
      }
      if (current.revision !== first.revision || JSON.stringify(current.config) !== JSON.stringify(first.config)) {
        throw new Error('ADDON_ENTRY_CONFIGURATION_CHANGED')
      }
      this.assertOpen()
      await this.options.openCashier(current.config)
      this.launchCode = 'ENTRY_OPENED'
    }).catch(error => {
      this.launchCode = this.options.errorCode(error)
      if (!this.exiting) this.options.showManagement()
      throw error
    }).finally(() => { if (this.entry === pending) this.entry = undefined })
    this.entry = pending
    return pending
  }

  async dispatch(intent: EntryIntent): Promise<void> {
    this.assertOpen()
    if (intent === 'cashier') { await this.launchCashier(); return }
    try { await this.initialize() }
    catch (error) {
      this.launchCode = this.options.errorCode(error)
      if (intent === 'manage') this.options.showManagement()
      throw error
    }
    this.assertOpen()
    if (intent === 'manage') this.options.showManagement()
  }

  markExiting() { this.exiting = true }
  exit(action: () => Promise<void>): Promise<void> {
    this.markExiting()
    if (this.exitOperation) return this.exitOperation
    const pending = (async () => {
      try { await this.initialization } catch { /* Exit remains available after setup failure. */ }
      try { await this.operation } catch { /* Existing operation reports its own error. */ }
      try { await this.entry } catch { /* A pending entry observes exiting before launching. */ }
      await action()
    })().finally(() => { if (this.exitOperation === pending) this.exitOperation = undefined })
    this.exitOperation = pending
    return pending
  }
}
