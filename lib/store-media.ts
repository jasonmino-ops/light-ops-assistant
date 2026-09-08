import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { storeMediaFileError } from '@/lib/store-media-policy'

type MediaKind = 'banner' | 'electronic-menu-media'
type OwnedStore = { id: string; code: string; tenantId: string }

// Existing banner authorization: an authenticated OWNER manages its tenant's stores.
export async function assertStoreMediaOwner(req: NextRequest, storeId: string): Promise<OwnedStore | null> {
  const ctx = await getContext(req)
  if (!ctx || ctx.role !== 'OWNER') return null
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: ctx.tenantId },
    select: { id: true, code: true },
  })
  return store ? { ...store, tenantId: ctx.tenantId } : null
}

// Shared with the original homepage banner. Keep the File MIME and original
// bytes, including animated GIFs; never crop, flatten or re-encode the image.
export async function uploadStoreMedia(req: NextRequest, store: OwnedStore, kind: MediaKind) {
  let formData: FormData
  try { formData = await req.formData() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 })
  const error = storeMediaFileError(file)
  if (error) return NextResponse.json({ error: error === 'invalidType' ? '仅支持 JPG / PNG / WebP / GIF' : '图片不能超过 2MB' }, { status: 400 })
  const buffer = Buffer.from(await file.arrayBuffer())
  const dataUri = `data:${file.type};base64,${buffer.toString('base64')}`
  // Preserve the banner URL contract. Dedicated content revisions also prevent
  // two replacements in the same millisecond from sharing a stale image URL.
  const version = kind === 'banner' ? Date.now() : createHash('sha256').update(dataUri).digest('hex')
  const url = `/api/public/stores/${store.code}/${kind}?v=${version}`
  const data = kind === 'banner'
    ? { bannerData: dataUri, bannerUrl: url }
    : { electronicMenuMediaData: dataUri, electronicMenuMediaUrl: url }
  await prisma.store.update({ where: { id: store.id, tenantId: store.tenantId }, data })
  return NextResponse.json(kind === 'banner' ? { bannerUrl: url } : { electronicMenuMediaUrl: url })
}

export async function clearStoreMedia(store: OwnedStore, kind: MediaKind) {
  const data = kind === 'banner'
    ? { bannerData: null, bannerUrl: null }
    : { electronicMenuMediaData: null, electronicMenuMediaUrl: null }
  await prisma.store.update({ where: { id: store.id, tenantId: store.tenantId }, data })
  return NextResponse.json({ ok: true })
}

// Shared original banner decoder, including its legacy error statuses.
export function storeMediaResponse(data: string | null | undefined, cacheControl = 'public, max-age=31536000, immutable') {
  const errorHeaders = cacheControl === 'no-store' ? { 'Cache-Control': cacheControl } : undefined
  if (!data) return new NextResponse(null, { status: 404, headers: errorHeaders })
  const match = data.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return new NextResponse(null, { status: 500, headers: errorHeaders })
  const [, mimeType, base64] = match
  return new NextResponse(Buffer.from(base64, 'base64'), {
    status: 200, headers: { 'Content-Type': mimeType, 'Cache-Control': cacheControl },
  })
}
