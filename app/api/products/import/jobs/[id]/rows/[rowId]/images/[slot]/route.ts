import { NextRequest } from 'next/server'
import { getProductImportImagePreview } from '@/lib/product-bulk-import/jobs'
import { noStoreHeaders, productImportErrorResponse, requireProductImportOwner } from '@/lib/product-bulk-import/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Params = { params: Promise<{ id: string; rowId: string; slot: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const context = await requireProductImportOwner(req)
    const { id, rowId, slot } = await params
    const image = await getProductImportImagePreview(context.tenantId, id, rowId, Number(slot))
    return new Response(new Uint8Array(image.buffer), {
      headers: {
        ...noStoreHeaders,
        'Content-Type': image.contentType,
        'Content-Length': String(image.buffer.length),
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return productImportErrorResponse(error)
  }
}
