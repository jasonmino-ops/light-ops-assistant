import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import {
  isStorageConfigured,
  StorageNotConfiguredError,
  uploadObject,
} from '@/lib/supabase-storage'

const BUCKET = 'product-images'
const MAX_SIZE = 20 * 1024 * 1024

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

  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以上传营销页视频' }, { status: 403 })
  }

  const { id } = await params
  const page = await prisma.marketingProductPage.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, tenantId: true, productId: true },
  })
  if (!page) return NextResponse.json({ error: 'PAGE_NOT_FOUND', message: '营销页不存在' }, { status: 404 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '请上传 MP4 视频文件' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'NO_FILE', message: '未收到文件' }, { status: 400 })
  }
  if (file.type !== 'video/mp4') {
    return NextResponse.json({ error: 'INVALID_TYPE', message: '仅支持 MP4 视频' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '视频不能超过 20MB' }, { status: 400 })
  }

  const key = `tenants/${page.tenantId}/products/${page.productId}/marketing/${page.id}/hero-video-${Date.now()}.mp4`

  try {
    const videoUrl = await uploadObject(BUCKET, key, Buffer.from(await file.arrayBuffer()), file.type)
    return NextResponse.json({ videoUrl, storageKey: key })
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: 'STORAGE_NOT_CONFIGURED' }, { status: 500 })
    }
    const msg = e instanceof Error ? e.message : 'UPLOAD_FAILED'
    return NextResponse.json({ error: 'UPLOAD_FAILED', message: '上传失败：' + msg.slice(0, 200) }, { status: 502 })
  }
}
