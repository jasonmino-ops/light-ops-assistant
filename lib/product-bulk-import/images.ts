import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import sharp from 'sharp'
import type { ProductImportImageCandidate } from './contract'
import { extractEmbeddedImage, type OfficeEntries } from './xlsx'

const MAX_INPUT_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_OUTPUT_IMAGE_BYTES = 3 * 1024 * 1024
const EXTERNAL_IMAGE_TOTAL_TIMEOUT_MS = 25_000
const ALLOWED_OUTPUT_TYPES = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif'])
const AMBIGUOUS_LEGACY_IMAGE_CONTENT_TYPES = new Set(['application/octet-stream', 'text/plain'])

export type NormalizedImportImage = {
  buffer: Buffer
  contentType: 'image/webp'
  imageHash: string
  width: number | null
  height: number | null
}

export type ProductImportImageLimiter = <T>(operation: () => Promise<T>) => Promise<T>

/**
 * Bound the number of Sharp decode/normalize operations shared by a Confirm
 * batch. A row can contain multiple images and rows are confirmed in parallel,
 * so limiting at the row level alone does not bound peak decoded-pixel memory.
 */
export function createProductImportImageLimiter(limit = 2): ProductImportImageLimiter {
  const concurrency = Math.max(1, Math.floor(limit))
  let active = 0
  const waiters: Array<() => void> = []

  return async function runWithImageLimit<T>(operation: () => Promise<T>): Promise<T> {
    if (active < concurrency) active += 1
    else await new Promise<void>((resolve) => waiters.push(resolve))
    try {
      return await operation()
    } finally {
      const next = waiters.shift()
      if (next) next()
      else active -= 1
    }
  }
}

function publicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const nonPublic = parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
    || (parts[0] === 192 && parts[1] === 88 && parts[2] === 99)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] >= 224
  return !nonPublic
}

