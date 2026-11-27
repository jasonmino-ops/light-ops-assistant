import { randomUUID } from 'node:crypto'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { logger } from '../logger'
import { recordHealthError, updateHealth } from '../runtimeHealth'
import { HrtProviderSupervision } from '../hrt/providerSupervision'
import { buildWindowsProviderPipeName, safePipeIdentifier } from './providerPipeName'
import { generateSupervisorToken, resolveWindowsProviderEntry, spawnWindowsProvider } from './providerProcess'
import { WindowsProviderPipeClient } from './namedPipeClient'
import { isCompatibleWindowsProvider } from './providerCompatibility'

const STARTUP_CONNECT_TIMEOUT_MS = 5_000

export interface WindowsProviderSupervisorOptions {
  runtimeInstanceId?: string
  pipeSuffix?: string
  connectDelayMs?: number
}

export class WindowsProviderSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private client: WindowsProviderPipeClient | null = null
  private stopping = false
  private childExited = false
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private startupAbort: AbortController | null = null
  private readonly supervision = new HrtProviderSupervision()
  private readonly runtimeInstanceId: string
  private readonly pipeName: string

  constructor(private readonly options: WindowsProviderSupervisorOptions = {}) {
    this.runtimeInstanceId = options.runtimeInstanceId ?? `desktop-runtime-${randomUUID()}`
    this.pipeName = buildWindowsProviderPipeName({ suffix: options.pipeSuffix })
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    if (this.stopping) return Promise.resolve()
    // Reserve the startup flight before spawning or awaiting anything.
    this.startPromise = Promise.resolve().then(() => this.startProvider())
    return this.startPromise
  }

  private async startProvider(): Promise<void> {
    if (this.stopping) return
    const entry = resolveWindowsProviderEntry()
    if (!entry.entryPath) {
      updateHealth({ providerRuntime: { state: 'error', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'PROVIDER_ENTRY_MISSING' } }, 'provider.entry-missing')
      return
    }
    const supervisorToken = generateSupervisorToken()
    const startup = new AbortController()
    this.startupAbort = startup
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
    this.child.on('error', (error) => {
      this.childExited = true
      startup.abort()
      const client = this.client
      this.client = null
      client?.destroy()
      if (!this.stopping) {
        recordHealthError('provider', `provider start failed: ${error.message}`)
        updateHealth({ providerRuntime: { state: 'error', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName),
          lastError: 'PROVIDER_PROCESS_ERROR' } }, 'provider.process.error')
      }
    })
    try { await this.connectAtStartup(supervisorToken, startup) }
    finally { this.startupAbort = null }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    this.startupAbort?.abort()
    const client = this.client
    this.client = null
    this.stopPromise = this.stopProvider(client)
    return this.stopPromise
  }

  private async stopProvider(client: WindowsProviderPipeClient | null): Promise<void> {
    client?.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 100))
    client?.destroy()
    if (this.child && !this.child.killed) this.child.kill()
    updateHealth({ providerRuntime: { state: 'closed', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: null } }, 'provider.stopped')
  }

  private createClient(supervisorToken: string): WindowsProviderPipeClient {
    let client: WindowsProviderPipeClient
    const current = () => !this.stopping && !this.childExited && this.client === client
    client = new WindowsProviderPipeClient({
      pipeName: this.pipeName,
      supervisorToken,
      runtimeInstanceId: this.runtimeInstanceId,
      onHandshake: (payload) => {
        if (!current()) return
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
        if (!current()) return
        logger.info('provider.registered', {
          providerId: payload.providerId,
          providerInstanceId: payload.providerInstanceId,
          providerVersion: payload.providerVersion,
        })
      },
      onHealth: (payload) => {
        if (!current()) return
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
      onProtocolError: (code) => { if (current()) recordHealthError('provider', `transport protocol error: ${code}`) },
      onClose: () => {
        if (current()) updateHealth({ providerRuntime: { state: 'closed', pid: null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: 'PIPE_CLOSED' } }, 'provider.transport.closed')
      },
    })
    return client
  }

  private waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); reject(signal.reason) }
      const timer = setTimeout(() => { cleanup(); resolve() }, delayMs)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  private async connectAtStartup(supervisorToken: string, startup: AbortController): Promise<void> {
    const began = performance.now()
    const deadlineAt = began + STARTUP_CONNECT_TIMEOUT_MS
    const timeout = Object.assign(new Error('Provider startup connection deadline exceeded'), { code: 'PROVIDER_CONNECT_TIMEOUT' })
    const deadline = setTimeout(() => startup.abort(timeout), STARTUP_CONNECT_TIMEOUT_MS)
    let retryDelayMs = 50
    let attempt = 0
    try {
      const initialDelay = this.options.connectDelayMs ?? 0
      if (initialDelay > 0) await this.waitForRetry(Math.min(initialDelay, STARTUP_CONNECT_TIMEOUT_MS), startup.signal)
      while (!startup.signal.aborted) {
        if (performance.now() >= deadlineAt) throw timeout
        const client = this.createClient(supervisorToken)
        this.client = client
        attempt++
        let connected = false
        try {
          await client.connect(startup.signal, deadlineAt)
          connected = true
          if (!startup.signal.aborted && !this.stopping && this.client === client) client.requestHealth()
          return // Never reconnect after the first successful connection.
        } catch (error) {
          if (this.client === client) this.client = null
          client.destroy()
          if (startup.signal.aborted) throw startup.signal.reason
          if (connected) throw error // Health writes are not startup-connect failures.
          const remaining = deadlineAt - performance.now()
          if (remaining <= 0) throw timeout
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
          const delayMs = Math.min(retryDelayMs, remaining)
          logger.info('provider.connect.retry', { attempt, delayMs, elapsedMs: performance.now() - began,
            pipeNameHash: safePipeIdentifier(this.pipeName) })
          await this.waitForRetry(delayMs, startup.signal)
          retryDelayMs = Math.min(retryDelayMs * 2, 500)
        }
      }
      throw startup.signal.reason
    } catch (error) {
      if (this.stopping || this.childExited) return
      recordHealthError('provider', `connect failed: ${error instanceof Error ? error.message : String(error)}`)
      const timedOut = error && typeof error === 'object' && 'code' in error && error.code === 'PROVIDER_CONNECT_TIMEOUT'
      updateHealth({ providerRuntime: { state: 'error', pid: this.child?.pid ?? null, pipeNameHash: safePipeIdentifier(this.pipeName), lastError: timedOut ? 'CONNECT_TIMEOUT' : 'CONNECT_FAILED' } }, 'provider.connect-failed')
    } finally {
      clearTimeout(deadline)
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.childExited = true
    this.startupAbort?.abort()
    const client = this.client
    this.client = null
    client?.destroy()
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
