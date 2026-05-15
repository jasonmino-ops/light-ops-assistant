/**
 * POST /api/uploads/delivery-photo
 *
 * 上传顾客门牌/位置照片到 Supabase Storage（public bucket：order-delivery-photos）。
 * 校验：image/jpeg | image/png | image/webp；≤ 5MB；单文件。
 * 返回：{ ok, url, path }
 *
 * 环境变量依赖：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（仅服务端）。
 * Bucket 需提前在 Supabase 控制台创建为 public（详见 docs/db/）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { uploadObject, isStorageConfigured, StorageNotConfiguredError } from '@/lib/supabase-storage'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024
const BUCKET = 'order-delivery-photos'

function extOf(type: string): string {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/png')  return 'png'
  if (type === 'image/webp') return 'webp'
  return 'bin'
}

function yyyymmdd(): string {
  const d = new Date()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}${m}${day}`
}

function randomId(): string {
  // 16 字节十六进制，约 32 位；无需密码学强度
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: NextRequest) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: 'STORAGE_NOT_CONFIGURED', message: '后端未配置 Supabase Storage' },
      { status: 500 },
    )
  }

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

  // 顾客端上传未走鉴权 cookie；按 anonymous 路径分桶，避免攻击者拼出别人路径。
  const path = `anonymous/${yyyymmdd()}/${randomId()}.${extOf(type)}`

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const url = await uploadObject(BUCKET, path, buf, type)
    return NextResponse.json({ ok: true, url, path })
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: 'STORAGE_NOT_CONFIGURED' }, { status: 500 })
    }
    return NextResponse.json({ error: 'UPLOAD_FAILED', message: (e as Error).message }, { status: 502 })
  }
}
