import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosRequest } from '@/lib/desktop-pos-auth'
import {
  buildCashierRealtimeTicketClaims,
  CASHIER_REALTIME_TICKET_TTL_SECONDS,
  signCashierRealtimeTicket,
} from '@/lib/cashier-realtime-protocol'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function gatewayUrl(): string | null {
  const configured = process.env.CASHIER_REALTIME_GATEWAY_URL?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/u, '')
  } catch {
    return null
  }
}

function cashierRealtimeEnabled(): boolean {
  return ['1', 'true'].includes(
    (process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED ?? '').trim().toLowerCase(),
  )
}

function dedicatedSecretConfigured(value: string | undefined): value is string {
  return Boolean(value && value.length >= 32)
}

export async function POST(req: NextRequest) {
  if (!cashierRealtimeEnabled()) {
    return json({ error: 'CASHIER_REALTIME_DISABLED' }, 503)
  }
  let body: { storeCode?: unknown }
  try {
    body = await req.json() as { storeCode?: unknown }
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }

  const storeCode = typeof body.storeCode === 'string' ? body.storeCode.trim() : ''
  if (!storeCode) return json({ error: 'MISSING_STORE_CODE' }, 400)

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, tenantId: true, code: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') return json({ error: 'STORE_NOT_FOUND' }, 404)

  const authorization = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }, { allowStoreCodeFallback: false })
  if (!authorization || authorization.source === 'STORE_CODE') {
    return json({ error: 'CASHIER_REALTIME_UNAUTHORIZED' }, 403)
  }

  const secret = process.env.CASHIER_REALTIME_TICKET_SECRET?.trim()
  const notifySecret = process.env.CASHIER_REALTIME_NOTIFY_SECRET?.trim()
  const configuredGatewayUrl = gatewayUrl()
  if (
    !dedicatedSecretConfigured(secret) ||
    !dedicatedSecretConfigured(notifySecret) ||
    notifySecret === secret ||
    !configuredGatewayUrl
  ) {
    return json({ error: 'CASHIER_REALTIME_NOT_CONFIGURED' }, 503)
  }

  const subjectType = authorization.source === 'DEVICE' ? 'device' : 'user'
  const subjectId = subjectType === 'device'
    ? req.headers.get('x-pos-device-id')?.trim()
    : authorization.operatorUserId
  if (!subjectId) return json({ error: 'CASHIER_REALTIME_UNAUTHORIZED' }, 403)

  try {
    const claims = buildCashierRealtimeTicketClaims({
      tenantId: store.tenantId,
      storeId: store.id,
      storeCode: store.code,
      subjectType,
      subjectId,
      role: authorization.role,
      source: authorization.source,
      jti: crypto.randomUUID(),
      ttlSeconds: CASHIER_REALTIME_TICKET_TTL_SECONDS,
    })
    const ticket = await signCashierRealtimeTicket(claims, secret)
    return json({
      ticket,
      gatewayUrl: configuredGatewayUrl,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      storeCode: claims.storeCode,
    })
  } catch (error) {
    console.error('[cashier-realtime-ticket] ticket_issue_failed', {
      reason: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return json({ error: 'CASHIER_REALTIME_NOT_CONFIGURED' }, 503)
  }
}
