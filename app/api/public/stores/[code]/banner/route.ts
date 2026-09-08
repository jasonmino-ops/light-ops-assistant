import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { storeMediaResponse } from '@/lib/store-media'

// GET /api/public/stores/[code]/banner — 返回头图二进制
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const store = await prisma.store.findUnique({
    where: { code },
    select: { bannerData: true },
  })

  return storeMediaResponse(store?.bannerData)
}
