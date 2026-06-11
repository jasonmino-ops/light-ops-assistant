import crypto from 'crypto'
import type { LingshuoReplyInput, LingshuoReplyResult } from './types'

const DEFAULT_TIMEOUT_MS = 3000
const REPLY_PATH = '/lingshuo/api/customer/reply'

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function hmacSignature(secret: string, timestamp: string, body: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
}

function normalizeTimeout(timeoutMs: number | null | undefined): number {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.floor(timeoutMs), 500), 10_000)
}

function elapsedSince(start: number): number {
  return Math.max(0, Date.now() - start)
}

function mockReply(input: LingshuoReplyInput, start: number): LingshuoReplyResult {
  const message = input.message.toLowerCase()
  if (message.includes('mock_need_human')) {
    return {
      ok: true,
      replyText: '[mock] human handoff requested',
      language: input.language ?? null,
      intent: 'mock_need_human',
      confidence: 0.95,
      needHuman: true,
      auditId: 'mock-lingshuo-need-human',
      raw: { mock: true, mode: 'needHuman' },
      latencyMs: elapsedSince(start),
    }
  }
  if (message.includes('mock_low_confidence')) {
    return {
      ok: true,
      replyText: '[mock] low confidence reply',
      language: input.language ?? null,
      intent: 'mock_low_confidence',
      confidence: 0.3,
      needHuman: false,
      auditId: 'mock-lingshuo-low-confidence',
      raw: { mock: true, mode: 'lowConfidence' },
      latencyMs: elapsedSince(start),
    }
  }
  return {
    ok: true,
    replyText: `[mock] ${input.message}`,
    language: input.language ?? null,
    intent: 'mock_reply',
    confidence: 0.9,
    needHuman: false,
    auditId: 'mock-lingshuo',
    raw: { mock: true },
    latencyMs: elapsedSince(start),
  }
}

function standardFailure(
  errorCode: LingshuoReplyResult extends infer T
    ? T extends { ok: false; errorCode: infer C } ? C : never
    : never,
  errorMessage: string,
  start: number,
  raw?: unknown,
): LingshuoReplyResult {
  return {
    ok: false,
    errorCode,
    errorMessage,
    latencyMs: elapsedSince(start),
    raw,
  }
}

function normalizeResponse(raw: unknown, start: number): LingshuoReplyResult {
  if (!raw || typeof raw !== 'object') {
    return standardFailure('INVALID_RESPONSE', 'Lingshuo response is not an object', start, raw)
  }
  const data = raw as Record<string, unknown>
  const replyText = typeof data.replyText === 'string' ? data.replyText.trim() : ''
  if (!replyText) {
    return standardFailure('INVALID_RESPONSE', 'Lingshuo response missing replyText', start, raw)
  }
  const confidence = typeof data.confidence === 'number' && Number.isFinite(data.confidence)
    ? data.confidence
    : null
  return {
    ok: true,
    replyText,
    language: typeof data.language === 'string' ? data.language : null,
    intent: typeof data.intent === 'string' ? data.intent : null,
    confidence,
    needHuman: data.needHuman === true,
    auditId: typeof data.auditId === 'string' ? data.auditId : null,
    raw,
    latencyMs: elapsedSince(start),
  }
}

export async function callLingshuoReply(input: LingshuoReplyInput): Promise<LingshuoReplyResult> {
  const start = Date.now()
  const apiBaseUrl = input.apiBaseUrl?.trim()
  const clientId = input.clientId?.trim()
  const apiSecret = input.apiSecret?.trim()
  const timeoutMs = normalizeTimeout(input.timeoutMs)

  if (apiBaseUrl === 'mock://lingshuo') return mockReply(input, start)

  if (!apiBaseUrl || !clientId || !apiSecret) {
    return standardFailure('CONFIG_MISSING', 'Lingshuo apiBaseUrl/clientId/apiSecret is not configured', start)
  }

  const payload = {
    tenantId: input.tenantId ?? null,
    storeId: input.storeId ?? null,
    customerId: input.customerId ?? null,
    sessionId: input.sessionId ?? null,
    language: input.language ?? null,
    message: input.message,
    allowedTools: input.allowedTools ?? [],
    context: input.context ?? {},
  }
  const body = JSON.stringify(payload)
  const timestamp = String(Date.now())
  const signature = hmacSignature(apiSecret, timestamp, body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${normalizeBaseUrl(apiBaseUrl)}${REPLY_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lingshuo-Client-Id': clientId,
        'X-Lingshuo-Timestamp': timestamp,
        'X-Lingshuo-Signature': signature,
      },
      body,
      signal: controller.signal,
    })
    const rawText = await res.text().catch(() => '')
    let raw: unknown = null
    try {
      raw = rawText ? JSON.parse(rawText) : null
    } catch {
      raw = { text: rawText.slice(0, 500) }
    }
    if (!res.ok) {
      return standardFailure('HTTP_ERROR', `Lingshuo HTTP ${res.status}`, start, raw)
    }
    return normalizeResponse(raw, start)
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError'
    return standardFailure(
      isAbort ? 'TIMEOUT' : 'REQUEST_FAILED',
      error instanceof Error ? error.message : 'Lingshuo request failed',
      start,
    )
  } finally {
    clearTimeout(timer)
  }
}
