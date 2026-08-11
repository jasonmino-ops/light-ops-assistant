import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { parseStoreRuntimePrinterBindingInput } from '@/lib/store-runtime/contract'
import {
  STORE_RUNTIME_NO_STORE_HEADERS,
  readStoreRuntimeJson,
  storeRuntimeErrorResponse,
} from '@/lib/store-runtime/http'
import {
  getStoreRuntimePrinterBinding,
  upsertStoreRuntimePrinterBinding,
} from '@/lib/store-runtime/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const context = await getContext(req)
  if (!context) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  const binding = await getStoreRuntimePrinterBinding(context.tenantId, context.storeId)
  return NextResponse.json({ binding }, { headers: STORE_RUNTIME_NO_STORE_HEADERS })
}

export async function PUT(req: NextRequest) {
  const context = await getContext(req)
  if (!context) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  try {
    const input = parseStoreRuntimePrinterBindingInput(await readStoreRuntimeJson(req))
    const binding = await upsertStoreRuntimePrinterBinding(context, input)
    return NextResponse.json({ binding }, { headers: STORE_RUNTIME_NO_STORE_HEADERS })
  } catch (error) {
    return storeRuntimeErrorResponse(error)
  }
}
