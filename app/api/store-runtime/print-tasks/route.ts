import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { parseStoreRuntimePrintTaskCreateInput } from '@/lib/store-runtime/contract'
import {
  STORE_RUNTIME_NO_STORE_HEADERS,
  readStoreRuntimeJson,
  storeRuntimeErrorResponse,
} from '@/lib/store-runtime/http'
import { createStoreRuntimePrintTask } from '@/lib/store-runtime/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Candidate ingress endpoint only. Existing Browser POS actions are intentionally not integrated in V1 Candidate.
export async function POST(req: NextRequest) {
  const context = await getContext(req)
  if (!context) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  try {
    const input = parseStoreRuntimePrintTaskCreateInput(await readStoreRuntimeJson(req))
    const result = await createStoreRuntimePrintTask(context, input)
    return NextResponse.json(result, {
      status: result.created ? 201 : 200,
      headers: STORE_RUNTIME_NO_STORE_HEADERS,
    })
  } catch (error) {
    return storeRuntimeErrorResponse(error)
  }
}
