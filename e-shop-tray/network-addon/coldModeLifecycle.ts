import type { CloudRelayClient } from '../src/cloudRelayClient'
import { parseNetworkMode, type NetworkMode } from '../src/networkContract'
import { activateNetworkPrinting } from '../src/networkRuntime'
import { isColdJournalSettled, type NetworkAddonProfile, type ColdModePreflightContext } from './profile'

export const STARTUP_RECOVERY_INTERVAL_MS = 30_000

type StartupRecoveryOptions = {
  onStarted(): void
  onBlocked(error: unknown): void
}

type Options = {
  profile: NetworkAddonProfile
  client: Pick<CloudRelayClient, 'networkQueueState'>
  stopAndWait(): Promise<void>
  assertIdentity(): Promise<void>
  validate(context: ColdModePreflightContext): Promise<void>
  start(): void
  exit(): Promise<void>
}

/** The commercial process uses this one coordinator for its existing poller.
 * Cold means this process opened paused and has never started that poller. */
export class ColdModeLifecycle {
  readonly initializedPaused: boolean
  private started = false
  private exitRequired = false
  private recoveryTimer: NodeJS.Timeout | null = null
  private recoveryGeneration = 0
  private recoveryInFlight = false
  private recoveryActive = false
  private recoveryOptions: StartupRecoveryOptions | undefined
  private readonly bootConfiguration: { mode: NetworkMode | null; revision: number; testId: string | null; kitchenTestId: string | null }

  constructor(private readonly options: Options) {
    const state = options.profile.snapshot()
    this.initializedPaused = !state.enabled
    this.bootConfiguration = { mode: state.mode, revision: state.revision, testId: state.test?.id ?? null,
      kitchenTestId: state.kitchenTest?.id ?? null }
  }

  get everStartedPoller() { return this.started }
  get recoveryWaiting() { return this.recoveryActive }
  get restartRequired() { return this.exitRequired || this.options.profile.restartRequired }
  get coldProcess() {
    if (this.restartRequired || !this.initializedPaused || this.started || !this.bootConfiguration.mode) return false
    const state = this.options.profile.snapshot()
    return !state.enabled && state.revision === this.bootConfiguration.revision
      && state.mode === this.bootConfiguration.mode && state.test?.id === this.bootConfiguration.testId
      && (state.kitchenTest?.id ?? null) === this.bootConfiguration.kitchenTestId
  }
  get endpointChangeProcess() {
    if (this.restartRequired || !this.initializedPaused || this.started) return false
    const state = this.options.profile.snapshot()
    return !state.enabled && state.mode === 'SHARED_PRINTER' && state.test?.outcome === 'CONFIRMED'
  }

  assertMutable() {
    if (this.restartRequired) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
  }

  private start() {
    // Even an exception after a partial start permanently closes the cold gate.
    this.started = true
    this.options.start()
  }

  private static errorCode(error: unknown) {
    return error instanceof Error ? ('code' in error ? String(error.code) : error.message) : ''
  }

  private recoveryGenerationIsCurrent(generation: number) {
    if (!this.recoveryActive || this.recoveryGeneration !== generation || this.restartRequired) return false
    try { return this.options.profile.snapshot().enabled } catch { return false }
  }

