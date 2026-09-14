import { NextRequest, NextResponse } from 'next/server'
import { createProductImportJob, listProductImportJobs } from '@/lib/product-bulk-import/jobs'
import { noStoreHeaders, productImportErrorResponse, requireProductImportOwner } from '@/lib/product-bulk-import/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const context = await requireProductImportOwner(req)
    return NextResponse.json({ jobs: await listProductImportJobs(context.tenantId) }, { headers: noStoreHeaders })
  } catch (error) {
    return productImportErrorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await requireProductImportOwner(req)
    const body = await req.json() as { fileName?: unknown; mimeType?: unknown; fileSize?: unknown }
    if (typeof body.fileName !== 'string' || typeof body.mimeType !== 'string' || typeof body.fileSize !== 'number') {
      return NextResponse.json({ error: 'INVALID_FILE_METADATA' }, { status: 400, headers: noStoreHeaders })
    }
    const result = await createProductImportJob(context.tenantId, {
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
    })
    return NextResponse.json(result, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return productImportErrorResponse(error)
  }
}
