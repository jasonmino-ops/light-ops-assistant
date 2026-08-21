import {
  CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX,
  CASHIER_REALTIME_WEBSOCKET_PROTOCOL,
  cashierRealtimeStoreObjectName,
  decodeCashierRealtimeJson,
  encodeCashierRealtimeJson,
  parseCashierRealtimeServerNotify,
  toCashierRealtimeWakeMessage,
  verifyCashierRealtimeServerNotify,
  verifyCashierRealtimeTicket,
  type CashierRealtimeServerNotify,
  type CashierRealtimeTicketClaims,
} from '../../../lib/cashier-realtime-protocol'

type HibernatableWebSocket = WebSocket & {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

type DurableObjectStorageLike = {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  transaction<T>(callback: (transaction: Pick<DurableObjectStorageLike, 'get' | 'put'>) => Promise<T>): Promise<T>
}

export type DurableObjectStateLike = {
  storage: DurableObjectStorageLike
  acceptWebSocket(socket: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
  setWebSocketAutoResponse?(pair: unknown): void
}

type DurableObjectStubLike = { fetch(request: Request): Promise<Response> }
type DurableObjectNamespaceLike = { getByName(name: string): DurableObjectStubLike }

export type CashierRealtimeGatewayEnv = {
  STORE_REALTIME_GATEWAY: DurableObjectNamespaceLike
  CASHIER_REALTIME_TICKET_SECRET: string
  CASHIER_REALTIME_NOTIFY_SECRET: string
  CASHIER_REALTIME_ALLOWED_ORIGINS: string
}

type ConnectionAttachment = {
  storeObjectName: string
  subjectType: 'user' | 'device'
  subjectId: string
  ticketId: string
  expiresAt: number
}

type ReplayLedger = Record<string, number>

declare const WebSocketPair: {
  new(): { 0: WebSocket; 1: HibernatableWebSocket }
}

declare const WebSocketRequestResponsePair: {
  new(request: string, response: string): unknown
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function dedicatedSecretConfigured(value: string | undefined): value is string {
  return typeof value === 'string' && new TextEncoder().encode(value).byteLength >= 32
}

function gatewaySecretsSeparated(env: CashierRealtimeGatewayEnv): boolean {
  return dedicatedSecretConfigured(env.CASHIER_REALTIME_TICKET_SECRET) &&
    dedicatedSecretConfigured(env.CASHIER_REALTIME_NOTIFY_SECRET) &&
    env.CASHIER_REALTIME_TICKET_SECRET !== env.CASHIER_REALTIME_NOTIFY_SECRET
}

function originAllowed(request: Request, configured: string): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const allowed = configured.split(',').map((value) => value.trim()).filter(Boolean)
  return allowed.includes(origin)
}

function extractTicket(request: Request): string | null {
  const offered = request.headers.get('sec-websocket-protocol')
  if (!offered) return null
  for (const protocol of offered.split(',').map((value) => value.trim())) {
    if (protocol.startsWith(CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX)) {
      return protocol.slice(CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX.length)
    }
  }
  return null
}

export async function authorizeCashierRealtimeWebSocket(
  request: Request,
  env: Pick<CashierRealtimeGatewayEnv, 'CASHIER_REALTIME_TICKET_SECRET' | 'CASHIER_REALTIME_ALLOWED_ORIGINS'>,
  nowMs = Date.now(),
): Promise<
  | { ok: true; claims: CashierRealtimeTicketClaims; storeObjectName: string }
  | { ok: false; status: number; error: string }
> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return { ok: false, status: 426, error: 'WEBSOCKET_UPGRADE_REQUIRED' }
  }
  if (!dedicatedSecretConfigured(env.CASHIER_REALTIME_TICKET_SECRET) || !env.CASHIER_REALTIME_ALLOWED_ORIGINS) {
    return { ok: false, status: 503, error: 'GATEWAY_NOT_CONFIGURED' }
  }
  if (!originAllowed(request, env.CASHIER_REALTIME_ALLOWED_ORIGINS)) {
    return { ok: false, status: 403, error: 'ORIGIN_NOT_ALLOWED' }
  }
  const ticket = extractTicket(request)
  if (!ticket) return { ok: false, status: 401, error: 'TICKET_REQUIRED' }
  const verified = await verifyCashierRealtimeTicket(ticket, env.CASHIER_REALTIME_TICKET_SECRET, { nowMs })
  if (!verified.ok) return { ok: false, status: 401, error: `TICKET_${verified.reason.toUpperCase()}` }
  return {
    ok: true,
    claims: verified.claims,
    storeObjectName: cashierRealtimeStoreObjectName(verified.claims),
  }
}

