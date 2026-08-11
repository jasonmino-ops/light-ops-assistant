import { NextRequest, NextResponse } from 'next/server'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { STORE_RUNTIME_NO_STORE_HEADERS, storeRuntimeErrorResponse } from '@/lib/store-runtime/http'
import { claimStoreRuntimePrintTask } from '@/lib/store-runtime/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await getDesktopDeviceContext(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  }
  try {
    const result = await claimStoreRuntimePrintTask(auth.context)
    return NextResponse.json(result, { headers: STORE_RUNTIME_NO_STORE_HEADERS })
  } catch (error) {
    return storeRuntimeErrorResponse(error)
  }
}
