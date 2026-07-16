import net from 'node:net'
import {
  HRT_CONTRACT_VERSION,
  HrtCommandRequestPayload,
  HrtCommandResultPayload,
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
  private readonly decoder = new ProviderFrameDecoder()
  private sequence = 0
  private readonly pendingCommands = new Map<string, {
    timer: NodeJS.Timeout
    resolve: (result: HrtCommandResultPayload) => void
    reject: (error: Error) => void
  }>()
  readonly pipeName: string

  constructor(private readonly options: WindowsProviderPipeClientOptions) {
    this.pipeName = options.pipeName ?? buildWindowsProviderPipeName()
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.pipeName, () => {
        this.socket = socket
        logger.info('provider.transport.connected', { pipeNameHash: safePipeIdentifier(this.pipeName) })
        this.sendHandshake()
        resolve()
      })
      socket.once('error', reject)
      socket.on('data', (chunk) => this.handleData(chunk))
      socket.on('close', () => {
        this.rejectPendingCommands('PIPE_CLOSED')
        this.options.onClose?.('pipe_closed')
      })
    })
  }

  executeCommand(command: HrtCommandRequestPayload, timeoutMs = 30000): Promise<HrtCommandResultPayload> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('PROVIDER_UNAVAILABLE'))
    if (this.pendingCommands.size >= 64) return Promise.reject(new Error('PROVIDER_COMMAND_BACKPRESSURE'))
    const correlationId = `desktop-command-${this.nextSequence()}`
    if (this.pendingCommands.has(correlationId)) return Promise.reject(new Error('DUPLICATE_CORRELATION'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(correlationId)
        reject(new Error('PRINT_TIMEOUT'))
      }, timeoutMs)
      this.pendingCommands.set(correlationId, { timer, resolve, reject })
      this.write({
        contractVersion: HRT_CONTRACT_VERSION,
        messageType: 'command.request',
        correlationId,
        instanceId: this.options.runtimeInstanceId,
        sequence: this.sequence,
        timestamp: new Date().toISOString(),
        payload: command,
      })
    })
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
    this.rejectPendingCommands('PROVIDER_SHUTDOWN')
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
    this.rejectPendingCommands('PIPE_DESTROYED')
    this.socket?.destroy()
    this.socket = null
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
    if (frame.messageType === 'command.result') {
      this.resolveCommand(frame.correlationId, frame.payload as HrtCommandResultPayload)
      return
    }
    if (frame.messageType === 'provider.shutdown') return
    this.options.onProtocolError?.('UNSUPPORTED_PROVIDER_FRAME')
  }

  private write(frame: HrtFrame<unknown>): void {
    this.socket?.write(encodeProviderEnvelope({ supervisorToken: this.options.supervisorToken, frame }))
  }

  private nextSequence(): number {
    this.sequence += 1
    return this.sequence
  }

  private resolveCommand(correlationId: string, payload: HrtCommandResultPayload): void {
    const pending = this.pendingCommands.get(correlationId)
    if (!pending) {
      logger.warn('provider.command.unknown-correlation', { correlationId })
      return
    }
    clearTimeout(pending.timer)
    this.pendingCommands.delete(correlationId)
    pending.resolve(payload)
  }

  private rejectPendingCommands(code: string): void {
    for (const [correlationId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer)
      pending.reject(new Error(code))
      this.pendingCommands.delete(correlationId)
    }
  }
}