function ipv6Words(address: string): number[] | null {
  if (address.includes('%')) return null
  let normalized = address.toLowerCase()
  const dottedStart = normalized.lastIndexOf(':') + 1
  if (normalized.includes('.')) {
    const dotted = normalized.slice(dottedStart)
    const parts = dotted.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
    normalized = `${normalized.slice(0, dottedStart)}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - left.length - right.length
  if ((halves.length === 1 && fill !== 0) || (halves.length === 2 && fill < 1)) return null
  const raw = [...left, ...Array.from({ length: fill }, () => '0'), ...right]
  if (raw.length !== 8 || raw.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  return raw.map((part) => Number.parseInt(part, 16))
}

/** Fail closed: only ordinary public IPv4 and IPv6 global-unicast addresses. */
export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return publicIpv4(address)
  if (family !== 6) return false
  const words = ipv6Words(address)
  if (!words) return false
  // Current globally routed unicast allocation is 2000::/3. IPv4 mapped,
  // compatible, NAT64, ULA, site/link-local and multicast ranges all fail here.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return false
  // IETF special-purpose space, documentation, deprecated 6to4 and the
  // documentation prefix are not accepted as external image destinations.
  if (words[0] === 0x2001 && words[1] <= 0x01ff) return false
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false
  if (words[0] === 0x2002) return false
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false
  return true
}

type ResolvedImageUrl = { url: URL; address: string; family: 4 | 6 }

function withinDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return Promise.reject(new Error('EXTERNAL_IMAGE_TIMEOUT'))
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('EXTERNAL_IMAGE_TIMEOUT')), remaining)
    operation.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

async function assertPublicImageUrl(raw: string, deadline: number): Promise<ResolvedImageUrl> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('EXTERNAL_IMAGE_URL_INVALID')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('EXTERNAL_IMAGE_URL_INVALID')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('EXTERNAL_IMAGE_PORT_NOT_ALLOWED')
  const rawHostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']') ? rawHostname.slice(1, -1) : rawHostname
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('EXTERNAL_IMAGE_HOST_NOT_ALLOWED')
  }
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await withinDeadline(lookup(hostname, { all: true, verbatim: true }), deadline)
  if (addresses.length === 0 || addresses.some((entry) => !isPublicImageAddress(entry.address))) {
    throw new Error('EXTERNAL_IMAGE_HOST_NOT_ALLOWED')
  }
  const selected = addresses[0]
  if (selected.family !== 4 && selected.family !== 6) throw new Error('EXTERNAL_IMAGE_HOST_NOT_ALLOWED')
  return { url, address: selected.address, family: selected.family }
}

type PinnedImageResponse = {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

function requestPinnedImage(target: ResolvedImageUrl, deadline: number): Promise<PinnedImageResponse> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return Promise.reject(new Error('EXTERNAL_IMAGE_TIMEOUT'))
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: target.address, family: target.family }])
    else callback(null, target.address, target.family)
  }
  const request = target.url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    let settled = false
    let wallClockTimeout: ReturnType<typeof setTimeout> | null = null
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      if (wallClockTimeout) clearTimeout(wallClockTimeout)
      callback()
    }
    const req = request({
      protocol: target.url.protocol,
      hostname: target.url.hostname,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: 'GET',
      lookup: pinnedLookup,
      maxHeaderSize: 32 * 1024,
      timeout: Math.min(20_000, remaining),
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' },
    }, (response) => {
      const declared = Number(response.headers['content-length'] ?? 0)
      if (declared > MAX_INPUT_IMAGE_BYTES) {
        response.destroy(new Error('IMAGE_TOO_LARGE'))
        return
      }
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer | Uint8Array) => {
        length += chunk.length
        if (length > MAX_INPUT_IMAGE_BYTES) {
          response.destroy(new Error('IMAGE_TOO_LARGE'))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => finish(() => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks, length) })))
      response.on('error', (error) => finish(() => reject(error)))
    })
    req.on('timeout', () => req.destroy(new Error('EXTERNAL_IMAGE_TIMEOUT')))
    req.on('error', (error) => finish(() => reject(error)))
    wallClockTimeout = setTimeout(() => req.destroy(new Error('EXTERNAL_IMAGE_TIMEOUT')), remaining)
    req.end()
  })
}

type ExternalImageTransport = {
  resolve: (rawUrl: string, deadline: number) => Promise<ResolvedImageUrl>
  request: (target: ResolvedImageUrl, deadline: number) => Promise<PinnedImageResponse>
}

async function downloadExternalImageUsing(
  rawUrl: string,
  timeoutMs: number,
  transport: ExternalImageTransport,
): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs
  let target = await withinDeadline(transport.resolve(rawUrl, deadline), deadline)
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await withinDeadline(transport.request(target, deadline), deadline)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location
      if (!location || redirect === 3) throw new Error('EXTERNAL_IMAGE_REDIRECT_INVALID')
      target = await withinDeadline(transport.resolve(new URL(location, target.url).toString(), deadline), deadline)
      continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`EXTERNAL_IMAGE_HTTP_${response.status}`)
    const contentType = response.headers['content-type']?.toLowerCase().split(';', 1)[0].trim() ?? ''
    // Some legacy object stores (including the real CarGarden source) serve
    // raster bytes as text/plain or application/octet-stream. These bounded
    // bodies still go through fail-closed Sharp decoding before they can be
    // previewed or uploaded; HTML and other declared document types remain
    // rejected here.
    if (
      contentType
      && !contentType.startsWith('image/')
      && !AMBIGUOUS_LEGACY_IMAGE_CONTENT_TYPES.has(contentType)
    ) throw new Error('EXTERNAL_IMAGE_CONTENT_TYPE_INVALID')
    if (response.body.length === 0) throw new Error('EXTERNAL_IMAGE_EMPTY')
    return response.body
  }
  throw new Error('EXTERNAL_IMAGE_REDIRECT_INVALID')
}

export async function downloadExternalImage(rawUrl: string): Promise<Buffer> {
  return downloadExternalImageUsing(rawUrl, EXTERNAL_IMAGE_TOTAL_TIMEOUT_MS, {
    resolve: assertPublicImageUrl,
    request: requestPinnedImage,
  })
}

export async function testExternalImageDeadline(
  rawUrl: string,
  timeoutMs: number,
  transport: ExternalImageTransport,
): Promise<Buffer> {
  return downloadExternalImageUsing(rawUrl, timeoutMs, transport)
}

export async function normalizeImportImage(input: Buffer): Promise<NormalizedImportImage> {
  if (input.length === 0 || input.length > MAX_INPUT_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE')
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()
  } catch {
    throw new Error('UNSUPPORTED_IMAGE_FORMAT')
  }
  if (!metadata.format || !ALLOWED_OUTPUT_TYPES.has(metadata.format)) throw new Error('UNSUPPORTED_IMAGE_FORMAT')
  const output = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer()
  if (output.length > MAX_OUTPUT_IMAGE_BYTES) throw new Error('NORMALIZED_IMAGE_TOO_LARGE')
  return {
    buffer: output,
    contentType: 'image/webp',
    imageHash: createHash('sha256').update(output).digest('hex'),
    width: metadata.width ?? null,
    height: metadata.height ?? null,
  }
}

export async function materializeImportImage(
  candidate: ProductImportImageCandidate,
  workbookEntries?: OfficeEntries,
): Promise<NormalizedImportImage> {
  if (candidate.kind === 'PDF_CANDIDATE') throw new Error('PDF_IMAGE_REQUIRES_CONFIRMATION')
  const input = candidate.kind === 'EXTERNAL_URL'
    ? await downloadExternalImage(candidate.source)
    : workbookEntries
      ? extractEmbeddedImage(workbookEntries, candidate.source)
      : (() => { throw new Error('XLSX_SOURCE_REQUIRED') })()
  return normalizeImportImage(input)
}

export function deterministicProductImageKey(input: {
  tenantId: string
  jobId: string
  rowIdentity: string
  imageHash: string
  slot: number
}): string {
  const safeIdentity = input.rowIdentity.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
  return `tenants/${input.tenantId}/product-import-jobs/${input.jobId}/rows/${safeIdentity}/image-${input.slot + 1}-${input.imageHash}.webp`
}
