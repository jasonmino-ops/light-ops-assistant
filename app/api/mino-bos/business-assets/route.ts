import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { getReadOnlyBusinessAssets } from '@/lib/mino-bos/business-assets/read-only-adapter'

/**
 * GET /api/mino-bos/business-assets[?storeId=<storeId>]
 *
 * Minimal read-only Business Asset Adapter for Mino BOS integration.
 * This route only reads scoped business data and aggregate stats.
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const result = await getReadOnlyBusinessAssets({
    ctx,
    requestedStoreId: req.nextUrl.searchParams.get('storeId'),
  })

  return NextResponse.json(result.body, { status: result.statusCode })
}
