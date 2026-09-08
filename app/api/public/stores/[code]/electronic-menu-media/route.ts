import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidMenuCode } from '@/lib/electronic-menu'
import { storeMediaResponse } from '@/lib/store-media'

const headers = { 'Cache-Control': 'no-store' }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!isValidMenuCode(code)) return new NextResponse(null, { status: 400, headers })
  try {
    const store = await prisma.store.findFirst({
      where: { code, status: 'ACTIVE' },
      select: { electronicMenuMediaData: true },
    })
    return storeMediaResponse(store?.electronicMenuMediaData, 'no-store')
  } catch {
    return new NextResponse(null, { status: 503, headers })
  }
}
