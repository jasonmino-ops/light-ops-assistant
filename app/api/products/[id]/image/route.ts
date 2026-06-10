/**
 * POST   /api/products/[id]/image[?slot=0|1|2]  — 上传/替换商品图（OWNER）
 * DELETE /api/products/[id]/image[?slot=0|1|2]  — 删除商品图（OWNER）
 *
 * 存储：Supabase Storage public bucket `product-images`
 * 路径：tenants/{tenantId}/products/{productId}/image-{slot}-{timestamp}.{ext}
 *      （Product 是 tenant 级共享资源，故按 tenantId 而非 storeId 组织）
 *
 * 最多 3 图、≤3MB、JPG/PNG/WebP；第一张同步到 Product.imageUrl。
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
const MAX_IMAGES = 3

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
    select: { id: true, tenantId: true, imageUrl: true, imageStorageKey: true, imageUrls: true, imageStorageKeys: true },
  })
  if (!product) {
    return { error: NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 }) }
  }
  return { ctx, product }
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  } catch {
    return []
  }
}

function compactPairs(urls: string[], keys: string[]): { urls: string[]; keys: string[] } {
  const nextUrls: string[] = []
  const nextKeys: string[] = []
  urls.slice(0, MAX_IMAGES).forEach((url, index) => {
    if (!url) return
    nextUrls.push(url)
    nextKeys.push(keys[index] ?? '')
  })
  return { urls: nextUrls, keys: nextKeys }
}

function productImageState(product: {
  imageUrl: string | null
  imageStorageKey: string | null
  imageUrls: string | null
  imageStorageKeys: string | null
}) {
  const urls = parseJsonArray(product.imageUrls)
  const keys = parseJsonArray(product.imageStorageKeys)
  if (urls.length === 0 && product.imageUrl) {
    urls.push(product.imageUrl)
    keys.push(product.imageStorageKey ?? '')
  }
  return compactPairs(urls, keys)
}

function slotFromReq(req: NextRequest, currentLen: number): number {
  const raw = req.nextUrl.searchParams.get('slot')
  if (raw === null) return currentLen > 0 ? 0 : 0
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n >= MAX_IMAGES) return -1
  return n
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
  const current = productImageState(product)
  const slot = slotFromReq(req, current.urls.length)
  if (slot < 0) {
    return NextResponse.json({ error: 'INVALID_SLOT', message: '图片位置无效，最多 3 张' }, { status: 400 })
  }
  if (slot >= current.urls.length && current.urls.length >= MAX_IMAGES) {
    return NextResponse.json({ error: 'TOO_MANY_IMAGES', message: '每个商品最多 3 张图片' }, { status: 400 })
  }

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
  const newKey = `tenants/${product.tenantId}/products/${product.id}/image-${slot + 1}-${ts}.${ext}`

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

  const oldKey = current.keys[slot] || null
  const nextUrls = [...current.urls]
  const nextKeys = [...current.keys]
  nextUrls[slot] = publicUrl
  nextKeys[slot] = newKey
  const compacted = compactPairs(nextUrls, nextKeys)

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      imageUrl: compacted.urls[0] ?? null,
      imageStorageKey: compacted.keys[0] || null,
      imageUrls: compacted.urls.length > 0 ? JSON.stringify(compacted.urls) : null,
      imageStorageKeys: compacted.keys.length > 0 ? JSON.stringify(compacted.keys) : null,
      imageUpdatedAt: new Date(ts),
    },
    select: { id: true, imageUrl: true, imageUrls: true, imageStorageKey: true, imageStorageKeys: true, imageUpdatedAt: true },
  })

  if (oldKey && oldKey !== newKey) {
    deleteObject(BUCKET, oldKey).catch((err) => {
      console.warn('[product-image] old object delete failed', oldKey, err)
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

  const current = productImageState(product)
  const rawSlot = req.nextUrl.searchParams.get('slot')
  const slot = rawSlot === null ? -1 : slotFromReq(req, current.urls.length)
  if (rawSlot !== null && slot < 0) {
    return NextResponse.json({ error: 'INVALID_SLOT', message: '图片位置无效' }, { status: 400 })
  }

  const removedKeys = rawSlot === null
    ? current.keys.filter((key): key is string => !!key)
    : [current.keys[slot]].filter((key): key is string => !!key)
  const nextUrls = rawSlot === null ? [] : current.urls.filter((_, index) => index !== slot)
  const nextKeys = rawSlot === null ? [] : current.keys.filter((_, index) => index !== slot)
  const compacted = compactPairs(nextUrls, nextKeys)

  await prisma.product.update({
    where: { id: product.id },
    data: {
      imageUrl: compacted.urls[0] ?? null,
      imageStorageKey: compacted.keys[0] || null,
      imageUrls: compacted.urls.length > 0 ? JSON.stringify(compacted.urls) : null,
      imageStorageKeys: compacted.keys.length > 0 ? JSON.stringify(compacted.keys) : null,
      imageUpdatedAt: new Date(),
    },
  })

  for (const key of removedKeys) {
    const ok = await deleteObject(BUCKET, key)
    if (!ok) console.warn('[product-image] storage delete failed', key)
  }

  return NextResponse.json({ ok: true })
}
