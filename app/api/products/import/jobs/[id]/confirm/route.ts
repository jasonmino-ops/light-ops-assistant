import { NextRequest, NextResponse } from 'next/server'
import { confirmProductImportJob } from '@/lib/product-bulk-import/confirm'
import { noStoreHeaders, productImportErrorResponse, requireProductImportOwner } from '@/lib/product-bulk-import/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireProductImportOwner(req)
    const { id } = await params
    return NextResponse.json(await confirmProductImportJob(context.tenantId, id), { headers: noStoreHeaders })
  } catch (error) {
    return productImportErrorResponse(error)
  }
}
