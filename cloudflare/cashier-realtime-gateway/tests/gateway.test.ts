import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CASHIER_REALTIME_PROTOCOL_VERSION,
  CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX,
  CASHIER_REALTIME_WEBSOCKET_PROTOCOL,
  buildCashierRealtimeTicketClaims,
  cashierRealtimeHmacBase64Url,
  cashierRealtimeStoreObjectName,
  decodeCashierRealtimeJson,
  encodeCashierRealtimeJson,
  signCashierRealtimeServerNotify,
  signCashierRealtimeTicket,
  verifyCashierRealtimeServerNotify,
  verifyCashierRealtimeTicket,
  type CashierRealtimeServerNotify,
} from '../../../lib/cashier-realtime-protocol'
import {
  createCashierRealtimeClient,
  createCashierRealtimeWakeCoalescer,
} from '../../../lib/cashier-realtime-client'
import { notifyCashierGateway } from '../../../lib/cashier-realtime-notify'
import {
  StoreRealtimeGateway,
  authorizeCashierRealtimeWebSocket,
  broadcastCashierRealtimeWake,
  cashierRealtimeGatewayWorker,
  type CashierRealtimeGatewayEnv,
  type DurableObjectStateLike,
} from '../src/worker'

const ticketSecret = 'ticket-secret-is-independent-and-at-least-32-bytes-long'
const notifySecret = 'notify-secret-is-different-and-at-least-32-bytes-long'
const nowMs = 1_800_000_000_000

class FakeSocket {
  readyState = 1
  sent: string[] = []
  closed: { code: number; reason: string } | null = null
  private attachment: unknown = null

  serializeAttachment(value: unknown) { this.attachment = value }
  deserializeAttachment() { return this.attachment }
  send(value: string) { this.sent.push(value) }
  close(code: number, reason: string) {
    this.readyState = 3
    this.closed = { code, reason }
  }
}

class FakeState implements DurableObjectStateLike {
  private values = new Map<string, unknown>()
  private sockets = new Map<WebSocket, Set<string>>()
  autoResponseConfigured = false

  storage = {
    get: async <T>(key: string) => this.values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => { this.values.set(key, value) },
    transaction: async <T>(callback: (transaction: {
      get<U>(key: string): Promise<U | undefined>
      put<U>(key: string, value: U): Promise<void>
    }) => Promise<T>) => callback({
      get: async <U>(key: string) => this.values.get(key) as U | undefined,
      put: async <U>(key: string, value: U) => { this.values.set(key, value) },
    }),
  }

  acceptWebSocket(socket: WebSocket, tags: string[] = []) {
    this.sockets.set(socket, new Set(tags))
  }

  getWebSockets(tag?: string) {
    return [...this.sockets.entries()]
      .filter(([, tags]) => !tag || tags.has(tag))
      .map(([socket]) => socket)
  }

  setWebSocketAutoResponse() { this.autoResponseConfigured = true }
}

function registerSocket(state: FakeState, storeObjectName: string, subjectId: string): FakeSocket {
  const socket = new FakeSocket()
  socket.serializeAttachment({
    storeObjectName,
    subjectType: 'user',
    subjectId,
    ticketId: `ticket-${subjectId}`,
    expiresAt: Math.floor(nowMs / 1000) + 300,
  })
  state.acceptWebSocket(socket as unknown as WebSocket, [storeObjectName])
  return socket
}

function event(input: Partial<CashierRealtimeServerNotify> = {}): CashierRealtimeServerNotify {
  return {
    version: CASHIER_REALTIME_PROTOCOL_VERSION,
    tenantId: 'tenant-a',
    storeId: 'store-a',
    type: 'orders_changed',
    timestamp: nowMs,
    eventId: 'event-a',
    ...input,
  }
}

function connectionRequest(token: string, url = 'https://gateway.example/connect'): Request {
  return new Request(url, {
    headers: {
      origin: 'https://elifekh.com',
      upgrade: 'websocket',
      'sec-websocket-protocol': `${CASHIER_REALTIME_WEBSOCKET_PROTOCOL}, ${CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX}${token}`,
    },
  })
}

async function signedNotifyRequest(payload: CashierRealtimeServerNotify, secret = notifySecret): Promise<Request> {
  const rawBody = JSON.stringify(payload)
  const timestamp = String(payload.timestamp)
  const signature = await signCashierRealtimeServerNotify({
    timestamp,
    eventId: payload.eventId,
    rawBody,
    secret,
  })
  return new Request('https://gateway.example/notify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cashier-realtime-timestamp': timestamp,
      'x-cashier-realtime-event-id': payload.eventId,
      'x-cashier-realtime-signature': signature,
    },
    body: rawBody,
  })
}

