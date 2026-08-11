'use client'

import { apiFetch } from './api'
import { qzRawBytesToBase64 } from './qzEscPosBitImage'

const RELAY_VERSION = '0.1' as const
const FIELD_QUEUE_NAME = '前台' as const

export type EshopTray02CloudEnableState = 'pending' | 'enabled' | 'disabled'
export type EshopTray02PrintPath = 'CONFIG_PENDING' | 'CLOUD_RELAY' | 'ES_TRAY_01_LAN' | 'BROWSER'

export const ESHOP_TRAY_02_CLIENT_TRACE_EVENTS = [
  'PRINT_CLICK',
  'PRINT_HTML_START',
  'PRINT_HTML_SUCCESS',
  'PRINT_HTML_FAILED',
  'ESC_POS_RENDER_START',
  'ESC_POS_RENDER_SUCCESS',
  'ESC_POS_RENDER_FAILED',
  'DIGEST_START',
  'DIGEST_SUCCESS',
  'DIGEST_FAILED',
  'BASE64_START',
  'BASE64_SUCCESS',
  'BASE64_FAILED',
  'CLOUD_SUBMIT_START',
  'CLOUD_SUBMIT_RESULT',
  'CLOUD_SUBMIT_FAILED',
] as const

export type EshopTray02ClientTraceEvent = typeof ESHOP_TRAY_02_CLIENT_TRACE_EVENTS[number]

type EshopTray02ClientTraceInput = {
  event: EshopTray02ClientTraceEvent
  orderNo?: string | null
  byteLength?: number
  httpStatus?: number
  error?: unknown
}

export function resolveEshopTray02PrintPath(
  cloudState: EshopTray02CloudEnableState,
  eshopTrayEnabled: boolean,
): EshopTray02PrintPath {
  if (cloudState === 'pending') return 'CONFIG_PENDING'
  if (cloudState === 'enabled') return 'CLOUD_RELAY'
  return eshopTrayEnabled ? 'ES_TRAY_01_LAN' : 'BROWSER'
}

export class EshopTray02CloudClientError extends Error {
  constructor(public readonly code: string, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'EshopTray02CloudClientError'
  }
}

function boundedTraceError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 64),
      message: error.message.slice(0, 160),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 160) }
}

function safeOrderRef(orderNo: string | null | undefined): string | undefined {
  if (!orderNo) return undefined
  const compact = orderNo.replace(/[^A-Za-z0-9_-]/g, '')
  return compact ? compact.slice(-16) : undefined
}

/** FIELD ONLY diagnostic trace. Delivery is best-effort and never gates printing. */
export async function traceEshopTray02ClientPrint(
  input: EshopTray02ClientTraceInput,
  fetchImpl: typeof apiFetch = apiFetch,
): Promise<void> {
  const orderRef = safeOrderRef(input.orderNo)
  const payload = {
    fieldOnly: true,
    productionContract: false,
    timestamp: new Date().toISOString(),
    event: input.event,
    ...(orderRef ? { orderRef } : {}),
    ...(Number.isSafeInteger(input.byteLength) && Number(input.byteLength) >= 0
      ? { byteLength: Number(input.byteLength) }
      : {}),
    ...(Number.isInteger(input.httpStatus) && Number(input.httpStatus) >= 100 && Number(input.httpStatus) <= 599
      ? { httpStatus: Number(input.httpStatus) }
      : {}),
    ...(input.error === undefined ? {} : { error: boundedTraceError(input.error) }),
  }

  console.info('[es-tray-02:field:client-trace]', payload)
  try {
    const response = await fetchImpl('/api/es-tray-02/client-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
    if (!response.ok) {
      console.warn('[es-tray-02:field:client-trace] delivery rejected', response.status)
    }
  } catch (error) {
    console.warn('[es-tray-02:field:client-trace] delivery failed', boundedTraceError(error))
  }
}

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `field-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stable = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', stable.buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

/** FIELD ONLY. Submits an already-encoded Print Command Stream over HTTPS. */
export async function submitEshopTray02CloudPrint(input: {
  orderNo: string
  commandStream: Uint8Array
  fetchImpl?: typeof apiFetch
}): Promise<{ jobId: string; requestId: string }> {
  void traceEshopTray02ClientPrint({
    event: 'CLOUD_SUBMIT_START',
    orderNo: input.orderNo,
    byteLength: input.commandStream?.byteLength,
  })
  try {
    if (!(input.commandStream instanceof Uint8Array) || input.commandStream.byteLength === 0) {
      throw new EshopTray02CloudClientError('ES_TRAY_02_INVALID_COMMAND_STREAM')
    }
    const requestId = createRequestId()
    let digest: string
    void traceEshopTray02ClientPrint({
      event: 'DIGEST_START',
      orderNo: input.orderNo,
      byteLength: input.commandStream.byteLength,
    })
    try {
      digest = await sha256Hex(input.commandStream)
      void traceEshopTray02ClientPrint({
        event: 'DIGEST_SUCCESS',
        orderNo: input.orderNo,
        byteLength: input.commandStream.byteLength,
      })
    } catch (cause) {
      void traceEshopTray02ClientPrint({
        event: 'DIGEST_FAILED',
        orderNo: input.orderNo,
        byteLength: input.commandStream.byteLength,
        error: cause,
      })
      throw new EshopTray02CloudClientError('ES_TRAY_02_COMMAND_DIGEST_FAILED', { cause })
    }

    let encodedCommandStream: string
    void traceEshopTray02ClientPrint({
      event: 'BASE64_START',
      orderNo: input.orderNo,
      byteLength: input.commandStream.byteLength,
    })
    try {
      encodedCommandStream = qzRawBytesToBase64(input.commandStream)
      void traceEshopTray02ClientPrint({
        event: 'BASE64_SUCCESS',
        orderNo: input.orderNo,
        byteLength: input.commandStream.byteLength,
      })
    } catch (cause) {
      void traceEshopTray02ClientPrint({
        event: 'BASE64_FAILED',
        orderNo: input.orderNo,
        byteLength: input.commandStream.byteLength,
        error: cause,
      })
      throw cause
    }

    const response = await (input.fetchImpl ?? apiFetch)('/api/es-tray-02/print-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relayVersion: RELAY_VERSION,
        requestId,
        orderNo: input.orderNo,
        documentName: `E-Shop ${input.orderNo}`.slice(0, 96),
        target: { transport: 'windows-queue', queueName: FIELD_QUEUE_NAME },
        commandStream: {
          encoding: 'base64',
          byteLength: input.commandStream.byteLength,
          sha256: digest,
          data: encodedCommandStream,
        },
      }),
    })
    void traceEshopTray02ClientPrint({
      event: 'CLOUD_SUBMIT_RESULT',
      orderNo: input.orderNo,
      byteLength: input.commandStream.byteLength,
      httpStatus: response.status,
    })
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (response.status !== 202) {
      throw new EshopTray02CloudClientError(
        typeof body?.error === 'string' ? body.error : 'ES_TRAY_02_SUBMIT_FAILED',
      )
    }
    if (
      body?.fieldOnly !== true
      || typeof body.jobId !== 'string'
      || body.requestId !== requestId
      || body.status !== 'PENDING_RECEIVE'
    ) throw new EshopTray02CloudClientError('ES_TRAY_02_INVALID_RESPONSE')
    return { jobId: body.jobId, requestId }
  } catch (error) {
    void traceEshopTray02ClientPrint({
      event: 'CLOUD_SUBMIT_FAILED',
      orderNo: input.orderNo,
      byteLength: input.commandStream?.byteLength,
      error,
    })
    throw error
  }
}