function parseConnectionAttachment(value: unknown): ConnectionAttachment | null {
  if (typeof value !== 'object' || !value || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort().join(',')
  if (keys !== ['expiresAt', 'storeObjectName', 'subjectId', 'subjectType', 'ticketId'].sort().join(',')) return null
  if (
    typeof record.storeObjectName !== 'string' ||
    (record.subjectType !== 'user' && record.subjectType !== 'device') ||
    typeof record.subjectId !== 'string' ||
    typeof record.ticketId !== 'string' ||
    !Number.isSafeInteger(record.expiresAt)
  ) return null
  return record as ConnectionAttachment
}

async function recordEventOnce(
  storage: DurableObjectStorageLike,
  eventId: string,
  timestamp: number,
): Promise<boolean> {
  return storage.transaction(async (transaction) => {
    const current = await transaction.get<ReplayLedger>('notify-replay-v1') ?? {}
    const cutoff = timestamp - 5 * 60_000
    const retained = Object.fromEntries(
      Object.entries(current)
        .filter(([, seenAt]) => Number.isSafeInteger(seenAt) && seenAt >= cutoff)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 255),
    ) as ReplayLedger
    if (retained[eventId] !== undefined) return false
    retained[eventId] = timestamp
    await transaction.put('notify-replay-v1', retained)
    return true
  })
}

export async function broadcastCashierRealtimeWake(
  state: DurableObjectStateLike,
  storeObjectName: string,
  event: CashierRealtimeServerNotify,
  nowMs = Date.now(),
): Promise<{ accepted: boolean; broadcastCount: number }> {
  const accepted = await recordEventOnce(state.storage, event.eventId, event.timestamp)
  if (!accepted) return { accepted: false, broadcastCount: 0 }

  const payload = JSON.stringify(toCashierRealtimeWakeMessage(event))
  let broadcastCount = 0
  for (const rawSocket of state.getWebSockets(storeObjectName)) {
    const socket = rawSocket as HibernatableWebSocket
    const attachment = parseConnectionAttachment(socket.deserializeAttachment())
    if (!attachment || attachment.storeObjectName !== storeObjectName) {
      socket.close(1008, 'invalid_scope')
      continue
    }
    if (attachment.expiresAt * 1000 <= nowMs) {
      socket.close(4003, 'ticket_expired')
      continue
    }
    if (socket.readyState !== 1) continue
    socket.send(payload)
    broadcastCount += 1
  }
  return { accepted: true, broadcastCount }
}

export class StoreRealtimeGateway {
  constructor(private readonly state: DurableObjectStateLike) {
    if (state.setWebSocketAutoResponse && typeof WebSocketRequestResponsePair !== 'undefined') {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/websocket') return this.acceptWebSocket(request)
    if (request.method === 'POST' && url.pathname === '/notify') return this.notify(request)
    return json({ error: 'NOT_FOUND' }, 404)
  }

  private async acceptWebSocket(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WEBSOCKET_UPGRADE_REQUIRED' }, 426)
    }
    const encodedAttachment = request.headers.get('x-cashier-realtime-connection')
    const storeObjectName = request.headers.get('x-cashier-realtime-store-object')
    const attachment = encodedAttachment ? parseConnectionAttachment(decodeCashierRealtimeJson(encodedAttachment)) : null
    if (!attachment || !storeObjectName || attachment.storeObjectName !== storeObjectName) {
      return json({ error: 'INVALID_INTERNAL_SCOPE' }, 403)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.serializeAttachment(attachment)
    this.state.acceptWebSocket(server, [storeObjectName])
    return new Response(null, {
      status: 101,
      headers: { 'sec-websocket-protocol': CASHIER_REALTIME_WEBSOCKET_PROTOCOL },
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket })
  }

  private async notify(request: Request): Promise<Response> {
    const storeObjectName = request.headers.get('x-cashier-realtime-store-object')
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return json({ error: 'INVALID_EVENT' }, 400)
    }
    const event = parseCashierRealtimeServerNotify(raw)
    if (!event || !storeObjectName || cashierRealtimeStoreObjectName(event) !== storeObjectName) {
      return json({ error: 'INVALID_EVENT_SCOPE' }, 403)
    }
    const result = await broadcastCashierRealtimeWake(this.state, storeObjectName, event)
    if (!result.accepted) return json({ error: 'REPLAYED_EVENT' }, 409)
    return json({ accepted: true, broadcastCount: result.broadcastCount }, 202)
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') return
    socket.close(1008, 'client_messages_not_allowed')
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason)
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, 'websocket_error')
  }
}

