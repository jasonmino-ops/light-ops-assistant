import { createHash } from 'node:crypto'

export const ES_TRAY_POLL_INTERVAL_MS = 2_000
export const ES_TRAY_SCHEMA_VERSION = 1 as const
export const ES_TRAY_CLIENT_VERSION = '0.1.3' as const
const ES_TRAY_RELAY_VERSION = '0.1'
const ES_TRAY_QUEUE_NAME = '前台'
const ES_TRAY_MAX_COMMAND_BYTES = 3 * 1024 * 1024
const MAX_RESPONSE_CHARACTERS = 5 * 1024 * 1024
const CLAIM_TOKEN_PATTERN = /^ecp_v1_[A-Za-z0-9_-]{43}$/

type RelayEnvironment = Readonly<Record<string, string | undefined>>

export type CloudRelayConfig = { baseUrl: string }
export type DesktopBindingCredential = { installationId: string; deviceSecret: string }
export type RelayEffectBoundary = 'NOT_CROSSED' | 'CROSSING_UNKNOWN' | 'CROSSED'

export type ReceivedPrintJob = {
  id: string
  schemaVersion: 1
  idempotencyKey: string
  requestHash: string
  requestId: string
  orderNo: string
  documentName: string
  commandStream: Uint8Array
  claimAttempt: number
  claimToken: string
  leaseExpiresAt: string
}

export type TerminalResult = {
  state: 'SUCCEEDED' | 'FAILED'
  resultCode: string
  resultMessage?: string
  effectBoundary: RelayEffectBoundary
  physicalCompletionKnown: false
}

export class CloudRelayError extends Error {
  public readonly httpStatus?: number

  constructor(public readonly code: string, options?: { cause?: unknown; httpStatus?: number }) {
    super(code, options)
    this.name = 'CloudRelayError'
    this.httpStatus = options?.httpStatus
  }
}

const PERMANENT_TERMINAL_REJECTION_CODES = new Set([
  'ES_TRAY_02_STALE_CLAIM',
  'ES_TRAY_02_RESULT_CONFLICT',
  'ES_TRAY_02_JOB_NOT_EXECUTING',
])

/** A terminal ACK the same claim can never make valid by retrying. */
export function isPermanentTerminalRejection(error: unknown) {
  return error instanceof CloudRelayError
    && (
      error.httpStatus === 400
      || (error.httpStatus === 409 && PERMANENT_TERMINAL_REJECTION_CODES.has(error.code))
    )
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readCloudRelayConfig(env: RelayEnvironment = process.env): CloudRelayConfig | null {
  const rawUrl = env.ES_TRAY_02_CLOUD_URL?.trim() ?? ''
  try {
    const url = new URL(rawUrl)
    const localDevelopment = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localDevelopment) return null
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      return null
    }
    return { baseUrl: url.origin }
  } catch {
    return null
  }
}

function decodeCommandStream(value: unknown): Uint8Array {
  const stream = object(value)
  if (
    !stream
    || stream.encoding !== 'base64'
    || !Number.isInteger(stream.byteLength)
    || Number(stream.byteLength) < 1
    || Number(stream.byteLength) > ES_TRAY_MAX_COMMAND_BYTES
    || typeof stream.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(stream.sha256)
    || typeof stream.data !== 'string'
    || stream.data.length === 0
    || stream.data.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stream.data)
  ) throw new CloudRelayError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  const bytes = Buffer.from(stream.data, 'base64')
  if (bytes.toString('base64') !== stream.data || bytes.byteLength !== Number(stream.byteLength)) {
    throw new CloudRelayError('ES_TRAY_02_COMMAND_LENGTH_MISMATCH')
  }
  if (createHash('sha256').update(bytes).digest('hex') !== stream.sha256) {
    throw new CloudRelayError('ES_TRAY_02_COMMAND_DIGEST_MISMATCH')
  }
  return Uint8Array.from(bytes)
}

