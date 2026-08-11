import { qzRawBytesToBase64 } from './qzEscPosBitImage'

export const ESHOP_TRAY_PROTOCOL_VERSION = '0.1' as const
export const ESHOP_TRAY_PORT = 17631 as const
export const ESHOP_TRAY_QUERY_PARAMETER = 'eshopTray' as const
export const ESHOP_TRAY_STORAGE_KEY = 'eshop-tray:base-url:v0.1' as const

const HEALTH_TIMEOUT_MS = 1_200
const PRINT_TIMEOUT_MS = 30_000
const PRIVATE_IPV4 = /^(?:10\.(?:\d{1,3}\.){2}\d{1,3}|127\.(?:\d{1,3}\.){2}\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace: 'local'
}

export type EshopTrayHealth = {
  service: 'e-shop-tray'
  version: string
  protocolVersion: typeof ESHOP_TRAY_PROTOCOL_VERSION
  status: 'online' | 'busy'
}

export type EshopTrayEndpoint = {
  baseUrl: string
  health: EshopTrayHealth
}

export type EshopTrayPrintResult = {
  protocolVersion: typeof ESHOP_TRAY_PROTOCOL_VERSION
  requestId: string
  status: 'success'
  delivery: {
    transport: 'windows-queue'
    bytesWritten: number
    durationMs: number
  }
}

export class EshopTrayClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly submitted: boolean,
    options?: { cause?: unknown },
  ) {
    super(code, options)
    this.name = 'EshopTrayClientError'
  }
}

function isValidIpv4(hostname: string): boolean {
  if (!PRIVATE_IPV4.test(hostname)) return false
  return hostname.split('.').every((part) => Number(part) <= 255)
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized.endsWith('.local')
    || isValidIpv4(normalized)
    || normalized === '[::1]'
    || /^\[(?:fe80|f[cd][0-9a-f]{2}):/i.test(normalized)
}

export function normalizeEshopTrayBaseUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || !isLocalHostname(url.hostname)) return null
    if (url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    if (url.port && url.port !== String(ESHOP_TRAY_PORT)) return null
    url.port = String(ESHOP_TRAY_PORT)
    url.pathname = ''
    return url.origin
  } catch {
    return null
  }
}

function readRuntimeLocatorCandidates(): string[] {
  const candidates: string[] = []
  if (typeof window !== 'undefined') {
    try {
      const queryValue = new URLSearchParams(window.location.search).get(ESHOP_TRAY_QUERY_PARAMETER)
      const queryUrl = queryValue ? normalizeEshopTrayBaseUrl(queryValue) : null
      if (queryUrl) {
        candidates.push(queryUrl)
        window.localStorage.setItem(ESHOP_TRAY_STORAGE_KEY, queryUrl)
      }
    } catch {
      // Runtime Locator continues with its non-persistent candidates.
    }
    try {
      const storedUrl = normalizeEshopTrayBaseUrl(window.localStorage.getItem(ESHOP_TRAY_STORAGE_KEY) ?? '')
      if (storedUrl) candidates.push(storedUrl)
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    const sameHostUrl = normalizeEshopTrayBaseUrl(`http://${window.location.hostname}:${ESHOP_TRAY_PORT}`)
    if (sameHostUrl) candidates.push(sameHostUrl)
  }
  return [...new Set(candidates)]
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    dispose: () => globalThis.clearTimeout(timer),
  }
}

function parseHealth(value: unknown): EshopTrayHealth | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const health = value as Partial<EshopTrayHealth>
  if (
    health.service !== 'e-shop-tray'
    || health.protocolVersion !== ESHOP_TRAY_PROTOCOL_VERSION
    || typeof health.version !== 'string'
    || (health.status !== 'online' && health.status !== 'busy')
  ) return null
  return health as EshopTrayHealth
}

async function fetchHealth(baseUrl: string, fetchImpl: typeof fetch): Promise<EshopTrayHealth | null> {
  const timeout = withTimeout(HEALTH_TIMEOUT_MS)
  try {
    const init: LocalNetworkRequestInit = {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: timeout.signal,
      targetAddressSpace: 'local',
    }
    const response = await fetchImpl(`${baseUrl}/v1/health`, init)
    if (!response.ok) return null
    return parseHealth(await response.json())
  } catch {
    return null
  } finally {
    timeout.dispose()
  }
}

/**
 * ECCP Runtime Locator V0.1: explicit query/localStorage candidate, plus the
 * current host only when it is already local. It does not scan the LAN or
 * discover printers, and an unconfigured Browser returns immediately.
 */
export async function locateEshopTray(options?: {
  candidates?: string[]
  fetchImpl?: typeof fetch
}): Promise<EshopTrayEndpoint | null> {
  if (typeof window === 'undefined' && !options?.candidates) return null
  const fetchImpl = options?.fetchImpl ?? fetch
  const candidates = options?.candidates
    ? options.candidates.map(normalizeEshopTrayBaseUrl).filter((value): value is string => !!value)
    : readRuntimeLocatorCandidates()
  for (const baseUrl of [...new Set(candidates)]) {
    const health = await fetchHealth(baseUrl, fetchImpl)
    if (health) return { baseUrl, health }
  }
  return null
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stableBytes = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', stableBytes.buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tray-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function submitEshopTrayPrint(
  endpoint: EshopTrayEndpoint,
  commandStream: Uint8Array,
  options?: { fetchImpl?: typeof fetch; requestId?: string },
): Promise<EshopTrayPrintResult> {
  if (!(commandStream instanceof Uint8Array) || commandStream.byteLength === 0) {
    throw new EshopTrayClientError('INVALID_COMMAND_STREAM', false)
  }
  const requestId = options?.requestId ?? createRequestId()
  let digest: string
  try {
    digest = await sha256Hex(commandStream)
  } catch (cause) {
    throw new EshopTrayClientError('COMMAND_STREAM_DIGEST_FAILED', false, { cause })
  }
  const body = {
    protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
    requestId,
    commandStream: {
      encoding: 'base64' as const,
      byteLength: commandStream.byteLength,
      sha256: digest,
      data: qzRawBytesToBase64(commandStream),
    },
  }
  const timeout = withTimeout(PRINT_TIMEOUT_MS)
  try {
    const init: LocalNetworkRequestInit = {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-E-Shop-Tray-Protocol': ESHOP_TRAY_PROTOCOL_VERSION,
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
      targetAddressSpace: 'local',
    }
    const response = await (options?.fetchImpl ?? fetch)(`${endpoint.baseUrl}/v1/print`, init)
    const value = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) {
      const error = value?.error as Record<string, unknown> | undefined
      throw new EshopTrayClientError(
        typeof error?.code === 'string' ? error.code : 'TRAY_PRINT_FAILED',
        true,
      )
    }
    const result = value as Partial<EshopTrayPrintResult> | null
    if (
      !result
      || result.protocolVersion !== ESHOP_TRAY_PROTOCOL_VERSION
      || result.requestId !== requestId
      || result.status !== 'success'
      || !result.delivery
      || result.delivery.transport !== 'windows-queue'
      || result.delivery.bytesWritten !== commandStream.byteLength
    ) {
      throw new EshopTrayClientError('INVALID_TRAY_RESPONSE', true)
    }
    return result as EshopTrayPrintResult
  } catch (error) {
    if (error instanceof EshopTrayClientError) throw error
    throw new EshopTrayClientError('TRAY_PRINT_RESULT_UNKNOWN', true, { cause: error })
  } finally {
    timeout.dispose()
  }
}
