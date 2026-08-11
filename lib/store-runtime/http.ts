import { NextRequest, NextResponse } from 'next/server'
import { StoreRuntimeContractError } from './contract'
import { StoreRuntimeServiceError } from './service'

export const STORE_RUNTIME_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
}

export async function readStoreRuntimeJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_JSON')
  }
}

export function storeRuntimeErrorResponse(error: unknown) {
  if (error instanceof StoreRuntimeContractError) {
    return NextResponse.json({ error: error.code }, { status: 400, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  }
  if (error instanceof StoreRuntimeServiceError) {
    return NextResponse.json({ error: error.code }, { status: error.status, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  }
  console.error('[store-runtime] request failed', {
    error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
  })
  return NextResponse.json(
    { error: 'STORE_RUNTIME_UNAVAILABLE' },
    { status: 503, headers: STORE_RUNTIME_NO_STORE_HEADERS },
  )
}
