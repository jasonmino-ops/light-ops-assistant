/**
 * POST /api/uploads/delivery-photo
 *
 * 顾客端 H5 上传门牌/位置照片。本期不落 Supabase Storage，
 * 而是返回 base64 data URL，由前端在下单时把 dataUrl 一并提交，
 * 服务端在 /api/public/orders 创建订单时把 dataUrl 写到 CustomerOrder.deliveryAddressPhotoData，
 * 并把 deliveryAddressPhotoUrl 指向内部 GET 端点。
 *
 * 限制：image/jpeg | image/png | image/webp；≤ 5MB；单文件。
 */
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(req: NextRequest) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'INVALID_FORM' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'NO_FILE' }, { status: 400 })

  const type = file.type
  if (!ALLOWED.has(type)) {
    return NextResponse.json({ error: 'INVALID_TYPE', message: '仅支持 JPG / PNG / WebP' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '图片过大（>5MB）' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const dataUrl = `data:${type};base64,${buf.toString('base64')}`
  return NextResponse.json({ ok: true, dataUrl })
}
