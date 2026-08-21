export const CASHIER_REALTIME_PROTOCOL_VERSION = 1 as const
export const CASHIER_REALTIME_TICKET_PURPOSE = 'cashier-realtime' as const
export const CASHIER_REALTIME_WEBSOCKET_PROTOCOL = 'cashier-realtime-v1' as const
export const CASHIER_REALTIME_TICKET_PROTOCOL_PREFIX = 'ticket.' as const
export const CASHIER_REALTIME_TICKET_TTL_SECONDS = 5 * 60
export const CASHIER_REALTIME_MAX_TICKET_TTL_SECONDS = 10 * 60
export const CASHIER_REALTIME_NOTIFY_MAX_SKEW_MS = 60_000

export const CASHIER_REALTIME_WAKE_TYPES = [
  'orders_changed',
  'pending_orders_changed',
] as const

export type CashierRealtimeWakeType = typeof CASHIER_REALTIME_WAKE_TYPES[number]
export type CashierRealtimeRole = 'OWNER' | 'STAFF'
export type CashierRealtimeAuthSource = 'ACCOUNT' | 'DEVICE'
export type CashierRealtimeSubjectType = 'user' | 'device'

export type CashierRealtimeTicketClaims = {
  version: typeof CASHIER_REALTIME_PROTOCOL_VERSION
  purpose: typeof CASHIER_REALTIME_TICKET_PURPOSE
  tenantId: string
  storeId: string
  storeCode: string
  subjectType: CashierRealtimeSubjectType
  subjectId: string
  role: CashierRealtimeRole
  source: CashierRealtimeAuthSource
  jti: string
  iat: number
  exp: number
}

export type CashierRealtimeServerNotify = {
  version: typeof CASHIER_REALTIME_PROTOCOL_VERSION
  tenantId: string
  storeId: string
  type: CashierRealtimeWakeType
  timestamp: number
  eventId: string
}

export type CashierRealtimeWakeMessage = {
  version: typeof CASHIER_REALTIME_PROTOCOL_VERSION
  type: CashierRealtimeWakeType
  timestamp: number
  eventId: string
}

export type TicketVerificationResult =
  | { ok: true; claims: CashierRealtimeTicketClaims }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'invalid_claims' | 'expired' | 'wrong_purpose' | 'wrong_store' }

export type NotifyVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'expired' | 'invalid_signature' }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const TOKEN_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/
const STORE_CODE_PATTERN = /^[^\u0000-\u001f\u007f]{1,120}$/
const SIGNATURE_PREFIX = 'v1='

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function encodeCashierRealtimeJson(value: unknown): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)))
}

export function decodeCashierRealtimeJson(value: string): unknown | null {
  const bytes = base64UrlToBytes(value)
  if (!bytes) return null
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown
  } catch {
    return null
  }
}

function requireDedicatedSecret(secret: string): void {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error('CASHIER_REALTIME_SECRET_TOO_SHORT')
  }
}

async function importHmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  requireDedicatedSecret(secret)
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

export async function cashierRealtimeHmacBase64Url(message: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret, 'sign')
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return bytesToBase64Url(new Uint8Array(signature))
}

