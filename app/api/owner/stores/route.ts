import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import {
  buildOwnerStoreHub,
  getActiveOwnerStoresByTelegramId,
  getTrustedOwnerTelegramId,
} from '@/lib/owner-store-hub'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const telegramId = await getTrustedOwnerTelegramId(ctx)
  if (!telegramId) {
    return NextResponse.json({ error: 'OWNER_TELEGRAM_IDENTITY_REQUIRED' }, { status: 403 })
  }

  const stores = await getActiveOwnerStoresByTelegramId(telegramId)
  const hub = await buildOwnerStoreHub(stores)
  return NextResponse.json(hub, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
