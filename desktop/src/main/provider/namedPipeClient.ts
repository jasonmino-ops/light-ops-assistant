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
  private readonly decoder = new ProviderFrameDecoder()
  private sequence = 0
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
      socket.on('close', () => this.options.onClose?.('pipe_closed'))
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
}