async function verifyHmacBase64Url(message: string, signature: string, secret: string): Promise<boolean> {
  const signatureBytes = base64UrlToBytes(signature)
  if (!signatureBytes) return false
  try {
    const key = await importHmacKey(secret, 'verify')
    const ownedSignature = new Uint8Array(signatureBytes.byteLength)
    ownedSignature.set(signatureBytes)
    return crypto.subtle.verify('HMAC', key, ownedSignature, encoder.encode(message))
  } catch {
    return false
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function isTokenIdentifier(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_ID_PATTERN.test(value)
}

function isStoreCode(value: unknown): value is string {
  return typeof value === 'string' && STORE_CODE_PATTERN.test(value)
}

export function isCashierRealtimeWakeType(value: unknown): value is CashierRealtimeWakeType {
  return typeof value === 'string' && (CASHIER_REALTIME_WAKE_TYPES as readonly string[]).includes(value)
}

function parseTicketClaims(value: unknown): CashierRealtimeTicketClaims | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'version', 'purpose', 'tenantId', 'storeId', 'storeCode', 'subjectType', 'subjectId',
    'role', 'source', 'jti', 'iat', 'exp',
  ])) return null

  if (
    value.version !== CASHIER_REALTIME_PROTOCOL_VERSION ||
    !isTokenIdentifier(value.tenantId) ||
    !isTokenIdentifier(value.storeId) ||
    !isStoreCode(value.storeCode) ||
    (value.subjectType !== 'user' && value.subjectType !== 'device') ||
    !isTokenIdentifier(value.subjectId) ||
    (value.role !== 'OWNER' && value.role !== 'STAFF') ||
    (value.source !== 'ACCOUNT' && value.source !== 'DEVICE') ||
    !isTokenIdentifier(value.jti) ||
    !Number.isSafeInteger(value.iat) ||
    !Number.isSafeInteger(value.exp)
  ) return null

  return value as CashierRealtimeTicketClaims
}

export function buildCashierRealtimeTicketClaims(input: {
  tenantId: string
  storeId: string
  storeCode: string
  subjectType: CashierRealtimeSubjectType
  subjectId: string
  role: CashierRealtimeRole
  source: CashierRealtimeAuthSource
  jti: string
  nowMs?: number
  ttlSeconds?: number
}): CashierRealtimeTicketClaims {
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000)
  const ttlSeconds = input.ttlSeconds ?? CASHIER_REALTIME_TICKET_TTL_SECONDS
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > CASHIER_REALTIME_MAX_TICKET_TTL_SECONDS) {
    throw new Error('INVALID_CASHIER_REALTIME_TICKET_TTL')
  }
  const claims: CashierRealtimeTicketClaims = {
    version: CASHIER_REALTIME_PROTOCOL_VERSION,
    purpose: CASHIER_REALTIME_TICKET_PURPOSE,
    tenantId: input.tenantId,
    storeId: input.storeId,
    storeCode: input.storeCode,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    role: input.role,
    source: input.source,
    jti: input.jti,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  }
  if (!parseTicketClaims(claims)) throw new Error('INVALID_CASHIER_REALTIME_TICKET_CLAIMS')
  return claims
}

