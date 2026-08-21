import {
  CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX,
  CASHIER_REALTIME_WEBSOCKET_PROTOCOL,
  type CashierRealtimeWakeMessage,
  type CashierRealtimeWakeType,
  parseCashierRealtimeWakeMessage,
} from './cashier-realtime-protocol'

export type CashierRealtimeTicketResponse = {
  ticket: string
  gatewayUrl: string
  expiresAt: string
  storeCode: string
}

export type CashierRealtimeConnectionStatus = 'connecting' | 'healthy' | 'degraded' | 'stopped'

export async function acquireCashierRealtimeTicket(input: {
  storeCode: string
  headers?: HeadersInit
  fetchImpl?: typeof fetch
}): Promise<CashierRealtimeTicketResponse> {
  const response = await (input.fetchImpl ?? fetch)('/api/cashier-realtime/ticket', {
    method: 'POST',
    headers: { ...Object.fromEntries(new Headers(input.headers).entries()), 'content-type': 'application/json' },
    body: JSON.stringify({ storeCode: input.storeCode }),
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null) as CashierRealtimeTicketResponse | null
  if (!response.ok || !data?.ticket || !data.gatewayUrl) throw new Error('CASHIER_REALTIME_TICKET_FAILED')
  return data
}

function websocketUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new Error('INVALID_CASHIER_REALTIME_GATEWAY_URL')
  url.pathname = '/connect'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function createCashierRealtimeWakeCoalescer(input: {
  onWake: (type: CashierRealtimeWakeType) => void
  delayMs?: number
}) {
  const timers = new Map<CashierRealtimeWakeType, ReturnType<typeof setTimeout>>()
  const latest = new Map<CashierRealtimeWakeType, CashierRealtimeWakeMessage>()
  const delayMs = Math.min(Math.max(input.delayMs ?? 350, 250), 500)
  return {
    push(message: CashierRealtimeWakeMessage) {
      latest.set(message.type, message)
      const previous = timers.get(message.type)
      if (previous) clearTimeout(previous)
      timers.set(message.type, setTimeout(() => {
        timers.delete(message.type)
        if (latest.delete(message.type)) input.onWake(message.type)
      }, delayMs))
    },
    clear() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      latest.clear()
    },
  }
}

/** Standalone capability only; app/cashier/page.tsx does not instantiate it in Stage 1B. */
export function createCashierRealtimeClient(input: {
  getTicket: () => Promise<CashierRealtimeTicketResponse>
  onWake: (type: CashierRealtimeWakeType) => void
  onStatus?: (status: CashierRealtimeConnectionStatus) => void
  onConnected?: (reconnected: boolean) => void
  webSocketFactory?: (url: string, protocols: string[]) => WebSocket
  reconnectDelayMs?: number
}) {
  let socket: WebSocket | null = null
  let stopped = true
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let connectedBefore = false
  let attempts = 0
  const coalescer = createCashierRealtimeWakeCoalescer({ onWake: input.onWake })

  function setStatus(status: CashierRealtimeConnectionStatus) {
    input.onStatus?.(status)
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return
    const base = Math.max(input.reconnectDelayMs ?? 1_000, 250)
    const delay = Math.min(base * 2 ** Math.min(attempts, 5), 30_000)
    attempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  async function connect() {
    if (stopped) return
    const currentGeneration = ++generation
    setStatus('connecting')
    try {
      const ticket = await input.getTicket()
      if (stopped || currentGeneration !== generation) return
      const factory = input.webSocketFactory ?? ((url, protocols) => new WebSocket(url, protocols))
      const nextSocket = factory(websocketUrl(ticket.gatewayUrl), [
        CASHIER_REALTIME_WEBSOCKET_PROTOCOL,
        `${CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX}${ticket.ticket}`,
      ])
      socket = nextSocket
      nextSocket.onopen = () => {
        if (stopped || currentGeneration !== generation) return
        attempts = 0
        setStatus('healthy')
        input.onConnected?.(connectedBefore)
        connectedBefore = true
      }
      nextSocket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const parsed = parseCashierRealtimeWakeMessage(JSON.parse(event.data) as unknown)
          if (parsed) coalescer.push(parsed)
        } catch { /* Invalid gateway messages are ignored. */ }
      }
      nextSocket.onerror = () => {
        if (!stopped) setStatus('degraded')
      }
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = null
        if (stopped || currentGeneration !== generation) return
        setStatus('degraded')
        scheduleReconnect()
      }
    } catch {
      if (stopped || currentGeneration !== generation) return
      setStatus('degraded')
      scheduleReconnect()
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      attempts = 0
      void connect()
    },
    stop() {
      if (stopped) return
      stopped = true
      generation += 1
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      coalescer.clear()
      socket?.close(1000, 'client_stopped')
      socket = null
      setStatus('stopped')
    },
  }
}
