import { NextRequest, NextResponse } from 'next/server'
import {
  cancelProductImportJob,
  getProductImportJob,
  patchProductImportRow,
  type ProductImportRowPatch,
} from '@/lib/product-bulk-import/jobs'
import { noStoreHeaders, productImportErrorResponse, requireProductImportOwner } from '@/lib/product-bulk-import/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const context = await requireProductImportOwner(req)
    const { id } = await params
    const cursor = Number(req.nextUrl.searchParams.get('cursor') ?? 0)
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? 100)
    return NextResponse.json(await getProductImportJob(context.tenantId, id, { cursor, limit }), { headers: noStoreHeaders })
  } catch (error) {
    return productImportErrorResponse(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const context = await requireProductImportOwner(req)
    const { id } = await params
    const body = await req.json() as { rowId?: unknown; patch?: unknown }
    if (typeof body.rowId !== 'string' || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      return NextResponse.json({ error: 'INVALID_ROW_PATCH' }, { status: 400, headers: noStoreHeaders })
    }
    const row = await patchProductImportRow(context.tenantId, id, body.rowId, body.patch as ProductImportRowPatch)
    return NextResponse.json({ row }, { headers: noStoreHeaders })
  } catch (error) {
    return productImportErrorResponse(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const context = await requireProductImportOwner(req)
    const { id } = await params
    return NextResponse.json(await cancelProductImportJob(context.tenantId, id), { headers: noStoreHeaders })
  } catch (error) {
    return productImportErrorResponse(error)
  }
}
