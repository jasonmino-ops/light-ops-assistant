/**
 * POST   /api/products/[id]/image  — 上传/替换商品主图（OWNER）
 * DELETE /api/products/[id]/image  — 删除商品主图（OWNER）
 *
 * 存储：Supabase Storage public bucket `product-images`
 * 路径：tenants/{tenantId}/products/{productId}/main-{timestamp}.{ext}
 *      （Product 是 tenant 级共享资源，故按 tenantId 而非 storeId 组织）
 *
 * 单图、≤2MB、JPG/PNG/WebP；替换时旧文件尽量异步删除，失败不阻断。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import {
  uploadObject,
  deleteObject,
  isStorageConfigured,
  StorageNotConfiguredError,
} from '@/lib/supabase-storage'

const BUCKET = 'product-images'
const MAX_SIZE = 3 * 1024 * 1024 // 3MB（前端已压缩，保留余量）
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function extFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'bin'
}

async function assertOwnerProduct(req: NextRequest, productId: string) {
  const ctx = await getContext(req)
  if (!ctx) return { error: NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 }) }
  if (ctx.role !== 'OWNER') {
    return { error: NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以修改商品图片' }, { status: 403 }) }
  }
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: { id: true, tenantId: true, imageStorageKey: true },
  })
  if (!product) {
    return { error: NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 }) }
  }
  return { ctx, product }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: 'STORAGE_NOT_CONFIGURED', message: '后端未配置 Storage（请设置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）' },
      { status: 500 },
    )
  }

  const { id } = await params
  const guard = await assertOwnerProduct(req, id)
  if ('error' in guard) return guard.error
  const { product } = guard

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '请上传图片文件' }, { status: 400 })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'NO_FILE', message: '未收到文件' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'INVALID_TYPE', message: '仅支持 JPG / PNG / WebP' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '图片压缩后仍超过 3MB，请换一张图片' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const ts = Date.now()
  const ext = extFromMime(file.type)
  const newKey = `tenants/${product.tenantId}/products/${product.id}/main-${ts}.${ext}`

  let publicUrl: string
  try {
    publicUrl = await uploadObject(BUCKET, newKey, buf, file.type)
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: 'STORAGE_NOT_CONFIGURED' }, { status: 500 })
    }
    const msg = e instanceof Error ? e.message : 'UPLOAD_FAILED'
    return NextResponse.json({ error: 'UPLOAD_FAILED', message: '上传失败：' + msg.slice(0, 200) }, { status: 502 })
  }

  // 写库
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      imageUrl: publicUrl,
      imageStorageKey: newKey,
      imageUpdatedAt: new Date(ts),
    },
    select: { id: true, imageUrl: true, imageStorageKey: true, imageUpdatedAt: true },
  })

  // 异步删除旧文件（不阻断响应）
  if (product.imageStorageKey && product.imageStorageKey !== newKey) {
    deleteObject(BUCKET, product.imageStorageKey).catch((err) => {
      console.warn('[product-image] old object delete failed', product.imageStorageKey, err)
    })
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guard = await assertOwnerProduct(req, id)
  if ('error' in guard) return guard.error
  const { product } = guard

  if (product.imageStorageKey) {
    // 不阻断：删除失败也清空 DB 字段，留下孤立对象由后续运维清理
    const ok = await deleteObject(BUCKET, product.imageStorageKey)
    if (!ok) {
      console.warn('[product-image] storage delete failed', product.imageStorageKey)
    }
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { imageUrl: null, imageStorageKey: null, imageUpdatedAt: null },
  })

  return NextResponse.json({ ok: true })
}
