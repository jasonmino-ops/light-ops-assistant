'use client'

import { apiFetch } from './api'
import { desktopPosDeviceFetch } from './es-tray-device-client'
import { qzRawBytesToBase64 } from './qzEscPosBitImage'

const RELAY_VERSION = '0.1' as const
const RELAY_SCHEMA_VERSION = 1 as const
const RELAY_QUEUE_NAME = '前台' as const
const CONFIG_REQUEST_TIMEOUT_MS = 5_000
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export type EshopTray02CloudEnableState = 'pending' | 'enabled' | 'disabled'
export type EshopTray02Fetch = (input: string, init?: RequestInit) => Promise<Response>

export type EshopTray02PrintIntent = {
  orderNo: string
  requestId: string
  commandStream?: Uint8Array
}

export class EshopTray02CloudClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus?: number,
    options?: { cause?: unknown },
  ) {
    super(code, options)
    this.name = 'EshopTray02CloudClientError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function isEshopTray02CloudConfigEnabled(value: unknown): boolean {
  const body = object(value)
  return body?.fieldOnly === true && body.enabled === true
}

async function readCloudEnableState(
  endpoint: string,
  fetchImpl: EshopTray02Fetch,
  timeoutMs = CONFIG_REQUEST_TIMEOUT_MS,
): Promise<Exclude<EshopTray02CloudEnableState, 'pending'>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return 'disabled'
    const body = await response.json().catch(() => null)
    return isEshopTray02CloudConfigEnabled(body) ? 'enabled' : 'disabled'
  } catch {
    return 'disabled'
  } finally {
    clearTimeout(timeout)
  }
}

export function readEshopTray02CloudEnableState(
  fetchImpl: EshopTray02Fetch = apiFetch,
  timeoutMs = CONFIG_REQUEST_TIMEOUT_MS,
) {
  return readCloudEnableState('/api/es-tray-02/config', fetchImpl, timeoutMs)
}

export function readEshopTray02DeviceCloudEnableState(
  fetchImpl: EshopTray02Fetch = desktopPosDeviceFetch,
  timeoutMs = CONFIG_REQUEST_TIMEOUT_MS,
) {
  return readCloudEnableState('/api/es-tray-02/device/config', fetchImpl, timeoutMs)
}

function defaultRequestId(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new EshopTray02CloudClientError('ES_TRAY_02_RANDOM_UUID_UNAVAILABLE')
  }
  return `desktop-order-print:${crypto.randomUUID()}`
}

export function getOrCreateEshopTray02PrintIntent(
  current: EshopTray02PrintIntent | null,
  orderNo: string,
  createRequestId: () => string = defaultRequestId,
): EshopTray02PrintIntent {
  if (current?.orderNo === orderNo) return current
  const requestId = createRequestId()
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new EshopTray02CloudClientError('ES_TRAY_02_INVALID_IDEMPOTENCY_KEY')
  }
  return { orderNo, requestId }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stable = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', stable.buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function submitCloudPrint(input: {
  orderNo: string
  requestId: string
  commandStream: Uint8Array
  fetchImpl?: EshopTray02Fetch
}, endpoint: string, defaultFetch: EshopTray02Fetch): Promise<{
  jobId: string
  requestId: string
  created: boolean
}> {
  if (!(input.commandStream instanceof Uint8Array) || input.commandStream.byteLength === 0) {
    throw new EshopTray02CloudClientError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  }
  if (!REQUEST_ID_PATTERN.test(input.requestId)) {
    throw new EshopTray02CloudClientError('ES_TRAY_02_INVALID_IDEMPOTENCY_KEY')
  }

  const digest = await sha256Hex(input.commandStream).catch((cause) => {
    throw new EshopTray02CloudClientError('ES_TRAY_02_COMMAND_DIGEST_FAILED', undefined, { cause })
  })
  const response = await (input.fetchImpl ?? defaultFetch)(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      relayVersion: RELAY_VERSION,
      requestId: input.requestId,
      orderNo: input.orderNo,
      documentName: `E-Shop ${input.orderNo}`.slice(0, 96),
      target: { transport: 'windows-queue', queueName: RELAY_QUEUE_NAME },
      commandStream: {
        encoding: 'base64',
        byteLength: input.commandStream.byteLength,
        sha256: digest,
        data: qzRawBytesToBase64(input.commandStream),
      },
    }),
  }).catch((cause) => {
    throw new EshopTray02CloudClientError('ES_TRAY_02_SUBMIT_NETWORK_FAILED', undefined, { cause })
  })

  const body = object(await response.json().catch(() => null))
  if (response.status !== 202) {
    throw new EshopTray02CloudClientError(
      typeof body?.error === 'string' ? body.error : 'ES_TRAY_02_SUBMIT_FAILED',
      response.status,
    )
  }
  if (
    body?.fieldOnly !== true
    || body.productionContract !== true
    || body.schemaVersion !== RELAY_SCHEMA_VERSION
    || typeof body.jobId !== 'string'
    || body.requestId !== input.requestId
    || body.status !== 'PENDING_RECEIVE'
    || typeof body.created !== 'boolean'
  ) {
    throw new EshopTray02CloudClientError('ES_TRAY_02_INVALID_RESPONSE', response.status)
  }

  return {
    jobId: body.jobId,
    requestId: input.requestId,
    created: body.created,
  }
}

export function submitEshopTray02CloudPrint(input: {
  orderNo: string
  requestId: string
  commandStream: Uint8Array
  fetchImpl?: EshopTray02Fetch
}) {
  return submitCloudPrint(input, '/api/es-tray-02/print-jobs', apiFetch)
}

export function submitEshopTray02DeviceCloudPrint(input: {
  orderNo: string
  requestId: string
  commandStream: Uint8Array
  fetchImpl?: EshopTray02Fetch
}) {
  return submitCloudPrint(input, '/api/es-tray-02/device/print-jobs', desktopPosDeviceFetch)
}
