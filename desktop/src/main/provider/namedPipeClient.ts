import net from 'node:net'
import {
  HRT_CONTRACT_VERSION,
  HrtFrame,
  HrtHandshakeRequestPayload,
  HrtHandshakeResponsePayload,
  HrtHealthSnapshotPayload,
  HrtProviderRegistrationPayload,
} from '@eshop/hrt-contract'
import { logger } from '../logger'
import { buildWindowsProviderPipeName, safePipeIdentifier } from './providerPipeName'
import { ProviderFrameDecoder, encodeProviderEnvelope } from './providerTransportFraming'
import { WINDOWS_PROVIDER_COMPATIBILITY_MATRIX, requiredWindowsProviderCapabilities } from './providerCompatibility'

export interface WindowsProviderPipeClientOptions {
  pipeName?: string
  supervisorToken: string
  runtimeInstanceId: string
  onHandshake?: (payload: HrtHandshakeResponsePayload) => void
  onRegistration?: (payload: HrtProviderRegistrationPayload) => void
  onHealth?: (payload: HrtHealthSnapshotPayload) => void
  onClose?: (reason: string) => void
  onProtocolError?: (code: string) => void
}

export class WindowsProviderPipeClient {
  private socket: net.Socket | null = null
  private connection: Promise<void> | null = null
  private cancelPending: (() => void) | null = null
  private connected = false
  private disposed = false
  private readonly decoder = new ProviderFrameDecoder()
  private sequence = 0
  readonly pipeName: string

  constructor(private readonly options: WindowsProviderPipeClientOptions) {
    this.pipeName = options.pipeName ?? buildWindowsProviderPipeName()
  }

  connect(signal?: AbortSignal, deadlineAt?: number): Promise<void> {
    if (this.connection) return this.connection
    if (this.disposed || signal?.aborted) return Promise.reject(this.cancelled(signal))
    const expired = () => deadlineAt !== undefined && performance.now() >= deadlineAt
    const timeout = () => Object.assign(new Error('Provider startup connection deadline exceeded'), { code: 'PROVIDER_CONNECT_TIMEOUT' })
    if (expired()) return Promise.reject(timeout())
    this.connection = new Promise((resolve, reject) => {
      // Own the socket while connecting, so quit/deadline can actually cancel it.
      const socket = net.connect(this.pipeName)
      this.socket = socket
      const current = () => !this.disposed && this.socket === socket
      const cleanup = () => {
        signal?.removeEventListener('abort', abort)
        this.cancelPending = null
      }
      const fail = (error: Error) => {
        if (!current() || this.connected) return
        cleanup()
        this.socket = null
        this.disposed = true
        socket.destroy()
        reject(error)
      }
      const abort = () => fail(this.cancelled(signal))
      this.cancelPending = abort
      signal?.addEventListener('abort', abort, { once: true })
      socket.once('connect', () => {
        if (!current() || signal?.aborted) { abort(); return }
        // I/O may run before an overdue timer after an event-loop stall.
        if (expired()) { fail(timeout()); return }
        this.connected = true
        cleanup()
        try {
          logger.info('provider.transport.connected', { pipeNameHash: safePipeIdentifier(this.pipeName) })
          this.sendHandshake()
          resolve()
        } catch (error) {
          this.destroy()
          // A connected socket must never enter the startup ENOENT retry path,
          // even if a synchronous handshake write happens to report ENOENT.
          reject(Object.assign(new Error('Provider handshake failed'), { code: 'PROVIDER_HANDSHAKE_FAILED', cause: error }))
        }
      })
      // Keep an error listener after settlement; retired sockets must not throw.
      socket.on('error', (error) => {
        if (!current()) return
        if (!this.connected) fail(error)
        else this.destroy()
      })
      socket.on('data', (chunk) => { if (current() && this.connected) this.handleData(chunk) })
      socket.on('close', () => {
        if (!current()) return
        if (!this.connected) {
          fail(Object.assign(new Error('Provider pipe closed before connection'), { code: 'PIPE_CLOSED' }))
        } else this.destroy()
      })
      if (signal?.aborted) abort()
    })
    return this.connection
  }

  requestHealth(): void {
    this.write({
      contractVersion: HRT_CONTRACT_VERSION,
      messageType: 'health.snapshot',
      correlationId: `desktop-health-${this.nextSequence()}`,
      instanceId: this.options.runtimeInstanceId,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      payload: { request: true },
    })
  }

  shutdown(): void {
    if (!this.socket || this.socket.destroyed) return
    this.write({
      contractVersion: HRT_CONTRACT_VERSION,
      messageType: 'provider.shutdown',
      correlationId: `desktop-shutdown-${this.nextSequence()}`,
      instanceId: this.options.runtimeInstanceId,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      payload: { reason: 'desktop_shutdown' },
    })
  }

  destroy(): void {
    if (this.cancelPending) { this.cancelPending(); return }
    const socket = this.socket
    const wasConnected = this.connected
    this.socket = null
    this.connected = false
    this.disposed = true
    socket?.destroy()
    if (wasConnected) this.options.onClose?.('pipe_closed')
  }

  private cancelled(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error ? signal.reason
      : Object.assign(new Error('Provider connection cancelled'), { code: 'PROVIDER_CONNECT_CANCELLED' })
  }

  private sendHandshake(): void {
    const payload: HrtHandshakeRequestPayload = {
      runtimeInstanceId: this.options.runtimeInstanceId,
      requiredContractVersion: HRT_CONTRACT_VERSION,
      requiredCapabilities: requiredWindowsProviderCapabilities(),
      compatibilityMatrix: WINDOWS_PROVIDER_COMPATIBILITY_MATRIX,
      initiatedBy: 'RUNTIME',
    }
    this.write({
      contractVersion: HRT_CONTRACT_VERSION,
      messageType: 'runtime.handshake.request',
      correlationId: `desktop-handshake-${this.nextSequence()}`,
      instanceId: this.options.runtimeInstanceId,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      payload,
    })
  }

  private handleData(chunk: Buffer): void {
    for (const decoded of this.decoder.push(chunk)) {
      if (!decoded.ok) {
        this.options.onProtocolError?.(decoded.code)
        this.destroy()
        return
      }
      this.handleFrame(decoded.envelope.frame)
    }
  }

  private handleFrame(frame: HrtFrame<unknown>): void {
    if (frame.messageType === 'provider.handshake.response') {
      this.options.onHandshake?.(frame.payload as HrtHandshakeResponsePayload)
      return
    }
    if (frame.messageType === 'provider.register') {
      this.options.onRegistration?.(frame.payload as HrtProviderRegistrationPayload)
      return
    }
    if (frame.messageType === 'health.snapshot') {
      this.options.onHealth?.(frame.payload as HrtHealthSnapshotPayload)
      return
    }
    if (frame.messageType === 'provider.shutdown') return
    this.options.onProtocolError?.('UNSUPPORTED_PROVIDER_FRAME')
  }

  private write(frame: HrtFrame<unknown>): void {
    if (this.connected && !this.disposed && this.socket && !this.socket.destroyed) {
      this.socket.write(encodeProviderEnvelope({ supervisorToken: this.options.supervisorToken, frame }))
    }
  }

  private nextSequence(): number {
    this.sequence += 1
    return this.sequence
  }
}
