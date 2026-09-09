import type { CloudRelayClient } from '../src/cloudRelayClient'
import { parseNetworkMode, type NetworkMode } from '../src/networkContract'
import { activateNetworkPrinting } from '../src/networkRuntime'
import { isColdJournalSettled, type NetworkAddonProfile, type ColdModePreflightContext } from './profile'

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
  private readonly bootConfiguration: { mode: NetworkMode | null; revision: number; testId: string | null }

  constructor(private readonly options: Options) {
    const state = options.profile.snapshot()
    this.initializedPaused = !state.enabled
    this.bootConfiguration = { mode: state.mode, revision: state.revision, testId: state.test?.id ?? null }
  }

  get everStartedPoller() { return this.started }
  get restartRequired() { return this.exitRequired || this.options.profile.restartRequired }
  get coldProcess() {
    if (this.restartRequired || !this.initializedPaused || this.started || !this.bootConfiguration.mode) return false
    const state = this.options.profile.snapshot()
    return !state.enabled && state.revision === this.bootConfiguration.revision
      && state.mode === this.bootConfiguration.mode && state.test?.id === this.bootConfiguration.testId
  }

  assertMutable() {
    if (this.restartRequired) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
  }

  private start() {
    // Even an exception after a partial start permanently closes the cold gate.
    this.started = true
    this.options.start()
  }

  private async currentContext(): Promise<ColdModePreflightContext> {
    const state = this.options.profile.snapshot()
    if (!state.test || state.test.outcome !== 'CONFIRMED') throw new Error('ADDON_TEST_CONFIRMATION_REQUIRED')
    return { identity: state.identity, config: await this.options.profile.readForRecovery(), test: state.test }
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

  async resumeAtStartup() {
    this.assertMutable()
    const state = this.options.profile.snapshot()
    if (!state.enabled) return
    if (state.coldEnableCheckRequired) throw new Error('ADDON_COLD_EXPLICIT_ENABLE_REQUIRED')
    await this.options.assertIdentity()
    await this.options.validate(await this.currentContext())
    this.start()
  }

  async pause() {
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
    this.exitRequired = true
    await this.options.stopAndWait()
    await this.options.exit()
  }

  async convertAndExit(target: NetworkMode, confirmation: { cashierTabsClosed: boolean; singleAgentConfirmed: boolean }) {
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

  async enable(confirmation: { singleAgentConfirmed: boolean; cashierTabsClosed: boolean }) {
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
