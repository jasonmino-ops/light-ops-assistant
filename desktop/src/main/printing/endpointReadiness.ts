import net from 'node:net'
import type { ConfiguredLocalEndpoint } from './localEndpointAuthority'

export type ReadinessSocket = Pick<net.Socket, 'once' | 'destroy' | 'setTimeout'>
export type ReadinessSocketFactory = (options: { host: string; port: number }) => ReadinessSocket

function parseEndpointKey(endpointKey: string): { host: string; port: number } | null {
  const separator = endpointKey.lastIndexOf(':')
  const host = endpointKey.slice(0, separator)
  const port = Number(endpointKey.slice(separator + 1))
  return separator > 0 && host.length > 0 && Number.isInteger(port) && port > 0 && port <= 65535
    ? { host, port }
    : null
}

export class NoPayloadEndpointReadiness {
  public constructor(
    private readonly timeoutMs = 3_000,
    private readonly createSocket: ReadinessSocketFactory = (options) => net.createConnection(options),
  ) {}

  public async check(endpoints: readonly ConfiguredLocalEndpoint[]): Promise<
    { ok: true } | { ok: false; code: string; role?: string }
  > {
    if (endpoints.length === 0) return { ok: false, code: 'ENDPOINT_CONFIG_EMPTY' }
    if (new Set(endpoints.map(({ role }) => role)).size !== endpoints.length) {
      return { ok: false, code: 'ENDPOINT_ROLE_DUPLICATE' }
    }
    for (const endpoint of endpoints) {
      if (!await this.probe(endpoint.endpointKey)) {
        return { ok: false, code: `ENDPOINT_${endpoint.role}_UNREACHABLE`, role: endpoint.role }
      }
    }
    return { ok: true }
  }

  private probe(endpointKey: string): Promise<boolean> {
    const endpoint = parseEndpointKey(endpointKey)
    if (!endpoint) return Promise.resolve(false)
    return new Promise((resolve) => {
      let settled = false
      const finish = (ready: boolean, socket?: ReadinessSocket) => {
        if (settled) return
        settled = true
        socket?.destroy()
        resolve(ready)
      }
      let socket: ReadinessSocket
      try {
        socket = this.createSocket(endpoint)
      } catch {
        finish(false)
        return
      }
      socket.setTimeout(this.timeoutMs)
      socket.once('connect', () => finish(true, socket))
      socket.once('timeout', () => finish(false, socket))
      socket.once('error', () => finish(false, socket))
      socket.once('close', () => finish(false))
    })
  }
}
