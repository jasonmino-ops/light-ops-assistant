import { Socket } from 'node:net'
import os from 'node:os'
import { NETWORK_MAX_BYTES } from '../networkContract'
import { validateNetworkNode, type NetworkNode } from '../networkNodeConfig'

export class NetworkDeliveryError extends Error {
  constructor(public readonly code: string, public readonly effectBoundary: 'NOT_CROSSED' | 'CROSSING_UNKNOWN') {
    super(code)
  }
}

/** No order, role, renderer, cloud URL or fallback transport is accepted here. */
export class NetworkRawTcpTransport {
  private busy = false
  constructor(private readonly options: {
    timeoutMs?: number
    socketFactory?: () => Socket
    interfaces?: Parameters<typeof validateNetworkNode>[1]
  } = {}) {}

  async deliver(bytes: Uint8Array, endpoint: NetworkNode, localAddress?: string) {
    if (this.busy) throw new NetworkDeliveryError('NETWORK_BUSY', 'NOT_CROSSED')
    const node = validateNetworkNode(endpoint, this.options.interfaces)
    if (localAddress !== undefined) {
      const selected = Object.values(this.options.interfaces ?? os.networkInterfaces()).flatMap(items => items ?? [])
        .filter(item => item.family === 'IPv4' && !item.internal && item.address === localAddress)
      if (selected.length !== 1) throw new NetworkDeliveryError('NETWORK_SOURCE_CHANGED', 'NOT_CROSSED')
      validateNetworkNode(endpoint, { selected })
    }
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > NETWORK_MAX_BYTES) {
      throw new NetworkDeliveryError('NETWORK_INVALID_BYTES', 'NOT_CROSSED')
    }
    this.busy = true
    const started = Date.now()
    try {
      return await new Promise<{ bytesWritten: number; durationMs: number; effectBoundary: 'CROSSED'; physicalCompletionKnown: false }>((resolve, reject) => {
        const socket = this.options.socketFactory?.() ?? new Socket()
        let attempted = false
        let settled = false
        let sent = 0
        const finish = (code?: string) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          socket.destroy()
          if (code) reject(new NetworkDeliveryError(code, attempted ? 'CROSSING_UNKNOWN' : 'NOT_CROSSED'))
          else resolve({ bytesWritten: sent, durationMs: Date.now() - started,
            effectBoundary: 'CROSSED', physicalCompletionKnown: false })
        }
        const timer = setTimeout(() => finish('NETWORK_TCP_TIMEOUT'), this.options.timeoutMs ?? 15000)
        socket.once('error', () => finish('NETWORK_TCP_ERROR'))
        socket.once('close', () => { if (!settled) finish('NETWORK_TCP_CLOSED') })
        socket.once('end', () => { if (!settled) finish('NETWORK_TCP_PEER_ENDED') })
        socket.once('connect', () => {
          const writeNext = () => {
            if (settled) return
            if (sent === bytes.byteLength) {
              socket.end(() => finish())
              return
            }
            const chunk = bytes.subarray(sent, Math.min(sent + 16384, bytes.byteLength))
            let flushed = false
            let drained = false
            let writeReturned = false
            let advanced = false
            const advance = () => {
              if (settled || advanced || !writeReturned || !flushed || !drained) return
              advanced = true
              socket.off('drain', onDrain)
              sent += chunk.byteLength
              writeNext()
            }
            const onDrain = () => { drained = true; advance() }
            socket.once('drain', onDrain)
            attempted = true
            try {
              const writable = socket.write(chunk, error => {
                if (error) { finish('NETWORK_TCP_WRITE_FAILED'); return }
                flushed = true
                advance()
              })
              drained = drained || writable
              writeReturned = true
              advance()
            } catch { finish('NETWORK_TCP_WRITE_FAILED') }
          }
          writeNext()
        })
        try { socket.setNoDelay(true); socket.connect({ host: node.host, port: node.port, family: 4,
          ...(localAddress === undefined ? {} : { localAddress }) }) }
        catch { finish('NETWORK_TCP_CONNECT_FAILED') }
      })
    } finally { this.busy = false }
  }
}