async function handleNotify(request: Request, env: CashierRealtimeGatewayEnv): Promise<Response> {
  if (!dedicatedSecretConfigured(env.CASHIER_REALTIME_NOTIFY_SECRET)) {
    return json({ error: 'GATEWAY_NOT_CONFIGURED' }, 503)
  }
  const rawBody = await request.text()
  if (!rawBody || rawBody.length > 2_048) return json({ error: 'INVALID_EVENT' }, 400)

  const timestamp = request.headers.get('x-cashier-realtime-timestamp')
  const eventId = request.headers.get('x-cashier-realtime-event-id')
  const signature = request.headers.get('x-cashier-realtime-signature')
  const verified = await verifyCashierRealtimeServerNotify({
    timestamp,
    eventId,
    signature,
    rawBody,
    secret: env.CASHIER_REALTIME_NOTIFY_SECRET,
  })
  if (!verified.ok) return json({ error: `NOTIFY_${verified.reason.toUpperCase()}` }, 401)

  let raw: unknown
  try {
    raw = JSON.parse(rawBody) as unknown
  } catch {
    return json({ error: 'INVALID_EVENT' }, 400)
  }
  const event = parseCashierRealtimeServerNotify(raw)
  if (!event || String(event.timestamp) !== timestamp || event.eventId !== eventId) {
    return json({ error: 'INVALID_EVENT' }, 400)
  }

  const storeObjectName = cashierRealtimeStoreObjectName(event)
  const stub = env.STORE_REALTIME_GATEWAY.getByName(storeObjectName)
  return stub.fetch(new Request('https://cashier-realtime.internal/notify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cashier-realtime-store-object': storeObjectName,
    },
    body: JSON.stringify(event),
  }))
}

async function handleConnect(request: Request, env: CashierRealtimeGatewayEnv): Promise<Response> {
  const authorization = await authorizeCashierRealtimeWebSocket(request, env)
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status)

  const attachment: ConnectionAttachment = {
    storeObjectName: authorization.storeObjectName,
    subjectType: authorization.claims.subjectType,
    subjectId: authorization.claims.subjectId,
    ticketId: authorization.claims.jti,
    expiresAt: authorization.claims.exp,
  }
  const stub = env.STORE_REALTIME_GATEWAY.getByName(authorization.storeObjectName)
  return stub.fetch(new Request('https://cashier-realtime.internal/websocket', {
    method: 'GET',
    headers: {
      upgrade: 'websocket',
      'sec-websocket-protocol': CASHIER_REALTIME_WEBSOCKET_PROTOCOL,
      'x-cashier-realtime-store-object': authorization.storeObjectName,
      'x-cashier-realtime-connection': encodeCashierRealtimeJson(attachment),
    },
  }))
}

export const cashierRealtimeGatewayWorker = {
  async fetch(request: Request, env: CashierRealtimeGatewayEnv): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'cashier-realtime-gateway', version: 1 }, 200)
    }
    if ((url.pathname === '/connect' || url.pathname === '/notify') && !gatewaySecretsSeparated(env)) {
      return json({ error: 'GATEWAY_NOT_CONFIGURED' }, 503)
    }
    if (request.method === 'GET' && url.pathname === '/connect') return handleConnect(request, env)
    if (request.method === 'POST' && url.pathname === '/notify') return handleNotify(request, env)
    return json({ error: 'NOT_FOUND' }, 404)
  },
}

export default cashierRealtimeGatewayWorker
