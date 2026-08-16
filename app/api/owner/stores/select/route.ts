import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import {
  findAuthorizedOwnerStore,
  getActiveOwnerStoresByTelegramId,
  getTrustedOwnerTelegramId,
} from '@/lib/owner-store-hub'
import { signSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  let body: { storeId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }
  const storeId = body.storeId?.trim()
  if (!storeId) {
    return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
  }

  const telegramId = await getTrustedOwnerTelegramId(ctx)
  if (!telegramId) {
    return NextResponse.json({ error: 'OWNER_TELEGRAM_IDENTITY_REQUIRED' }, { status: 403 })
  }

  // The submitted id is only a selector. Authorization is re-derived from the
  // trusted Telegram identity and active OWNER memberships on every request.
  const stores = await getActiveOwnerStoresByTelegramId(telegramId)
  const selected = findAuthorizedOwnerStore(stores, storeId)
  if (!selected) {
    return NextResponse.json({ error: 'STORE_OWNER_ACCESS_DENIED' }, { status: 403 })
  }

  const sessionToken = signSession({
    tenantId: selected.tenantId,
    userId: selected.userId,
    storeId: selected.storeId,
    role: 'OWNER',
  })
  const isProd = process.env.NODE_ENV === 'production'
  const res = NextResponse.json({
    ok: true,
    nextPath: '/home',
    store: { id: selected.storeId, name: selected.storeName },
  })
  res.cookies.set('auth-session', sessionToken, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}
