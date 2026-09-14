import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { ProductImportError } from './jobs'

export const noStoreHeaders = { 'Cache-Control': 'no-store' }

export async function requireProductImportOwner(req: NextRequest) {
  const context = await getContext(req)
  if (!context) throw new ProductImportError('MISSING_CONTEXT', '请重新登录', 401)
  if (context.role !== 'OWNER') throw new ProductImportError('FORBIDDEN', '只有老板可以导入商品', 403)
  return context
}
export function productImportErrorResponse(error: unknown) {
  if (error instanceof ProductImportError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status, headers: noStoreHeaders })
  }
  const message = error instanceof Error ? error.message : 'INTERNAL_ERROR'
  const configuration = message === 'AI_NOT_CONFIGURED' || message.includes('NOT_CONFIGURED')
  return NextResponse.json(
    { error: configuration ? message.split(':')[0] : 'IMPORT_FAILED', message: message.slice(0, 300) },
    { status: configuration ? 503 : 500, headers: noStoreHeaders },
  )
}
