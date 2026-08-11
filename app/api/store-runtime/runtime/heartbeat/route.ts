import { NextRequest, NextResponse } from 'next/server'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { STORE_RUNTIME_NO_STORE_HEADERS } from '@/lib/store-runtime/http'
import { getStoreRuntimePrinterBinding } from '@/lib/store-runtime/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  }
  const binding = await getStoreRuntimePrinterBinding(auth.context.tenantId, auth.context.storeId)
  return NextResponse.json({ ok: true, binding }, { headers: STORE_RUNTIME_NO_STORE_HEADERS })
}
