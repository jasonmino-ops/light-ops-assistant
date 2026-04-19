import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

  if (!store?.bannerData) {
    return new NextResponse(null, { status: 404 })
  }

  // bannerData 格式: data:<mime>;base64,<data>
  const match = store.bannerData.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    return new NextResponse(null, { status: 500 })
  }

  const [, mimeType, base64] = match
  const buffer = Buffer.from(base64, 'base64')

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
