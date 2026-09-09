import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '../context'
import { getActiveOwnerStoresByTelegramId, getTrustedOwnerTelegramId, type OwnerStoreAccess } from '../owner-store-hub'
import { ReportError } from './contract'

export const noStore = { 'Cache-Control': 'private, no-store' }
export function errorResponse(error: unknown) {
  const known = error instanceof ReportError
  if (!known) console.error('[product-sales] request failed')
  return NextResponse.json({ error: known ? error.code : 'INTERNAL_ERROR' }, { status: known ? error.status : 500, headers: noStore })
}
export async function readBody(req: NextRequest): Promise<unknown> {
  try { return await req.json() } catch { throw new ReportError('INVALID_JSON') }
}
export async function ownerRequest(req: NextRequest, action: (ownerTelegramId: string, stores: OwnerStoreAccess[]) => Promise<unknown>) {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.get('origin')
      if (origin && origin !== new URL(req.url).origin) throw new ReportError('FORBIDDEN', 403)
    }
    const ctx = await getContext(req)
    if (!ctx) throw new ReportError('MISSING_CONTEXT', 401)
    if (ctx.role !== 'OWNER') throw new ReportError('FORBIDDEN', 403)
    const ownerTelegramId = await getTrustedOwnerTelegramId(ctx)
    if (!ownerTelegramId) throw new ReportError('OWNER_TELEGRAM_IDENTITY_REQUIRED', 403)
    const stores = await getActiveOwnerStoresByTelegramId(ownerTelegramId)
    if (!stores.length) throw new ReportError('STORE_ACCESS_DENIED', 403)
    return NextResponse.json(await action(ownerTelegramId, stores), { headers: noStore })
  } catch (error) { return errorResponse(error) }
}
