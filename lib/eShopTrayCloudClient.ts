import { apiFetch } from './api'
import { qzRawBytesToBase64 } from './qzEscPosBitImage'

export type EshopTrayCloudTask = {
  id: string
  taskId: string
  storeCode: string
  status: 'ACCEPTED' | 'CLAIMED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED'
  idempotencyKey: string
}

export class EshopTrayCloudClientError extends Error {
  constructor(public readonly code: string, public readonly submissionUncertain: boolean, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'EshopTrayCloudClientError'
  }
}

function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `field-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stable = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', stable.buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function taskFrom(value: unknown): EshopTrayCloudTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as { task?: Partial<EshopTrayCloudTask> }
  const task = body.task
  if (
    !task
    || typeof task.id !== 'string'
    || typeof task.taskId !== 'string'
    || typeof task.storeCode !== 'string'
    || typeof task.status !== 'string'
    || typeof task.idempotencyKey !== 'string'
  ) return null
  return task as EshopTrayCloudTask
}

export async function submitEshopTrayCloudPrint(input: {
  storeCode: string
  orderNo: string
  commandStream: Uint8Array
  fetchImpl?: typeof apiFetch
  requestId?: string
}): Promise<EshopTrayCloudTask> {
  if (!(input.commandStream instanceof Uint8Array) || input.commandStream.byteLength === 0) {
    throw new EshopTrayCloudClientError('INVALID_COMMAND_STREAM', false)
  }
  const id = input.requestId ?? requestId()
  let digest: string
  try {
    digest = await sha256Hex(input.commandStream)
  } catch (cause) {
    throw new EshopTrayCloudClientError('COMMAND_STREAM_DIGEST_FAILED', false, { cause })
  }
  const body = {
    taskType: 'PRINT_ESC_POS',
    schemaVersion: 1,
    idempotencyKey: `eshop-tray:${input.orderNo}:${id}`,
    storeCode: input.storeCode,
    target: { type: 'WINDOWS_QUEUE', name: '前台' },
    documentName: `E-Shop ${input.orderNo}`.slice(0, 96),
    commandStream: {
      encoding: 'base64',
      byteLength: input.commandStream.byteLength,
      sha256: digest,
      data: qzRawBytesToBase64(input.commandStream),
    },
  }
  let response: Response
  try {
    response = await (input.fetchImpl ?? apiFetch)('/api/store-runtime/print-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    throw new EshopTrayCloudClientError('CLOUD_PRINT_SUBMISSION_UNKNOWN', true, { cause })
  }
  const value = await response.json().catch(() => null) as { error?: unknown } | null
  if (!response.ok) {
    throw new EshopTrayCloudClientError(typeof value?.error === 'string' ? value.error : 'CLOUD_PRINT_REJECTED', false)
  }
  const task = taskFrom(value)
  if (!task || task.storeCode !== input.storeCode) {
    throw new EshopTrayCloudClientError('CLOUD_PRINT_INVALID_RESPONSE', true)
  }
  return task
}