  private scheduleStartupRecovery(generation: number) {
    if (!this.recoveryGenerationIsCurrent(generation) || this.recoveryTimer || this.recoveryInFlight) return
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      void this.runStartupRecovery(generation)
    }, STARTUP_RECOVERY_INTERVAL_MS)
  }

  private async runStartupRecovery(generation: number) {
    if (!this.recoveryGenerationIsCurrent(generation)) return
    this.recoveryInFlight = true
    let retry = false
    try {
      await this.resumeAtStartup(() => this.recoveryGenerationIsCurrent(generation))
      if (!this.started || !this.recoveryGenerationIsCurrent(generation)) return
      const onStarted = this.recoveryOptions?.onStarted
      this.recoveryActive = false
      this.recoveryOptions = undefined
      onStarted?.()
    } catch (error) {
      if (!this.recoveryGenerationIsCurrent(generation)) return
      if (ColdModeLifecycle.errorCode(error) === 'NETWORK_PRINTER_UNREACHABLE' && !this.started) retry = true
      else {
        const onBlocked = this.recoveryOptions?.onBlocked
        this.recoveryActive = false
        this.recoveryOptions = undefined
        onBlocked?.(error)
      }
    } finally {
      this.recoveryInFlight = false
      if (retry && this.recoveryGenerationIsCurrent(generation)) this.scheduleStartupRecovery(generation)
    }
  }

  /** Arm only the one recoverable cold-start failure. All later attempts use
   * the same complete startup validator; no partial role recovery is possible. */
  beginStartupRecovery(error: unknown, options: StartupRecoveryOptions): boolean {
    this.assertMutable()
    if (ColdModeLifecycle.errorCode(error) !== 'NETWORK_PRINTER_UNREACHABLE') return false
    const state = this.options.profile.snapshot()
    if (!state.enabled || state.coldEnableCheckRequired || this.started) return false
    this.cancelStartupRecovery()
    this.recoveryActive = true
    this.recoveryOptions = options
    this.scheduleStartupRecovery(this.recoveryGeneration)
    return true
  }

  /** Invalidate both queued and in-flight recovery work before a lifecycle
   * operation can change enabled state, configuration, restart or exit. */
  cancelStartupRecovery() {
    this.recoveryGeneration++
    this.recoveryActive = false
    this.recoveryOptions = undefined
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
  }

  private async currentContext(): Promise<ColdModePreflightContext> {
    const state = this.options.profile.snapshot()
    if (!state.test || state.test.outcome !== 'CONFIRMED') throw new Error('ADDON_TEST_CONFIRMATION_REQUIRED')
    return { identity: state.identity, config: await this.options.profile.readForRecovery(), test: state.test,
      kitchenTest: state.kitchenTest }
  }

  private async assertLocalSettled() {
    await this.options.profile.journal.ensureInitialized()
    if (this.options.profile.journal.records().some(record => !isColdJournalSettled(record))) throw new Error('ADDON_COLD_LOCAL_WORK_UNSETTLED')
  }

  private async assertCloudEmpty() {
    // Only the authenticated GET observes cloud work. A drained poller is not
    // evidence that another browser has stopped creating tasks.
    const state = await this.options.client.networkQueueState()
    if (state.unknown !== 0) throw new Error('ADDON_COLD_CLOUD_UNKNOWN')
    if (state.pending !== 0 || state.claimed !== 0 || state.executing !== 0) throw new Error('ADDON_COLD_CLOUD_WORK_PENDING')
  }

  async resumeAtStartup(isCurrent: () => boolean = () => true): Promise<void> {
    this.assertMutable()
    const state = this.options.profile.snapshot()
    if (!state.enabled) return
    if (state.coldEnableCheckRequired) throw new Error('ADDON_COLD_EXPLICIT_ENABLE_REQUIRED')
    if (!isCurrent()) return
    await this.options.assertIdentity()
    if (!isCurrent()) return
    await this.options.validate(await this.currentContext())
    if (!isCurrent()) return
    this.start()
  }

  async pause() {
    this.cancelStartupRecovery()
    this.assertMutable()
    await this.options.stopAndWait()
    await this.options.profile.setEnabled(false)
  }

  async pauseAndExit() {
    await this.pause()
    await this.safeExit()
  }

  async safeExit() {
    // Retrying exit is always allowed, including after a failed conversion.
    this.cancelStartupRecovery()
    this.exitRequired = true
    await this.options.stopAndWait()
    await this.options.exit()
  }

  async convertAndExit(target: NetworkMode, confirmation: { cashierTabsClosed: boolean; singleAgentConfirmed: boolean }) {
    this.cancelStartupRecovery()
    this.assertMutable()
    const mode = parseNetworkMode(target), state = this.options.profile.snapshot()
    if (state.mode === mode) throw new Error('ADDON_COLD_SAME_MODE')
    if (!this.coldProcess) throw new Error('ADDON_COLD_PROCESS_RESTART_REQUIRED')
    if (confirmation.cashierTabsClosed !== true) throw new Error('ADDON_COLD_CLOSE_CASHIER_REQUIRED')
    if (confirmation.singleAgentConfirmed !== true) throw new Error('ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED')
    await this.options.stopAndWait()
    await this.options.profile.convertMode(mode, async context => {
      await this.options.assertIdentity()
      await this.assertLocalSettled()
      await this.options.validate(context)
      await this.assertCloudEmpty()
      await this.options.assertIdentity()
    })
    await this.safeExit()
  }

  async prepareEndpointChange(confirmation: { cashierTabsClosed: boolean; singleAgentConfirmed: boolean }) {
    this.cancelStartupRecovery()
    this.assertMutable()
    if (!this.endpointChangeProcess) throw new Error('ADDON_COLD_PROCESS_RESTART_REQUIRED')
    if (confirmation.cashierTabsClosed !== true) throw new Error('ADDON_COLD_CLOSE_CASHIER_REQUIRED')
    if (confirmation.singleAgentConfirmed !== true) throw new Error('ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED')
    await this.options.stopAndWait()
    await this.options.assertIdentity()
    await this.assertLocalSettled()
    await this.assertCloudEmpty()
    await this.options.assertIdentity()
  }

  async enable(confirmation: { singleAgentConfirmed: boolean; cashierTabsClosed: boolean }) {
    this.cancelStartupRecovery()
    this.assertMutable()
    if (confirmation.singleAgentConfirmed !== true) throw new Error('ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED')
    const cold = this.options.profile.snapshot().coldEnableCheckRequired
    if (cold && confirmation.cashierTabsClosed !== true) throw new Error('ADDON_COLD_CLOSE_CASHIER_REQUIRED')
    await activateNetworkPrinting({
      isEnabled: () => this.options.profile.snapshot().enabled,
      stopAndWait: () => this.options.stopAndWait(),
      validate: async () => {
        await this.options.assertIdentity()
        await this.options.validate(await this.currentContext())
        if (cold) { await this.assertLocalSettled(); await this.assertCloudEmpty(); await this.options.assertIdentity() }
      },
      persistEnabled: () => this.options.profile.setEnabled(true),
      start: () => this.start(),
    })
  }
}
