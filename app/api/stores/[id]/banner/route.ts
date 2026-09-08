import { NextRequest, NextResponse } from 'next/server'
import { assertStoreMediaOwner, clearStoreMedia, uploadStoreMedia } from '@/lib/store-media'

type Context = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Context) {
  const store = await assertStoreMediaOwner(req, (await params).id)
  if (!store) return NextResponse.json({ error: '无权限' }, { status: 403 })
  return uploadStoreMedia(req, store, 'banner')
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const store = await assertStoreMediaOwner(req, (await params).id)
  if (!store) return NextResponse.json({ error: '无权限' }, { status: 403 })
  return clearStoreMedia(store, 'banner')
}