export async function signCashierRealtimeTicket(
  claims: CashierRealtimeTicketClaims,
  secret: string,
): Promise<string> {
  if (!parseTicketClaims(claims) || claims.purpose !== CASHIER_REALTIME_TICKET_PURPOSE) {
    throw new Error('INVALID_CASHIER_REALTIME_TICKET_CLAIMS')
  }
  const header = encodeCashierRealtimeJson({ alg: 'HS256', typ: 'JWT', version: CASHIER_REALTIME_PROTOCOL_VERSION })
  const payload = encodeCashierRealtimeJson(claims)
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${await cashierRealtimeHmacBase64Url(unsigned, secret)}`
}

export async function verifyCashierRealtimeTicket(
  token: string,
  secret: string,
  options?: { nowMs?: number; expectedTenantId?: string; expectedStoreId?: string },
): Promise<TicketVerificationResult> {
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [encodedHeader, encodedPayload, signature] = parts
  const header = decodeCashierRealtimeJson(encodedHeader)
  if (!isPlainRecord(header) || !hasExactKeys(header, ['alg', 'typ', 'version']) ||
    header.alg !== 'HS256' || header.typ !== 'JWT' || header.version !== CASHIER_REALTIME_PROTOCOL_VERSION) {
    return { ok: false, reason: 'malformed' }
  }
  if (!await verifyHmacBase64Url(`${encodedHeader}.${encodedPayload}`, signature, secret)) {
    return { ok: false, reason: 'invalid_signature' }
  }
  const rawClaims = decodeCashierRealtimeJson(encodedPayload)
  const claims = parseTicketClaims(rawClaims)
  if (!claims) return { ok: false, reason: 'invalid_claims' }
  if (claims.purpose !== CASHIER_REALTIME_TICKET_PURPOSE) return { ok: false, reason: 'wrong_purpose' }

  const nowSeconds = Math.floor((options?.nowMs ?? Date.now()) / 1000)
  if (
    claims.exp <= nowSeconds ||
    claims.iat > nowSeconds + 10 ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > CASHIER_REALTIME_MAX_TICKET_TTL_SECONDS
  ) return { ok: false, reason: 'expired' }

  if (
    (options?.expectedTenantId && claims.tenantId !== options.expectedTenantId) ||
    (options?.expectedStoreId && claims.storeId !== options.expectedStoreId)
  ) return { ok: false, reason: 'wrong_store' }

  return { ok: true, claims }
}

export function cashierRealtimeStoreObjectName(input: { tenantId: string; storeId: string }): string {
  if (!isTokenIdentifier(input.tenantId) || !isTokenIdentifier(input.storeId)) {
    throw new Error('INVALID_CASHIER_REALTIME_STORE_SCOPE')
  }
  return `v1:${input.tenantId}:${input.storeId}`
}

function serverNotifySigningInput(timestamp: string, eventId: string, rawBody: string): string {
  return `cashier-realtime-notify-v1\n${timestamp}\n${eventId}\n${rawBody}`
}

export async function signCashierRealtimeServerNotify(input: {
  timestamp: string
  eventId: string
  rawBody: string
  secret: string
}): Promise<string> {
  return `${SIGNATURE_PREFIX}${await cashierRealtimeHmacBase64Url(
    serverNotifySigningInput(input.timestamp, input.eventId, input.rawBody),
    input.secret,
  )}`
}

export async function verifyCashierRealtimeServerNotify(input: {
  timestamp: string | null
  eventId: string | null
  signature: string | null
  rawBody: string
  secret: string
  nowMs?: number
}): Promise<NotifyVerificationResult> {
  if (!input.timestamp || !input.eventId || !input.signature?.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, reason: 'missing' }
  }
  const timestamp = Number(input.timestamp)
  if (!Number.isSafeInteger(timestamp) || Math.abs((input.nowMs ?? Date.now()) - timestamp) > CASHIER_REALTIME_NOTIFY_MAX_SKEW_MS) {
    return { ok: false, reason: 'expired' }
  }
  if (!isTokenIdentifier(input.eventId)) return { ok: false, reason: 'invalid_signature' }
  const valid = await verifyHmacBase64Url(
    serverNotifySigningInput(input.timestamp, input.eventId, input.rawBody),
    input.signature.slice(SIGNATURE_PREFIX.length),
    input.secret,
  )
  return valid ? { ok: true } : { ok: false, reason: 'invalid_signature' }
}

export function parseCashierRealtimeServerNotify(value: unknown): CashierRealtimeServerNotify | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'version', 'tenantId', 'storeId', 'type', 'timestamp', 'eventId',
  ])) return null
  if (
    value.version !== CASHIER_REALTIME_PROTOCOL_VERSION ||
    !isTokenIdentifier(value.tenantId) ||
    !isTokenIdentifier(value.storeId) ||
    !isCashierRealtimeWakeType(value.type) ||
    !Number.isSafeInteger(value.timestamp) ||
    !isTokenIdentifier(value.eventId)
  ) return null
  return value as CashierRealtimeServerNotify
}

export function toCashierRealtimeWakeMessage(event: CashierRealtimeServerNotify): CashierRealtimeWakeMessage {
  return {
    version: CASHIER_REALTIME_PROTOCOL_VERSION,
    type: event.type,
    timestamp: event.timestamp,
    eventId: event.eventId,
  }
}

export function parseCashierRealtimeWakeMessage(value: unknown): CashierRealtimeWakeMessage | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['version', 'type', 'timestamp', 'eventId'])) return null
  if (
    value.version !== CASHIER_REALTIME_PROTOCOL_VERSION ||
    !isCashierRealtimeWakeType(value.type) ||
    !Number.isSafeInteger(value.timestamp) ||
    !isTokenIdentifier(value.eventId)
  ) return null
  return value as CashierRealtimeWakeMessage
}
