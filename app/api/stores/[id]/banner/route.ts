import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// 与 /api/stores/[id]/checkout-mode 和 menu-config 保持一致：
//   1) cookie session (生产/Mini App) 优先
//   2) x-* dev header fallback
// 之前此路由只读 header，导致生产 cookie 路径下被识别为"无身份"而 403
async function assertOwner(req: NextRequest, storeId: string) {
  const ctx = await getContext(req)
  if (!ctx) return null
  if (ctx.role !== 'OWNER') return null
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: ctx.tenantId },
    select: { id: true, code: true },
  })
  return store
}

// POST /api/stores/[id]/banner — 上传头图
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: storeId } = await params
  const store = await assertOwner(req, storeId)
  if (!store) return NextResponse.json({ error: '无权限' }, { status: 403 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: '仅支持 JPG / PNG / WebP / GIF' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: '图片不能超过 2MB' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const base64 = buffer.toString('base64')
  const dataUri = `data:${file.type};base64,${base64}`

  const bannerUrl = `/api/public/stores/${store.code}/banner?v=${Date.now()}`

  await prisma.store.update({
    where: { id: storeId },
    data: { bannerData: dataUri, bannerUrl },
  })

  return NextResponse.json({ bannerUrl })
}

// DELETE /api/stores/[id]/banner — 删除头图
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: storeId } = await params
  const store = await assertOwner(req, storeId)
  if (!store) return NextResponse.json({ error: '无权限' }, { status: 403 })

  await prisma.store.update({
    where: { id: storeId },
    data: { bannerData: null, bannerUrl: null },
  })

  return NextResponse.json({ ok: true })
}
