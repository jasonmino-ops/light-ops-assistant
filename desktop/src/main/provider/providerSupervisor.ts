import { randomUUID } from 'node:crypto'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { logger } from '../logger'
import { recordHealthError, updateHealth } from '../runtimeHealth'
import { HrtProviderSupervision } from '../hrt/providerSupervision'
import { buildWindowsProviderPipeName, safePipeIdentifier } from './providerPipeName'
import {
  generateSupervisorToken,
  resolveWindowsProviderEntry,
  spawnWindowsProvider,
  type ProviderEntryResolution,
} from './providerProcess'
import {
  WindowsProviderPipeClient,
  type WindowsProviderPipeClientOptions,
} from './namedPipeClient'
import { isCompatibleWindowsProvider } from './providerCompatibility'

export type WindowsProviderPipeClientLike = Pick<
  WindowsProviderPipeClient,
  'connect' | 'requestHealth' | 'shutdown' | 'destroy'
>

export interface WindowsProviderSupervisorOptions {
  runtimeInstanceId?: string
  pipeSuffix?: string
  connectDelayMs?: number
  connectRetryMs?: number
  maxConnectAttempts?: number
  supervision?: HrtProviderSupervision
  now?: () => number
  resolveEntry?: () => ProviderEntryResolution
  spawnProvider?: typeof spawnWindowsProvider
  clientFactory?: (options: WindowsProviderPipeClientOptions) => WindowsProviderPipeClientLike
}

/**
 * Owns exactly one Provider child process. Every replacement is serialized
 * behind the prior child's exit and the bounded HRT supervision backoff.
 */
