import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertStoreMediaOwner, clearStoreMedia, uploadStoreMedia } from '@/lib/store-media'

type Context = { params: Promise<{ id: string }> }
const headers = { 'Cache-Control': 'no-store' }

async function handle(req: NextRequest, { params }: Context, operation: 'read' | 'upload' | 'clear') {
  try {
    const store = await assertStoreMediaOwner(req, (await params).id)
    if (!store) return NextResponse.json({ error: '无权限' }, { status: 403, headers })
    if (operation === 'read') {
      const media = await prisma.store.findFirst({
        where: { id: store.id, tenantId: store.tenantId },
        select: { electronicMenuMediaUrl: true, bannerUrl: true },
      })
      return media ? NextResponse.json(media, { headers }) : NextResponse.json({ error: '门店不存在' }, { status: 404, headers })
    }
    const response = operation === 'upload'
      ? await uploadStoreMedia(req, store, 'electronic-menu-media')
      : await clearStoreMedia(store, 'electronic-menu-media')
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return NextResponse.json({ error: '素材暂不可用，请稍后重试' }, { status: 503, headers })
  }
}

export async function GET(req: NextRequest, context: Context) { return handle(req, context, 'read') }
export async function POST(req: NextRequest, context: Context) { return handle(req, context, 'upload') }
export async function DELETE(req: NextRequest, context: Context) { return handle(req, context, 'clear') }
