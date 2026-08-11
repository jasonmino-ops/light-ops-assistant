import { randomUUID } from 'node:crypto'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from '@eshop/hrt-contract'
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
  printerName?: string | null
}

export class WindowsProviderSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private client: WindowsProviderPipeClient | null = null
  private finalStopping = false
  private startPromise: Promise<void> | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private readonly expectedExitPids = new Set<number>()
  private readonly supervision = new HrtProviderSupervision()
  private readonly runtimeInstanceId: string
  private readonly pipeName: string
  private registration: HrtProviderRegistrationPayload | null = null
  private healthSnapshot: HrtHealthSnapshotPayload | null = null
  private handshakeAuthorized = false
  private printerName: string | null
  private ready = false

  constructor(private readonly options: WindowsProviderSupervisorOptions = {}) {
    this.runtimeInstanceId = options.runtimeInstanceId ?? `store-runtime-${randomUUID()}`
    this.pipeName = buildWindowsProviderPipeName({ suffix: options.pipeSuffix })
    this.printerName = this.normalizePrinterName(options.printerName)
  }

  isReady(): boolean {
    return this.ready && this.registration?.supportedCapabilities.includes('printer.receipt') === true
  }

  configuredPrinterName(): string | null {
    return this.printerName
  }

  async setPrinterBinding(printerName: string | null): Promise<void> {
    const normalized = this.normalizePrinterName(printerName)
    if (normalized === this.printerName && (normalized === null || this.child !== null)) {
      this.updatePrinterReadiness({ configuredPrinterName: normalized })
      return
    }
    this.printerName = normalized
    this.supervision.manualReset()
    if (!normalized) {
      await this.stopProcess('printer-binding-disabled')
      this.updatePrinterReadiness({
        configuredPrinterName: null,
        providerConnected: false,
        printerCapabilityAvailable: false,
        printerExecutorAvailable: false,
        lastPrintError: 'PRINTER_NOT_CONFIGURED',
      })
      return
    }
    if (this.child || this.client) await this.stopProcess('printer-binding-changed')
    await this.start()
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    if (this.child) return
    this.finalStopping = false
    if (!this.printerName) {
      this.updatePrinterReadiness({
        configuredPrinterName: null,
        providerConnected: false,
        printerCapabilityAvailable: false,
        printerExecutorAvailable: false,
        lastPrintError: 'PRINTER_NOT_CONFIGURED',
      })
      return
    }
    this.startPromise = this.startInternal().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async stop(): Promise<void> {
    this.finalStopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    await this.stopProcess('runtime-stopped')
  }

  async executeCommand(command: HrtCommandRequestPayload, timeoutMs = 30_000): Promise<HrtCommandResultPayload> {
    if (!this.client || !this.isReady()) throw new Error('PROVIDER_UNAVAILABLE')
    this.updatePrinterReadiness({ lastPrintCommandAt: new Date().toISOString(), lastPrintError: null })
    try {
      const result = await this.client.executeCommand(command, timeoutMs)
      if (!this.registration || result.providerInstanceId !== this.registration.providerInstanceId) {
        throw new Error('STALE_PROVIDER_INSTANCE')
      }
      this.updatePrinterReadiness({ lastPrintOutcome: result.outcome, lastPrintError: result.errorCode ?? null })
      return result
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN'
      this.updatePrinterReadiness({ lastPrintOutcome: 'FAILED', lastPrintError: code })
      throw error
    }
  }

  private async startInternal(): Promise<void> {
    const entry = resolveWindowsProviderEntry()
    if (!entry.entryPath) {
      updateHealth({
        providerRuntime: {
          state: 'error',
          pid: null,
          pipeNameHash: safePipeIdentifier(this.pipeName),
          lastError: 'PROVIDER_ENTRY_MISSING',
        },
      }, 'provider.entry-missing')
      this.updatePrinterReadiness({ providerConnected: false, lastPrintError: 'PROVIDER_ENTRY_MISSING' })
      return
    }
    const supervisorToken = generateSupervisorToken()
    const child = spawnWindowsProvider({
      entryPath: entry.entryPath,
      pipeName: this.pipeName,
      supervisorToken,
      printerName: this.printerName ?? undefined,
    })
    this.child = child
    this.ready = false
    this.handshakeAuthorized = false
    updateHealth({
      providerRuntime: {
        state: 'starting',
        pid: child.pid ?? null,
        pipeNameHash: safePipeIdentifier(this.pipeName),
        lastError: null,
      },
    }, 'provider.started')
    logger.info('provider.process.started', {
      pid: child.pid,
      entrySource: entry.source,
      pipeNameHash: safePipeIdentifier(this.pipeName),
      printerConfigured: Boolean(this.printerName),
    })
    child.stdout.on('data', (chunk) => logger.info('provider.stdout', { line: String(chunk).slice(0, 500) }))
    child.stderr.on('data', (chunk) => logger.warn('provider.stderr', { line: String(chunk).slice(0, 500) }))
    child.on('exit', (code, signal) => this.handleExit(child, code, signal))
    await this.connectAfterDelay(supervisorToken, child)
  }

  private async stopProcess(reason: string): Promise<void> {
    this.ready = false
    this.handshakeAuthorized = false
    this.registration = null
    this.healthSnapshot = null
    const client = this.client
    this.client = null
    client?.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 100))
    client?.destroy()
    const child = this.child
    this.child = null
    if (child?.pid) this.expectedExitPids.add(child.pid)
    if (child && !child.killed) child.kill()
    updateHealth({
      providerRuntime: {
        state: this.finalStopping ? 'closed' : 'starting',
        pid: null,
        pipeNameHash: safePipeIdentifier(this.pipeName),
        lastError: this.finalStopping ? null : reason,
      },
    }, 'provider.stopped')
    this.updatePrinterReadiness({ providerConnected: false })
  }

  private async connectAfterDelay(supervisorToken: string, child: ChildProcessWithoutNullStreams): Promise<void> {
    const delayMs = this.options.connectDelayMs ?? 250
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (this.finalStopping || this.child !== child) return
    const client = new WindowsProviderPipeClient({
      pipeName: this.pipeName,
      supervisorToken,
      runtimeInstanceId: this.runtimeInstanceId,
      onHandshake: (payload) => {
        if (this.child !== child) return
        const compatible = payload.readyTransition === 'RUNTIME_AUTHORIZED' && isCompatibleWindowsProvider(payload.provider)
        this.registration = payload.provider
        this.handshakeAuthorized = compatible
        this.ready = compatible
        updateHealth({
          providerRuntime: {
            state: compatible ? 'ok' : 'error',
            pid: child.pid ?? null,
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
        if (this.child !== child) return
        this.registration = payload
        logger.info('provider.registered', {
          providerId: payload.providerId,
          providerInstanceId: payload.providerInstanceId,
          providerVersion: payload.providerVersion,
        })
        this.updatePrinterReadiness({})
      },
      onHealth: (payload) => {
        if (this.child !== child) return
        this.healthSnapshot = payload
        const healthy = payload.providerHealth === 'READY'
        this.ready = this.handshakeAuthorized && healthy
        updateHealth({
          providerRuntime: {
            state: this.ready ? 'ok' : this.handshakeAuthorized ? 'degraded' : 'error',
            pid: child.pid ?? null,
            providerInstanceId: payload.providerInstanceId,
            pipeNameHash: safePipeIdentifier(this.pipeName),
            lastError: this.ready ? null : this.handshakeAuthorized ? 'PROVIDER_HEALTH_NOT_READY' : 'PROVIDER_INCOMPATIBLE',
          },
        }, 'provider.health')
        this.updatePrinterReadiness({ providerConnected: this.ready })
      },
      onProtocolError: (code) => recordHealthError('provider', `transport protocol error: ${code}`),
      onClose: () => {
        if (!this.finalStopping && this.child === child) {
          updateHealth({
            providerRuntime: {
              state: 'closed',
              pid: child.pid ?? null,
              pipeNameHash: safePipeIdentifier(this.pipeName),
              lastError: 'PIPE_CLOSED',
            },
          }, 'provider.transport.closed')
        }
        this.ready = false
        this.handshakeAuthorized = false
        this.updatePrinterReadiness({ providerConnected: false, lastPrintError: 'PIPE_CLOSED' })
      },
    })
    this.client = client
    try {
      await client.connect()
      client.requestHealth()
    } catch (error) {
      recordHealthError('provider', `connect failed: ${error instanceof Error ? error.message : String(error)}`)
      this.scheduleRestart('CONNECT_FAILED', child)
    }
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    const pid = child.pid
    if (pid && this.expectedExitPids.delete(pid)) return
    if (this.child !== child) return
    this.child = null
    this.client?.destroy()
    this.client = null
    this.ready = false
    this.handshakeAuthorized = false
    this.registration = null
    if (this.finalStopping) return
    logger.warn('provider.process.exited', { code, signal })
    this.scheduleRestart(`PROVIDER_EXIT code=${code ?? 'null'} signal=${signal ?? 'null'}`)
  }

  private scheduleRestart(lastError: string, child?: ChildProcessWithoutNullStreams) {
    if (this.finalStopping || !this.printerName) return
    if (child && this.child === child) {
      this.child = null
      if (child.pid) this.expectedExitPids.add(child.pid)
      if (!child.killed) child.kill()
    }
    this.client?.destroy()
    this.client = null
    this.ready = false
    this.handshakeAuthorized = false
    const decision = this.supervision.onDisconnect(Date.now())
    updateHealth({
      providerRuntime: {
        state: decision.restartAllowed ? 'degraded' : 'error',
        pid: null,
        pipeNameHash: safePipeIdentifier(this.pipeName),
        lastError,
        restartAttempts: decision.restartAttempt,
      },
    }, 'provider.restart-decision')
    this.updatePrinterReadiness({ providerConnected: false, lastPrintError: lastError })
    if (!decision.restartAllowed) return
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.start().catch((error) => recordHealthError('provider', `restart failed: ${String(error)}`))
    }, decision.backoffMs)
  }

  private updatePrinterReadiness(patch: Partial<ReturnType<typeof getHealthSnapshot>['printerRuntime']>): void {
    const current = getHealthSnapshot().printerRuntime
    const printerDevice = this.healthSnapshot?.devices.find((device) =>
      device.device.deviceKind === 'PRINTER' && device.capabilities.includes('printer.receipt')
    )
    updateHealth({
      printerRuntime: {
        ...current,
        configuredPrinterName: patch.configuredPrinterName !== undefined ? patch.configuredPrinterName : this.printerName,
        providerConnected: patch.providerConnected ?? current.providerConnected,
        printerCapabilityAvailable: this.registration?.supportedCapabilities.includes('printer.receipt') === true,
        printerExecutorAvailable: this.isReady() && (Boolean(printerDevice) || this.healthSnapshot === null),
        lastPrintCommandAt: patch.lastPrintCommandAt ?? current.lastPrintCommandAt,
        lastPrintOutcome: patch.lastPrintOutcome ?? current.lastPrintOutcome,
        lastPrintError: patch.lastPrintError !== undefined ? patch.lastPrintError : current.lastPrintError,
      },
    }, 'printer-runtime.updated')
  }

  private normalizePrinterName(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? ''
    return normalized ? normalized : null
  }
}