function parseReceivedJob(value: unknown): ReceivedPrintJob | null {
  const body = object(value)
  if (!body || body.productionContract !== true || body.schemaVersion !== 1 || !('job' in body)) {
    throw new CloudRelayError('ES_TRAY_02_INVALID_RESPONSE')
  }
  if (body.job === null) return null
  const job = object(body.job)
  const request = object(job?.request)
  const target = object(request?.target)
  const stream = object(request?.commandStream)
  if (
    !job
    || !request
    || !target
    || !stream
    || typeof job.id !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(job.id)
    || job.schemaVersion !== 1
    || typeof job.idempotencyKey !== 'string'
    || job.idempotencyKey !== request.requestId
    || typeof job.requestHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(job.requestHash)
    || !Number.isSafeInteger(job.claimAttempt)
    || Number(job.claimAttempt) < 1
    || typeof job.claimToken !== 'string'
    || !CLAIM_TOKEN_PATTERN.test(job.claimToken)
    || typeof job.leaseExpiresAt !== 'string'
    || !Number.isFinite(Date.parse(job.leaseExpiresAt))
    || request.relayVersion !== ES_TRAY_RELAY_VERSION
    || typeof request.requestId !== 'string'
    || typeof request.orderNo !== 'string'
    || typeof request.documentName !== 'string'
    || request.documentName.length === 0
    || request.documentName.length > 96
    || target.transport !== 'windows-queue'
    || target.queueName !== ES_TRAY_QUEUE_NAME
  ) throw new CloudRelayError('ES_TRAY_02_INVALID_JOB')

  const normalizedRequest = {
    relayVersion: ES_TRAY_RELAY_VERSION,
    requestId: request.requestId,
    orderNo: request.orderNo,
    documentName: request.documentName,
    target: { transport: 'windows-queue', queueName: ES_TRAY_QUEUE_NAME },
    commandStream: {
      encoding: stream.encoding,
      byteLength: stream.byteLength,
      sha256: stream.sha256,
      data: stream.data,
    },
  }
  const requestHash = createHash('sha256').update(JSON.stringify(normalizedRequest)).digest('hex')
  if (requestHash !== job.requestHash) throw new CloudRelayError('ES_TRAY_02_REQUEST_HASH_MISMATCH')

  return {
    id: job.id,
    schemaVersion: 1,
    idempotencyKey: job.idempotencyKey,
    requestHash: job.requestHash,
    requestId: request.requestId,
    orderNo: request.orderNo,
    documentName: request.documentName,
    commandStream: decodeCommandStream(request.commandStream),
    claimAttempt: Number(job.claimAttempt),
    claimToken: job.claimToken,
    leaseExpiresAt: job.leaseExpiresAt,
  }
}

function boundedErrorCode(value: unknown, fallback: string) {
  const body = object(value)
  return typeof body?.error === 'string' && /^[A-Z0-9_:-]{3,160}$/.test(body.error)
    ? body.error
    : fallback
}

export class CloudRelayClient {
  constructor(private readonly options: {
    config: CloudRelayConfig
    credential: DesktopBindingCredential
    fetchImpl?: typeof fetch
    timeoutMs?: number
  }) {}

  private headers(json = false) {
    return {
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      'x-installation-id': this.options.credential.installationId,
      'x-es-tray-version': ES_TRAY_CLIENT_VERSION,
      Authorization: `Bearer ${this.options.credential.deviceSecret}`,
    }
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000)
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${this.options.config.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(body !== undefined),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
      const text = await response.text()
      if (text.length > MAX_RESPONSE_CHARACTERS) throw new CloudRelayError('ES_TRAY_02_RESPONSE_TOO_LARGE')
      let parsed: unknown
      try {
        parsed = text ? JSON.parse(text) : null
      } catch (cause) {
        throw new CloudRelayError('ES_TRAY_02_MALFORMED_RESPONSE', { cause })
      }
      if (!response.ok) {
        throw new CloudRelayError(boundedErrorCode(parsed, 'ES_TRAY_02_REQUEST_FAILED'), {
          httpStatus: response.status,
        })
      }
      return parsed
    } catch (error) {
      if (error instanceof CloudRelayError) throw error
      throw new CloudRelayError(
        error instanceof Error && error.name === 'AbortError'
          ? 'ES_TRAY_02_REQUEST_TIMEOUT'
          : 'ES_TRAY_02_NETWORK_ERROR',
        { cause: error },
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async receive(): Promise<ReceivedPrintJob | null> {
    return parseReceivedJob(await this.request('/api/es-tray-02/print-jobs/receive'))
  }

  async markExecuting(job: Pick<ReceivedPrintJob, 'id' | 'claimAttempt' | 'claimToken'>) {
    const response = object(await this.request(`/api/es-tray-02/print-jobs/${encodeURIComponent(job.id)}/executing`, {
      schemaVersion: ES_TRAY_SCHEMA_VERSION,
      claimAttempt: job.claimAttempt,
      claimToken: job.claimToken,
    }))
    const state = object(response?.job)?.status
    if (response?.productionContract !== true || state !== 'EXECUTING') {
      throw new CloudRelayError('ES_TRAY_02_INVALID_EXECUTING_RESPONSE')
    }
  }

  async reportResult(
    job: Pick<ReceivedPrintJob, 'id' | 'claimAttempt' | 'claimToken'>,
    result: TerminalResult,
  ) {
    const response = object(await this.request(`/api/es-tray-02/print-jobs/${encodeURIComponent(job.id)}/result`, {
      schemaVersion: ES_TRAY_SCHEMA_VERSION,
      claimAttempt: job.claimAttempt,
      claimToken: job.claimToken,
      ...result,
    }))
    const state = object(response?.job)?.status
    if (response?.productionContract !== true || state !== result.state) {
      throw new CloudRelayError('ES_TRAY_02_INVALID_RESULT_RESPONSE')
    }
  }
}