async function main() {
  const claims = buildCashierRealtimeTicketClaims({
    tenantId: 'tenant-a',
    storeId: 'store-a',
    storeCode: 'STORE-A',
    subjectType: 'user',
    subjectId: 'user-a',
    role: 'OWNER',
    source: 'ACCOUNT',
    jti: 'ticket-a',
    nowMs,
  })
  const validTicket = await signCashierRealtimeTicket(claims, ticketSecret)

  // 1. valid ticket accepted
  const valid = await verifyCashierRealtimeTicket(validTicket, ticketSecret, { nowMs })
  assert.equal(valid.ok, true)

  // 2. expired rejected
  const expired = await verifyCashierRealtimeTicket(validTicket, ticketSecret, { nowMs: nowMs + 301_000 })
  assert.deepEqual(expired, { ok: false, reason: 'expired' })

  // 3. wrong purpose rejected, even with a valid signature
  const [header, payload] = validTicket.split('.')
  const wrongPurposeClaims = { ...(decodeCashierRealtimeJson(payload) as Record<string, unknown>), purpose: 'other-purpose' }
  const wrongPurposePayload = encodeCashierRealtimeJson(wrongPurposeClaims)
  const wrongPurposeUnsigned = `${header}.${wrongPurposePayload}`
  const wrongPurposeTicket = `${wrongPurposeUnsigned}.${await cashierRealtimeHmacBase64Url(wrongPurposeUnsigned, ticketSecret)}`
  assert.deepEqual(
    await verifyCashierRealtimeTicket(wrongPurposeTicket, ticketSecret, { nowMs }),
    { ok: false, reason: 'wrong_purpose' },
  )

  // 4. tampered signature rejected
  const tampered = `${validTicket.slice(0, -1)}${validTicket.endsWith('a') ? 'b' : 'a'}`
  assert.deepEqual(
    await verifyCashierRealtimeTicket(tampered, ticketSecret, { nowMs }),
    { ok: false, reason: 'invalid_signature' },
  )

  // 5. a URL store selector cannot switch the Durable Object
  const authorized = await authorizeCashierRealtimeWebSocket(
    connectionRequest(validTicket, 'https://gateway.example/connect?storeId=store-b'),
    { CASHIER_REALTIME_TICKET_SECRET: ticketSecret, CASHIER_REALTIME_ALLOWED_ORIGINS: 'https://elifekh.com' },
    nowMs,
  )
  assert.equal(authorized.ok, true)
  assert.equal(authorized.ok && authorized.storeObjectName, 'v1:tenant-a:store-a')

  // 6. cross-store verification rejects a Store A ticket for Store B
  assert.deepEqual(
    await verifyCashierRealtimeTicket(validTicket, ticketSecret, { nowMs, expectedStoreId: 'store-b' }),
    { ok: false, reason: 'wrong_store' },
  )

  const rawNotify = JSON.stringify(event())
  const validNotifySignature = await signCashierRealtimeServerNotify({
    timestamp: String(nowMs), eventId: 'event-a', rawBody: rawNotify, secret: notifySecret,
  })

  // 7. valid server notify authentication accepted
  assert.deepEqual(await verifyCashierRealtimeServerNotify({
    timestamp: String(nowMs), eventId: 'event-a', signature: validNotifySignature,
    rawBody: rawNotify, secret: notifySecret, nowMs,
  }), { ok: true })

  // 8. missing signature rejected
  assert.deepEqual(await verifyCashierRealtimeServerNotify({
    timestamp: String(nowMs), eventId: 'event-a', signature: null,
    rawBody: rawNotify, secret: notifySecret, nowMs,
  }), { ok: false, reason: 'missing' })

  // 9. invalid signature rejected
  assert.deepEqual(await verifyCashierRealtimeServerNotify({
    timestamp: String(nowMs), eventId: 'event-a', signature: 'v1=invalid',
    rawBody: rawNotify, secret: notifySecret, nowMs,
  }), { ok: false, reason: 'invalid_signature' })

  // 10. stale request rejected; replay is rejected by the Store DO below
  assert.deepEqual(await verifyCashierRealtimeServerNotify({
    timestamp: String(nowMs - 60_001), eventId: 'event-a', signature: validNotifySignature,
    rawBody: rawNotify, secret: notifySecret, nowMs,
  }), { ok: false, reason: 'expired' })

  const storeAName = cashierRealtimeStoreObjectName({ tenantId: 'tenant-a', storeId: 'store-a' })
  const storeBName = cashierRealtimeStoreObjectName({ tenantId: 'tenant-a', storeId: 'store-b' })
  const stateA = new FakeState()
  const stateB = new FakeState()
  const clientA1 = registerSocket(stateA, storeAName, 'user-a1')
  const clientA2 = registerSocket(stateA, storeAName, 'user-a2')
  const clientB = registerSocket(stateB, storeBName, 'user-b')

  // 11. same store supports multiple clients
  const firstBroadcast = await broadcastCashierRealtimeWake(stateA, storeAName, event(), nowMs)
  assert.deepEqual(firstBroadcast, { accepted: true, broadcastCount: 2 })
  assert.equal(clientA1.sent.length, 1)
  assert.equal(clientA2.sent.length, 1)

  // 12. different Store DOs remain isolated
  assert.equal(clientB.sent.length, 0)

  // 13. targeted wake preserves the event type
  assert.equal(JSON.parse(clientA1.sent[0]).type, 'orders_changed')
  const pendingEvent = event({ type: 'pending_orders_changed', eventId: 'event-pending' })
  await broadcastCashierRealtimeWake(stateA, storeAName, pendingEvent, nowMs)
  assert.equal(JSON.parse(clientA1.sent[1]).type, 'pending_orders_changed')

  // 14. WebSocket payload is wake-only and cannot carry order fields
  assert.deepEqual(Object.keys(JSON.parse(clientA1.sent[0])).sort(), ['eventId', 'timestamp', 'type', 'version'])

  // 15. duplicate event is safe and does not broadcast twice
  assert.deepEqual(
    await broadcastCashierRealtimeWake(stateA, storeAName, event(), nowMs),
    { accepted: false, broadcastCount: 0 },
  )
  assert.equal(clientA1.sent.length, 2)

  // Exercise the signed public notify endpoint and Store DO replay response.
  const liveNow = Date.now()
  const liveEvent = event({ timestamp: liveNow, eventId: 'event-live' })
  const doByName = new Map<string, StoreRealtimeGateway>([
    [storeAName, new StoreRealtimeGateway(stateA)],
    [storeBName, new StoreRealtimeGateway(stateB)],
  ])
  const env: CashierRealtimeGatewayEnv = {
    CASHIER_REALTIME_TICKET_SECRET: ticketSecret,
    CASHIER_REALTIME_NOTIFY_SECRET: notifySecret,
    CASHIER_REALTIME_ALLOWED_ORIGINS: 'https://elifekh.com',
    STORE_REALTIME_GATEWAY: {
      getByName(name) {
        const durableObject = doByName.get(name)
        if (!durableObject) throw new Error(`unexpected Store DO: ${name}`)
        return { fetch: (request) => durableObject.fetch(request) }
      },
    },
  }
  const gatewayNotify = await cashierRealtimeGatewayWorker.fetch(await signedNotifyRequest(liveEvent), env)
  assert.equal(gatewayNotify.status, 202)
  const replayNotify = await cashierRealtimeGatewayWorker.fetch(await signedNotifyRequest(liveEvent), env)
  assert.equal(replayNotify.status, 409)
  const anonymousNotify = await cashierRealtimeGatewayWorker.fetch(new Request('https://gateway.example/notify', {
    method: 'POST', body: JSON.stringify(liveEvent), headers: { 'content-type': 'application/json' },
  }), env)
  assert.equal(anonymousNotify.status, 401, 'browser/anonymous caller must not have notify authority')

  // Reject signed payloads that attempt to smuggle order/customer fields.
  const forbiddenBody = JSON.stringify({ ...liveEvent, order: { customerName: 'forbidden' } })
  const forbiddenSignature = await signCashierRealtimeServerNotify({
    timestamp: String(liveNow), eventId: liveEvent.eventId, rawBody: forbiddenBody, secret: notifySecret,
  })
  const forbiddenResponse = await cashierRealtimeGatewayWorker.fetch(new Request('https://gateway.example/notify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cashier-realtime-timestamp': String(liveNow),
      'x-cashier-realtime-event-id': liveEvent.eventId,
      'x-cashier-realtime-signature': forbiddenSignature,
    },
    body: forbiddenBody,
  }), env)
  assert.equal(forbiddenResponse.status, 400)

  // Targeted client coalescing keeps one pull signal per type.
  const coalesced: string[] = []
  const coalescer = createCashierRealtimeWakeCoalescer({ onWake: (type) => coalesced.push(type), delayMs: 250 })
  coalescer.push({ version: 1, type: 'orders_changed', timestamp: nowMs, eventId: 'one' })
  coalescer.push({ version: 1, type: 'orders_changed', timestamp: nowMs + 1, eventId: 'two' })
  coalescer.push({ version: 1, type: 'pending_orders_changed', timestamp: nowMs + 2, eventId: 'three' })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 280))
  assert.deepEqual(coalesced.sort(), ['orders_changed', 'pending_orders_changed'])
  coalescer.clear()

  // Standalone browser helper keeps the bearer ticket out of the WebSocket URL.
  let browserSocketUrl = ''
  let browserSocketProtocols: string[] = []
  const browserSocket = new FakeSocket() as FakeSocket & {
    onopen: (() => void) | null
    onmessage: ((event: { data: string }) => void) | null
    onerror: (() => void) | null
    onclose: (() => void) | null
  }
  browserSocket.onopen = null
  browserSocket.onmessage = null
  browserSocket.onerror = null
  browserSocket.onclose = null
  const connectionStatuses: string[] = []
  const standaloneClient = createCashierRealtimeClient({
    getTicket: async () => ({
      ticket: validTicket,
      gatewayUrl: 'https://gateway.example',
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      storeCode: 'STORE-A',
    }),
    onWake() {},
    onStatus: (status) => connectionStatuses.push(status),
    webSocketFactory: (url, protocols) => {
      browserSocketUrl = url
      browserSocketProtocols = protocols
      return browserSocket as unknown as WebSocket
    },
  })
  standaloneClient.start()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
  assert.equal(browserSocketUrl, 'wss://gateway.example/connect')
  assert.equal(browserSocketUrl.includes(validTicket), false)
  assert.equal(browserSocketProtocols[1], `${CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX}${validTicket}`)
  const openHandler = browserSocket.onopen as (() => void) | null
  assert.ok(openHandler)
  openHandler()
  assert.equal(connectionStatuses.at(-1), 'healthy')
  standaloneClient.stop()
  assert.equal(connectionStatuses.at(-1), 'stopped')

  // The future server helper emits a correctly signed, wake-only request.
  let helperRequest: { url: string; init?: RequestInit } | null = null
  const helperNotify = await notifyCashierGateway({
    tenantId: 'tenant-a', storeId: 'store-a', type: 'pending_orders_changed', eventId: 'helper-event',
  }, {
    gatewayUrl: 'https://gateway.example',
    secret: notifySecret,
    fetchImpl: async (url, init) => {
      helperRequest = { url: String(url), init }
      return new Response(null, { status: 202 })
    },
    logger: { warn() {} },
    nowMs,
  })
  assert.deepEqual(helperNotify, { ok: true, eventId: 'helper-event' })
  const capturedRequest = helperRequest as { url: string; init?: RequestInit } | null
  assert.ok(capturedRequest)
  assert.equal(capturedRequest.url, 'https://gateway.example/notify')
  const helperBody = String(capturedRequest.init?.body)
  assert.deepEqual(Object.keys(JSON.parse(helperBody)).sort(), [
    'eventId', 'storeId', 'tenantId', 'timestamp', 'type', 'version',
  ])
  assert.deepEqual(await verifyCashierRealtimeServerNotify({
    timestamp: String(nowMs),
    eventId: 'helper-event',
    signature: new Headers(capturedRequest.init?.headers).get('x-cashier-realtime-signature'),
    rawBody: helperBody,
    secret: notifySecret,
    nowMs,
  }), { ok: true })

  // 16-17. gateway/network failure is returned, never thrown into future business semantics.
  const failedNotify = await notifyCashierGateway({
    tenantId: 'tenant-a', storeId: 'store-a', type: 'orders_changed', eventId: 'failure-event',
  }, {
    gatewayUrl: 'https://gateway.example',
    secret: notifySecret,
    fetchImpl: async () => { throw new Error('gateway unavailable') },
    logger: { warn() {} },
    timeoutMs: 100,
    nowMs,
  })
  assert.deepEqual(failedNotify, { ok: false, reason: 'network' })

  // 18-19. Worker has no E-Shop DB/Supabase dependency and no privileged secret reaches the client helper.
  const root = process.cwd()
  const workerSource = readFileSync(resolve(root, 'cloudflare/cashier-realtime-gateway/src/worker.ts'), 'utf8')
  const clientSource = readFileSync(resolve(root, 'lib/cashier-realtime-client.ts'), 'utf8')
  assert.doesNotMatch(workerSource, /prisma|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i)
  assert.doesNotMatch(clientSource, /AUTH_SECRET|NOTIFY_SECRET|SERVICE_ROLE/i)

  console.log('cashier realtime gateway targeted checks passed (19 security/isolation cases)')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
