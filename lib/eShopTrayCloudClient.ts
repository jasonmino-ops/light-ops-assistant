'use client'

import { apiFetch } from './api'
import { qzRawBytesToBase64 } from './qzEscPosBitImage'

const RELAY_VERSION = '0.1' as const
const FIELD_QUEUE_NAME = '前台' as const

export class EshopTray02CloudClientError extends Error {
  constructor(public readonly code: string, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'EshopTray02CloudClientError'
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
  if (!(input.commandStream instanceof Uint8Array) || input.commandStream.byteLength === 0) {
    throw new EshopTray02CloudClientError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  }
  const requestId = createRequestId()
  let digest: string
  try {
    digest = await sha256Hex(input.commandStream)
  } catch (cause) {
    throw new EshopTray02CloudClientError('ES_TRAY_02_COMMAND_DIGEST_FAILED', { cause })
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
        data: qzRawBytesToBase64(input.commandStream),
      },
    }),
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
}
