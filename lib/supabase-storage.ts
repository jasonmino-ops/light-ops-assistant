/**
 * Supabase Storage 轻量封装 — 直接 fetch REST API，不引入 SDK 依赖。
 *
 * 需要环境变量：
 *   SUPABASE_URL              - 形如 https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY - service role key（仅服务端使用，禁止暴露给前端）
 *
 * 仅支持 public bucket：上传后通过 /storage/v1/object/public/... 直接公开访问。
 */

function storageConfig() {
  return {
    url: process.env.SUPABASE_URL?.replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

export function isStorageConfigured(): boolean {
  const config = storageConfig()
  return !!(config.url && config.key)
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
  const { url: supabaseUrl, key: supabaseKey } = storageConfig()
  if (!supabaseUrl || !supabaseKey) throw new StorageNotConfiguredError()

  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'Cache-Control': '3600',
    },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`STORAGE_UPLOAD_${res.status}:${text.slice(0, 240)}`)
  }

  return publicObjectUrl(bucket, path)
}

/**
 * 删除对象。失败返回 false，不抛异常 —— 调用方决定是否阻断主流程。
 */
export async function deleteObject(bucket: string, path: string): Promise<boolean> {
  const { url: supabaseUrl, key: supabaseKey } = storageConfig()
  if (!supabaseUrl || !supabaseKey) return false
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
      },
      signal: AbortSignal.timeout(30_000),
    })
    // DELETE is idempotent for compensation and cleanup callers.
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

/** Delete up to 100 exact object paths with Supabase Storage's bulk contract. */
export async function deleteObjects(bucket: string, paths: string[]): Promise<boolean> {
  const uniquePaths = [...new Set(paths)].slice(0, 100)
  if (uniquePaths.length === 0) return true
  const { url: supabaseUrl, key: supabaseKey } = storageConfig()
  if (!supabaseUrl || !supabaseKey) return false
  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: serviceHeaders(supabaseKey),
      body: JSON.stringify({ prefixes: uniquePaths }),
      signal: AbortSignal.timeout(30_000),
    })
    return response.ok || response.status === 404
  } catch {
    return false
  }
}

function serviceHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' }
}

const STORAGE_CONTROL_TIMEOUT_MS = 15_000

/** Creates the private import-staging bucket if absent. Safe under concurrent callers. */
export async function ensurePrivateBucket(
  bucket: string,
  options: { fileSizeLimit?: number; allowedMimeTypes?: string[] } = {},
): Promise<void> {
  const { url, key } = storageConfig()
  if (!url || !key) throw new StorageNotConfiguredError()
  const current = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
    headers: serviceHeaders(key),
    signal: AbortSignal.timeout(STORAGE_CONTROL_TIMEOUT_MS),
  })
  if (current.ok) {
    const configuration = await current.json().catch(() => null) as {
      public?: boolean
      file_size_limit?: number | null
      allowed_mime_types?: string[] | null
    } | null
    if (!configuration || configuration.public !== false) throw new Error('STORAGE_BUCKET_NOT_PRIVATE')
    const currentMimeTypes = configuration.allowed_mime_types
    const requestedMimeTypes = options.allowedMimeTypes ?? []
    const missingMimeTypes = Array.isArray(currentMimeTypes)
      ? requestedMimeTypes.filter((mimeType) => !currentMimeTypes.includes(mimeType))
      : []
    const limitTooSmall = options.fileSizeLimit != null
      && configuration.file_size_limit != null
      && configuration.file_size_limit < options.fileSizeLimit
    if (missingMimeTypes.length > 0 || limitTooSmall) {
      const updated = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
        method: 'PUT',
        headers: serviceHeaders(key),
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: false,
          file_size_limit: Math.max(configuration.file_size_limit ?? 0, options.fileSizeLimit ?? 0) || null,
          allowed_mime_types: Array.isArray(currentMimeTypes)
            ? [...new Set([...currentMimeTypes, ...requestedMimeTypes])]
            : null,
        }),
        signal: AbortSignal.timeout(STORAGE_CONTROL_TIMEOUT_MS),
      })
      if (!updated.ok) {
        const message = await updated.text().catch(() => '')
        throw new Error(`STORAGE_BUCKET_UPDATE_${updated.status}:${message.slice(0, 160)}`)
      }
    }
    return
  }
  if (current.status !== 404) throw new Error(`STORAGE_BUCKET_READ_${current.status}`)
  const created = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: serviceHeaders(key),
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: options.fileSizeLimit,
      allowed_mime_types: options.allowedMimeTypes,
    }),
    signal: AbortSignal.timeout(STORAGE_CONTROL_TIMEOUT_MS),
  })
  if (!created.ok && created.status !== 409) {
    const message = await created.text().catch(() => '')
    throw new Error(`STORAGE_BUCKET_CREATE_${created.status}:${message.slice(0, 160)}`)
  }
}

/** Returns a short-lived upload URL; the browser uploads bytes directly to Storage. */
export async function createSignedUploadUrl(bucket: string, objectPath: string): Promise<string> {
  const { url, key } = storageConfig()
  if (!url || !key) throw new StorageNotConfiguredError()
  const response = await fetch(`${url}/storage/v1/object/upload/sign/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: serviceHeaders(key),
    body: JSON.stringify({ upsert: true }),
    signal: AbortSignal.timeout(STORAGE_CONTROL_TIMEOUT_MS),
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`STORAGE_SIGN_UPLOAD_${response.status}:${message.slice(0, 160)}`)
  }
  const data = await response.json() as { url?: string; signedURL?: string; signedUrl?: string }
  const signed = data.signedURL ?? data.signedUrl ?? data.url
  if (!signed) throw new Error('STORAGE_SIGN_UPLOAD_INVALID_RESPONSE')
  if (signed.startsWith('http')) return signed
  if (signed.startsWith('/storage/v1/')) return `${new URL(url).origin}${signed}`
  if (signed.startsWith('/object/')) return `${url}/storage/v1${signed}`
  return new URL(signed, `${url}/storage/v1/`).toString()
}

export async function downloadObject(bucket: string, objectPath: string, maxBytes?: number): Promise<Buffer> {
  const { url, key } = storageConfig()
  if (!url || !key) throw new StorageNotConfiguredError()
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    signal: AbortSignal.timeout(55_000),
  })
  if (!response.ok) throw new Error(`STORAGE_DOWNLOAD_${response.status}`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (maxBytes && declared > maxBytes) throw new Error('STORAGE_OBJECT_TOO_LARGE')
  if (!response.body) throw new Error('STORAGE_OBJECT_EMPTY')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (maxBytes && length > maxBytes) {
      await reader.cancel()
      throw new Error('STORAGE_OBJECT_TOO_LARGE')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length)
}

export function publicObjectUrl(bucket: string, objectPath: string): string {
  const { url } = storageConfig()
  if (!url) throw new StorageNotConfiguredError()
  return `${url}/storage/v1/object/public/${bucket}/${objectPath}`
}
