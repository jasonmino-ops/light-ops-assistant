import { randomUUID } from 'node:crypto'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { HrtCommandRequestPayload, HrtCommandResultPayload, HrtHealthSnapshotPayload, HrtProviderRegistrationPayload } from '@eshop/hrt-contract'
import { logger } from '../logger'
import { getHealthSnapshot, recordHealthError, updateHealth } from '../runtimeHealth'
import { HrtProviderSupervision } from '../hrt/providerSupervision'
import { buildWindowsProviderPipeName, safePipeIdentifier } from './providerPipeName'
import { generateSupervisorToken, resolveWindowsProviderEntry, spawnWindowsProvider } from './providerProcess'
import { WindowsProviderPipeClient } from './namedPipeClient'
import { isCompatibleWindowsProvider } from './providerCompatibility'

export interface WindowsProviderSupervisorOptions {
  runtimeInstanceId?: string
  pipeSuffix?: string
  connectDelayMs?: number
}

export class WindowsProviderSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private client: WindowsProviderPipeClient | null = null
  private stopping = false
  private readonly supervision = new HrtProviderSupervision()
  private readonly runtimeInstanceId: string
  private readonly pipeName: string
  private registration: HrtProviderRegistrationPayload | null = null
  private healthSnapshot: HrtHealthSnapshotPayload | null = null

  constructor(private readonly options: WindowsProviderSupervisorOptions = {}) {
    this.runtimeInstanceId = options.runtimeInstanceId ?? `desktop-runtime-${randomUUID()}`
    this.pipeName = buildWindowsProviderPipeName({ suffix: options.pipeSuffix })
  }

  async start(): Promise<void> {
    const entry = resolveWindowsProviderEntry()
    if (!entry.entryPath) {
      updateHealth({ providerRuntime: { state: 'error', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'PROVIDER_ENTRY_MISSING' } }, 'provider.entry-missing')
      return
    }
    const supervisorToken = generateSupervisorToken()
    this.child = spawnWindowsProvider({
      entryPath: entry.entryPath,
      pipeName: this.pipeName,
      supervisorToken,
    })
    updateHealth({
      providerRuntime: {
        state: 'starting',
        pid: this.child.pid ?? null,
        pipeNameHash: safePipeIdentifier(this.pipeName),
        lastError: null,
      },
    }, 'provider.started')
    logger.info('provider.process.started', { pid: this.child.pid, entrySource: entry.source, pipeNameHash: safePipeIdentifier(this.pipeName) })
    this.child.stdout.on('data', (chunk) => logger.info('provider.stdout', { line: String(chunk).slice(0, 500) }))
    this.child.stderr.on('data', (chunk) => logger.warn('provider.stderr', { line: String(chunk).slice(0, 500) }))
    this.child.on('exit', (code, signal) => this.handleExit(code, signal))
    await this.connectAfterDelay(supervisorToken)
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.client?.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 100))
    this.client?.destroy()
    if (this.child && !this.child.killed) this.child.kill()
    updateHealth({ providerRuntime: { state: 'closed', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: null } }, 'provider.stopped')
    this.updatePrinterReadiness({ providerConnected: false, lastPrintError: null })
  }

  async executeCommand(command: HrtCommandRequestPayload, timeoutMs?: number): Promise<HrtCommandResultPayload> {
    if (!this.client) throw new Error('PROVIDER_UNAVAILABLE')
    if (!this.registration?.supportedCapabilities.includes('printer.receipt')) throw new Error('CAPABILITY_UNSUPPORTED')
    this.updatePrinterReadiness({ lastPrintCommandAt: new Date().toISOString(), lastPrintError: null })
    try {
      const result = await this.client.executeCommand(command, timeoutMs)
      this.updatePrinterReadiness({ lastPrintOutcome: result.outcome, lastPrintError: result.errorCode ?? null })
      return result
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN'
      this.updatePrinterReadiness({ lastPrintOutcome: code, lastPrintError: code })
      throw error
    }
  }

  private async connectAfterDelay(supervisorToken: string): Promise<void> {
    const delayMs = this.options.connectDelayMs ?? 250
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (this.stopping) return
    this.client = new WindowsProviderPipeClient({
      pipeName: this.pipeName,
      supervisorToken,
      runtimeInstanceId: this.runtimeInstanceId,
      onHandshake: (payload) => {
        const compatible = payload.readyTransition === 'RUNTIME_AUTHORIZED' && isCompatibleWindowsProvider(payload.provider)
        this.registration = payload.provider
        updateHealth({
          providerRuntime: {
            state: compatible ? 'ok' : 'error',
            pid: this.child?.pid ?? null,
            providerId: payload.provider.providerId,
            providerInstanceId: payload.provider.providerInstanceId,
            pipeNameHash: safePipeIdentifier(this.pipeName),
            lastError: compatible ? null : 'PROVIDER_INCOMPATIBLE',
          },
        }, 'provider.handshake')
        this.updatePrinterReadiness({ providerConnected: compatible })
        if (compatible) this.supervision.markHealthy()
      },
      onRegistration: (payload) => {
        this.registration = payload
        logger.info('provider.registered', {
          providerId: payload.providerId,
          providerInstanceId: payload.providerInstanceId,
          providerVersion: payload.providerVersion,
        })
        this.updatePrinterReadiness({})
      },
      onHealth: (payload) => {
        this.healthSnapshot = payload
        updateHealth({
          providerRuntime: {
            state: payload.providerHealth === 'READY' ? 'ok' : 'degraded',
            pid: this.child?.pid ?? null,
            providerInstanceId: payload.providerInstanceId,
            pipeNameHash: safePipeIdentifier(this.pipeName),
            lastError: null,
          },
        }, 'provider.health')
        this.updatePrinterReadiness({ providerConnected: payload.providerHealth === 'READY' })
      },
      onProtocolError: (code) => recordHealthError('provider', `transport protocol error: ${code}`),
      onClose: () => {
        if (!this.stopping) updateHealth({ providerRuntime: { state: 'closed', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'PIPE_CLOSED' } }, 'provider.transport.closed')
        this.updatePrinterReadiness({ providerConnected: false, lastPrintError: 'PIPE_CLOSED' })
      },
    })
    try {
      await this.client.connect()
      this.client.requestHealth()
    } catch (error) {
      recordHealthError('provider', `connect failed: ${error instanceof Error ? error.message : String(error)}`)
      updateHealth({ providerRuntime: { state: 'error', pid: this.child?.pid ?? null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'CONNECT_FAILED' } }, 'provider.connect-failed')
      this.updatePrinterReadiness({ providerConnected: false, lastPrintError: 'CONNECT_FAILED' })
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.stopping) return
    const decision = this.supervision.onDisconnect(Date.now())
    updateHealth({
      providerRuntime: {
        state: decision.restartAllowed ? 'degraded' : 'error',
        pid: null,
        pipeNameHash: safePipeIdentifier(this.pipeName),
        lastError: `PROVIDER_EXIT code=${code ?? 'null'} signal=${signal ?? 'null'}`,
        restartAttempts: decision.restartAttempt,
      },
    }, 'provider.exited')
    logger.warn('provider.process.exited', { code, signal, decision })
    this.updatePrinterReadiness({ providerConnected: false, lastPrintError: 'PROVIDER_EXIT' })
  }

  private updatePrinterReadiness(patch: Partial<ReturnType<typeof getHealthSnapshot>['printerRuntime']>): void {
    const current = getHealthSnapshot().printerRuntime
    const printerDevice = this.healthSnapshot?.devices.find((device) =>
      device.device.deviceKind === 'PRINTER' && device.capabilities.includes('printer.receipt')
    )
    updateHealth({
      printerRuntime: {
        ...current,
        providerConnected: patch.providerConnected ?? current.providerConnected,
        printerCapabilityAvailable: this.registration?.supportedCapabilities.includes('printer.receipt') === true,
        configuredPrinterName: process.env.ESHOP_PRINTER_NAME ?? current.configuredPrinterName ?? 'XP-80C',
        printHelperPresent: this.registration?.supportedCapabilities.includes('printer.receipt') === true,
        printerExecutorAvailable: !!printerDevice || this.registration?.supportedCapabilities.includes('printer.receipt') === true,
        lastPrintCommandAt: patch.lastPrintCommandAt ?? current.lastPrintCommandAt,
        lastPrintOutcome: patch.lastPrintOutcome ?? current.lastPrintOutcome,
        lastPrintError: patch.lastPrintError !== undefined ? patch.lastPrintError : current.lastPrintError,
      },
    }, 'printer-runtime.updated')
  }
}
