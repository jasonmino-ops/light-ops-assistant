/**
 * Supabase Storage 轻量封装 — 直接 fetch REST API，不引入 SDK 依赖。
 *
 * 需要环境变量：
 *   SUPABASE_URL              - 形如 https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY - service role key（仅服务端使用，禁止暴露给前端）
 *
 * 仅支持 public bucket：上传后通过 /storage/v1/object/public/... 直接公开访问。
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function isStorageConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_KEY)
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('STORAGE_NOT_CONFIGURED')
    this.name = 'StorageNotConfiguredError'
  }
}

/**
 * 上传对象到 public bucket。返回公开访问 URL。
 * 已存在同 key 会被覆盖（x-upsert: true）。
 */
export async function uploadObject(
  bucket: string,
  path: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new StorageNotConfiguredError()

  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'Cache-Control': '3600',
    },
    body: new Uint8Array(buf),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`STORAGE_UPLOAD_${res.status}:${text.slice(0, 240)}`)
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

/**
 * 删除对象。失败返回 false，不抛异常 —— 调用方决定是否阻断主流程。
 */
export async function deleteObject(bucket: string, path: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
    })
    return res.ok
  } catch {
    return false
  }
}
