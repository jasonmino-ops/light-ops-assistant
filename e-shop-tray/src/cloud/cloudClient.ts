import type { CloudTask, DeviceIdentity, TaskResult } from './types'
import { FIELD_STORE_CODE } from './types'

const MAX_RESPONSE_CHARS = 64 * 1024

export class CloudRelayError extends Error {
  constructor(public readonly code: string, public readonly status?: number, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'CloudRelayError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function device(value: unknown): DeviceIdentity | null {
  const row = object(value)
  if (!row || typeof row.deviceId !== 'string' || typeof row.tenantId !== 'string' || typeof row.storeId !== 'string'
    || typeof row.storeCode !== 'string' || typeof row.status !== 'string' || typeof row.tokenExpiresAt !== 'string'
    || typeof row.credentialVersion !== 'number') return null
  return row as DeviceIdentity
}

function cloudTask(value: unknown): CloudTask | null {
  const task = object(value)
  const payload = object(task?.payload)
  const target = object(task?.target)
  const stream = object(payload?.commandStream)
  const payloadTarget = object(payload?.target)
  if (
    !task || !payload || !target || !stream || !payloadTarget
    || typeof task.id !== 'string' || task.taskId !== task.id
    || typeof task.storeId !== 'string' || task.storeCode !== FIELD_STORE_CODE
    || task.taskType !== 'PRINT_ESC_POS' || task.schemaVersion !== 1
    || typeof task.idempotencyKey !== 'string' || task.status !== 'CLAIMED'
    || typeof task.claimedByDeviceId !== 'string' || typeof task.leaseExpiresAt !== 'string'
    || typeof task.attemptCount !== 'number'
    || payload.storeCode !== FIELD_STORE_CODE || typeof payload.documentName !== 'string'
    || payloadTarget.type !== 'WINDOWS_QUEUE' || payloadTarget.name !== '前台'
    || target.type !== 'WINDOWS_QUEUE' || target.name !== '前台'
    || stream.encoding !== 'base64' || typeof stream.byteLength !== 'number'
    || typeof stream.sha256 !== 'string' || typeof stream.data !== 'string'
  ) return null
  return task as unknown as CloudTask
}

export class CloudRelayClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    const normalized = options.baseUrl.replace(/\/+$/, '')
    if (!normalized.startsWith('https://') && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(normalized)) {
      throw new CloudRelayError('CLOUD_HTTPS_REQUIRED')
    }
    this.baseUrl = normalized
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async activate(pin: string, installationId: string): Promise<{ token: string; device: DeviceIdentity }> {
    const body = await this.request('/api/desktop/activate', {
      body: { storeCode: FIELD_STORE_CODE, pin, installationId },
    })
    const row = object(body)
    const identity = device(row?.device)
    if (!row || typeof row.deviceToken !== 'string' || row.deviceToken.length < 24 || !identity || identity.storeCode !== FIELD_STORE_CODE) {
      throw new CloudRelayError('CLOUD_INVALID_ACTIVATION_RESPONSE')
    }
    return { token: row.deviceToken, device: identity }
  }

  async bootstrap(token: string): Promise<DeviceIdentity> {
    const body = await this.request('/api/store-runtime/runtime/bootstrap', { token })
    const row = object(body)
    const runtime = object(row?.runtime)
    const identity = device(runtime?.device)
    if (!identity || identity.storeCode !== FIELD_STORE_CODE) throw new CloudRelayError('CLOUD_RUNTIME_SCOPE_MISMATCH')
    return identity
  }

  async claim(token: string): Promise<CloudTask | null> {
    const body = await this.request('/api/store-runtime/runtime/tasks/claim', { token })
    const row = object(body)
    if (!row || !('task' in row)) throw new CloudRelayError('CLOUD_INVALID_CLAIM_RESPONSE')
    if (row.task === null) return null
    const task = cloudTask(row.task)
    if (!task) throw new CloudRelayError('CLOUD_INVALID_TASK')
    return task
  }

  async markExecuting(token: string, taskId: string): Promise<void> {
    await this.request(`/api/store-runtime/runtime/tasks/${encodeURIComponent(taskId)}/status`, { token, body: { state: 'EXECUTING' } })
  }

  async report(token: string, taskId: string, result: TaskResult): Promise<void> {
    await this.request(`/api/store-runtime/runtime/tasks/${encodeURIComponent(taskId)}/status`, { token, body: result })
  }

  private async request(path: string, input: { token?: string; body?: unknown }): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
      })
      const text = await response.text()
      if (text.length > MAX_RESPONSE_CHARS) throw new CloudRelayError('CLOUD_RESPONSE_TOO_LARGE', response.status)
      let body: unknown
      try { body = text ? JSON.parse(text) : null } catch { throw new CloudRelayError('CLOUD_MALFORMED_RESPONSE', response.status) }
      if (!response.ok) {
        const row = object(body)
        throw new CloudRelayError(typeof row?.error === 'string' ? row.error : 'CLOUD_REQUEST_FAILED', response.status)
      }
      return body
    } catch (error) {
      if (error instanceof CloudRelayError) throw error
      const code = error instanceof Error && error.name === 'AbortError' ? 'CLOUD_REQUEST_TIMEOUT' : 'CLOUD_NETWORK_ERROR'
      throw new CloudRelayError(code, undefined, { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }
}
