import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const ticketRoute = read('app/api/cashier-realtime/ticket/route.ts')
assert.match(ticketRoute, /allowStoreCodeFallback:\s*false/, 'gateway ticket must reject store-code fallback authorization')
assert.match(ticketRoute, /storeId:\s*store\.id/, 'ticket scope must use the authorized database Store id')
assert.match(ticketRoute, /CASHIER_REALTIME_TICKET_SECRET/, 'ticket must use its dedicated secret')
assert.match(ticketRoute, /!dedicatedSecretConfigured\(secret\)/, 'invalid ticket secret must fail closed')
assert.match(ticketRoute, /!dedicatedSecretConfigured\(notifySecret\)/, 'missing or invalid notify secret must fail closed')
assert.match(ticketRoute, /notifySecret\s*===\s*secret/, 'ticket and server-notify secrets must not be reused')
assert.match(ticketRoute, /!configuredGatewayUrl/, 'missing or invalid gateway URL must fail closed')
assert.doesNotMatch(ticketRoute, /signSession|AUTH_SECRET|SUPABASE_SERVICE_ROLE_KEY/, 'ticket must not reuse session or Supabase privileged secrets')

const worker = read('cloudflare/cashier-realtime-gateway/src/worker.ts')
assert.match(worker, /acceptWebSocket\(/, 'Durable Object must use the hibernation-compatible accept API')
assert.match(worker, /getWebSockets\(/, 'Durable Object must restore/broadcast to hibernating sockets')
assert.match(worker, /setWebSocketAutoResponse/, 'optional ping handling must avoid waking the Durable Object')
assert.doesNotMatch(worker, /setInterval|setTimeout/, 'Gateway must not create a heartbeat or polling loop')
assert.doesNotMatch(worker, /items|price|customer|payment|orderNo/, 'Gateway source must not define order payload fields')

const frozenUnrelatedFiles = [
  'app/api/cashier/orders/route.ts',
  'app/api/cashier/pending-orders/route.ts',
  'app/api/pos/session/update/route.ts',
]
for (const path of frozenUnrelatedFiles) {
  const source = read(path)
  assert.doesNotMatch(source, /cashier-realtime|notifyCashierGateway|createCashierRealtimeClient/,
    `${path} must remain semantically unchanged by Stage 1D scheduling integration`)
}

console.log('cashier realtime gateway isolation/static checks passed')
