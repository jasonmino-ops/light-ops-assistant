import { randomUUID } from 'node:crypto'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { logger } from '../logger'
import { recordHealthError, updateHealth } from '../runtimeHealth'
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
        if (compatible) this.supervision.markHealthy()
      },
      onRegistration: (payload) => {
        logger.info('provider.registered', {
          providerId: payload.providerId,
          providerInstanceId: payload.providerInstanceId,
          providerVersion: payload.providerVersion,
        })
      },
      onHealth: (payload) => {
        updateHealth({
          providerRuntime: {
            state: payload.providerHealth === 'READY' ? 'ok' : 'degraded',
            pid: this.child?.pid ?? null,
            providerInstanceId: payload.providerInstanceId,
            pipeNameHash: safePipeIdentifier(this.pipeName),
            lastError: null,
          },
        }, 'provider.health')
      },
      onProtocolError: (code) => recordHealthError('provider', `transport protocol error: ${code}`),
      onClose: () => {
        if (!this.stopping) updateHealth({ providerRuntime: { state: 'closed', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'PIPE_CLOSED' } }, 'provider.transport.closed')
      },
    })
    try {
      await this.client.connect()
      this.client.requestHealth()
    } catch (error) {
      recordHealthError('provider', `connect failed: ${error instanceof Error ? error.message : String(error)}`)
      updateHealth({ providerRuntime: { state: 'error', pid: this.child?.pid ?? null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'CONNECT_FAILED' } }, 'provider.connect-failed')
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
  }
}