export class WindowsProviderSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private client: WindowsProviderPipeClientLike | null = null
  private stopping = false
  private generation = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private entry: ProviderEntryResolution | null = null
  private readonly supervision: HrtProviderSupervision
  private readonly runtimeInstanceId: string
  private readonly pipeName: string

  constructor(private readonly options: WindowsProviderSupervisorOptions = {}) {
    this.runtimeInstanceId = options.runtimeInstanceId ?? `desktop-runtime-${randomUUID()}`
    this.pipeName = buildWindowsProviderPipeName({ suffix: options.pipeSuffix })
    this.supervision = options.supervision ?? new HrtProviderSupervision()
  }

  async start(): Promise<void> {
    if (this.child || this.restartTimer) return
    this.stopping = false
    this.supervision.manualReset()
    this.entry = (this.options.resolveEntry ?? resolveWindowsProviderEntry)()
    if (!this.entry.entryPath) {
      updateHealth({ providerRuntime: { state: 'error', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'PROVIDER_ENTRY_MISSING' } }, 'provider.entry-missing')
      throw new Error('PROVIDER_ENTRY_MISSING')
    }
    await this.spawnAndConnect(this.entry)
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.generation += 1
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const client = this.client
    const child = this.child
    this.client = null
    this.child = null
    client?.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 100))
    client?.destroy()
    if (child && child.exitCode === null && !child.killed) child.kill()
    updateHealth({ providerRuntime: { state: 'closed', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: null } }, 'provider.stopped')
  }

  private async spawnAndConnect(entry: ProviderEntryResolution): Promise<void> {
    if (this.stopping || this.child || !entry.entryPath) return
    const supervisorToken = generateSupervisorToken()
    const generation = ++this.generation
    let child: ChildProcessWithoutNullStreams
    try {
      child = (this.options.spawnProvider ?? spawnWindowsProvider)({
        entryPath: entry.entryPath,
        pipeName: this.pipeName,
        supervisorToken,
      })
    } catch (error) {
      recordHealthError('provider', `spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      this.scheduleRestart('PROVIDER_SPAWN_FAILED')
      return
    }
    this.child = child
    updateHealth({
      providerRuntime: {
        state: 'starting',
        pid: child.pid ?? null,
        pipeNameHash: safePipeIdentifier(this.pipeName),
        lastError: null,
        restartAttempts: this.supervision.restartAttempts(),
      },
    }, 'provider.started')
    logger.info('provider.process.started', { pid: child.pid, entrySource: entry.source, pipeNameHash: safePipeIdentifier(this.pipeName) })
    child.stdout.on('data', (chunk) => logger.info('provider.stdout', { line: String(chunk).slice(0, 500) }))
    child.stderr.on('data', (chunk) => logger.warn('provider.stderr', { line: String(chunk).slice(0, 500) }))
    child.once('exit', (code, signal) => this.handleExit(child, code, signal))
    await this.connectWithRetry(child, supervisorToken, generation)
  }

  private async connectWithRetry(
    child: ChildProcessWithoutNullStreams,
    supervisorToken: string,
    generation: number,
  ): Promise<void> {
    await this.wait(this.options.connectDelayMs ?? 250)
    const attempts = Math.max(1, this.options.maxConnectAttempts ?? 5)
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (!this.isCurrent(child, generation)) return
      const connection = this.createClient(child, supervisorToken, generation)
      const client = connection.client
      this.client?.destroy()
      this.client = client
      try {
        await client.connect()
        connection.markConnected()
        if (!this.isCurrent(child, generation) || this.client !== client) {
          client.destroy()
          return
        }
        client.requestHealth()
        return
      } catch (error) {
        client.destroy()
        if (this.client === client) this.client = null
        if (!this.isCurrent(child, generation)) return
        if (attempt < attempts) {
          await this.wait(this.options.connectRetryMs ?? 250)
          continue
        }
        recordHealthError('provider', `connect failed: ${error instanceof Error ? error.message : String(error)}`)
        updateHealth({ providerRuntime: {
          state: 'error', pid: child.pid ?? null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'CONNECT_FAILED',
          restartAttempts: this.supervision.restartAttempts(),
        } }, 'provider.connect-failed')
        // A live but unreachable Provider is not useful and would otherwise
        // leave Desktop permanently degraded. Its exit enters the same bounded
        // respawn path as a crash.
        if (child.exitCode === null && !child.killed) child.kill()
      }
    }
  }

  private createClient(
    child: ChildProcessWithoutNullStreams,
    supervisorToken: string,
    generation: number,
  ): { client: WindowsProviderPipeClientLike; markConnected: () => void } {
    const factory = this.options.clientFactory ?? ((options) => new WindowsProviderPipeClient(options))
    let connected = false
    let client: WindowsProviderPipeClientLike
    client = factory({
      pipeName: this.pipeName,
      supervisorToken,
      runtimeInstanceId: this.runtimeInstanceId,
      onHandshake: (payload) => {
        if (!this.isCurrent(child, generation) || this.client !== client) return
        const compatible = payload.readyTransition === 'RUNTIME_AUTHORIZED' && isCompatibleWindowsProvider(payload.provider)
        updateHealth({
          providerRuntime: {
            state: compatible ? 'ok' : 'error',
            pid: child.pid ?? null,
            providerId: payload.provider.providerId,
            providerInstanceId: payload.provider.providerInstanceId,
            pipeNameHash: safePipeIdentifier(this.pipeName),
            lastError: compatible ? null : 'PROVIDER_INCOMPATIBLE',
            restartAttempts: this.supervision.restartAttempts(),
          },
        }, 'provider.handshake')
        if (compatible) this.supervision.markHealthy()
        else if (child.exitCode === null && !child.killed) child.kill()
      },
      onRegistration: (payload) => {
        if (!this.isCurrent(child, generation)) return
        logger.info('provider.registered', {
          providerId: payload.providerId,
          providerInstanceId: payload.providerInstanceId,
          providerVersion: payload.providerVersion,
        })
      },
      onHealth: (payload) => {
        if (!this.isCurrent(child, generation) || this.client !== client) return
        updateHealth({
          providerRuntime: {
            state: payload.providerHealth === 'READY' ? 'ok' : 'degraded',
            pid: child.pid ?? null,
            providerInstanceId: payload.providerInstanceId,
            pipeNameHash: safePipeIdentifier(this.pipeName),
            lastError: null,
            restartAttempts: this.supervision.restartAttempts(),
          },
        }, 'provider.health')
      },
      onProtocolError: (code) => {
        if (this.isCurrent(child, generation)) recordHealthError('provider', `transport protocol error: ${code}`)
      },
      onClose: () => {
        // A failed connection attempt also emits close. It must not kill the
        // just-spawned Provider before the bounded connection retries finish.
        if (!connected) return
        if (!this.isCurrent(child, generation) || this.client !== client) return
        updateHealth({ providerRuntime: {
          state: 'degraded', pid: child.pid ?? null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'PIPE_CLOSED',
          restartAttempts: this.supervision.restartAttempts(),
        } }, 'provider.transport.closed')
        if (child.exitCode === null && !child.killed) child.kill()
      },
    })
    return { client, markConnected: () => { connected = true } }
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    if (child !== this.child) return
    this.child = null
    this.generation += 1
    this.client?.destroy()
    this.client = null
    if (this.stopping) return
    const decision = this.supervision.onDisconnect((this.options.now ?? Date.now)())
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
    if (!decision.restartAllowed) return
    this.scheduleRestart('PROVIDER_EXIT', decision.backoffMs)
  }

  private scheduleRestart(reason: string, backoffMs?: number): void {
    if (this.stopping || this.restartTimer || !this.entry?.entryPath) return
    const decision = backoffMs == null
      ? this.supervision.onDisconnect((this.options.now ?? Date.now)())
      : null
    if (decision && !decision.restartAllowed) {
      updateHealth({ providerRuntime: {
        state: 'error', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: reason,
        restartAttempts: decision.restartAttempt,
      } }, 'provider.restart-exhausted')
      return
    }
    const delayMs = backoffMs ?? decision!.backoffMs
    logger.warn('provider.restart.scheduled', {
      reason,
      delayMs,
      restartAttempt: decision?.restartAttempt ?? this.supervision.restartAttempts(),
    })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopping || this.child || !this.entry) return
      void this.spawnAndConnect(this.entry)
    }, delayMs)
  }

  private isCurrent(child: ChildProcessWithoutNullStreams, generation: number): boolean {
    return !this.stopping && this.child === child && this.generation === generation
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
  }
}
