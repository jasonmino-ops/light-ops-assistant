import {
  CASHIER_REALTIME_PROTOCOL_VERSION,
  type CashierRealtimeWakeType,
  signCashierRealtimeServerNotify,
} from './cashier-realtime-protocol'

export type CashierRealtimeNotifyResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: 'disabled' | 'invalid_config' | 'timeout' | 'network' | 'rejected'; status?: number }

type NotifyOptions = {
  enabled?: boolean
  gatewayUrl?: string
  secret?: string
  timeoutMs?: number
  nowMs?: number
  fetchImpl?: typeof fetch
  logger?: Pick<Console, 'warn'>
}

function normalizeNotifyUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
    url.pathname = '/notify'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Failure-isolated wake helper for future business-route integration.
 * It deliberately returns a result instead of throwing and never carries order data.
 */
export async function notifyCashierGateway(
  input: {
    tenantId: string
    storeId: string
    type: CashierRealtimeWakeType
    eventId?: string
  },
  options?: NotifyOptions,
): Promise<CashierRealtimeNotifyResult> {
  const enabled = options?.enabled ?? ['1', 'true'].includes(
    (process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED ?? '').trim().toLowerCase(),
  )
  if (!enabled) return { ok: false, reason: 'disabled' }
  const gatewayUrl = options?.gatewayUrl ?? process.env.CASHIER_REALTIME_GATEWAY_URL?.trim()
  const secret = options?.secret ?? process.env.CASHIER_REALTIME_NOTIFY_SECRET?.trim()
  if (!gatewayUrl || !secret) return { ok: false, reason: 'disabled' }

  const notifyUrl = normalizeNotifyUrl(gatewayUrl)
  if (!notifyUrl) return { ok: false, reason: 'invalid_config' }

  const timestamp = options?.nowMs ?? Date.now()
  const eventId = input.eventId ?? crypto.randomUUID()
  const rawBody = JSON.stringify({
    version: CASHIER_REALTIME_PROTOCOL_VERSION,
    tenantId: input.tenantId,
    storeId: input.storeId,
    type: input.type,
    timestamp,
    eventId,
  })
  const timestampHeader = String(timestamp)
  const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? 1_200, 100), 2_000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const logger = options?.logger ?? console

  try {
    const signature = await signCashierRealtimeServerNotify({
      timestamp: timestampHeader,
      eventId,
      rawBody,
      secret,
    })
    const response = await (options?.fetchImpl ?? fetch)(notifyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cashier-realtime-timestamp': timestampHeader,
        'x-cashier-realtime-event-id': eventId,
        'x-cashier-realtime-signature': signature,
      },
      body: rawBody,
      signal: controller.signal,
    })
    if (!response.ok) {
      logger.warn('[cashier-realtime-notify] notify_rejected', { type: input.type, eventId, status: response.status })
      return { ok: false, reason: 'rejected', status: response.status }
    }
    return { ok: true, eventId }
  } catch (error) {
    const timeout = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
    logger.warn('[cashier-realtime-notify] notify_failed', {
      type: input.type,
      eventId,
      reason: timeout ? 'timeout' : 'network',
    })
    return { ok: false, reason: timeout ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}
