import { validateRuntimeReceiptPayload } from '../../shared/printerPayload'
import type {
  StoreRuntimeBootstrap,
  StoreRuntimeCloudTask,
  StoreRuntimePrinterBinding,
  StoreRuntimeTaskResult,
} from './types'

const DEFAULT_TIMEOUT_MS = 12_000
const MAX_RESPONSE_CHARS = 128 * 1024
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/

export type StoreRuntimeFetch = (input: string, init: RequestInit) => Promise<Response>

export class StoreRuntimeCloudError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(code)
    this.name = 'StoreRuntimeCloudError'
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreRuntimeCloudError('CLOUD_RESPONSE_INVALID')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new StoreRuntimeCloudError(code)
}

function text(value: unknown, code = 'CLOUD_RESPONSE_INVALID'): string {
  if (typeof value !== 'string' || !value) throw new StoreRuntimeCloudError(code)
  return value
}

function parseBinding(value: unknown): StoreRuntimePrinterBinding | null {
  if (value === null) return null
  const binding = record(value)
  exactKeys(binding, ['id', 'tenantId', 'storeId', 'targetType', 'printerName', 'enabled', 'version', 'updatedAt'], 'CLOUD_BINDING_INVALID')
  if (
    binding.targetType !== 'WINDOWS_QUEUE' ||
    typeof binding.enabled !== 'boolean' ||
    typeof binding.version !== 'number' ||
    !Number.isInteger(binding.version) || binding.version < 1 ||
    typeof binding.updatedAt !== 'string'
  ) {
    throw new StoreRuntimeCloudError('CLOUD_BINDING_INVALID')
  }
  return {
    id: text(binding.id, 'CLOUD_BINDING_INVALID'),
    tenantId: text(binding.tenantId, 'CLOUD_BINDING_INVALID'),
    storeId: text(binding.storeId, 'CLOUD_BINDING_INVALID'),
    targetType: 'WINDOWS_QUEUE',
    printerName: text(binding.printerName, 'CLOUD_BINDING_INVALID'),
    enabled: binding.enabled,
    version: binding.version,
    updatedAt: binding.updatedAt,
  }
}

function parseDevice(value: unknown): StoreRuntimeBootstrap['runtime']['device'] {
  const device = record(value)
  exactKeys(device, ['deviceId', 'tenantId', 'storeId', 'storeCode', 'status', 'tokenExpiresAt', 'credentialVersion'], 'CLOUD_IDENTITY_INVALID')
  if (typeof device.credentialVersion !== 'number') throw new StoreRuntimeCloudError('CLOUD_IDENTITY_INVALID')
  return {
    deviceId: text(device.deviceId, 'CLOUD_IDENTITY_INVALID'),
    tenantId: text(device.tenantId, 'CLOUD_IDENTITY_INVALID'),
    storeId: text(device.storeId, 'CLOUD_IDENTITY_INVALID'),
    storeCode: text(device.storeCode, 'CLOUD_IDENTITY_INVALID'),
    status: text(device.status, 'CLOUD_IDENTITY_INVALID'),
    tokenExpiresAt: text(device.tokenExpiresAt, 'CLOUD_IDENTITY_INVALID'),
    credentialVersion: device.credentialVersion,
  }
}

function parseBootstrap(value: unknown): StoreRuntimeBootstrap {
  const body = record(value)
  const runtime = record(body.runtime)
  const store = record(runtime.store)
  return {
    runtime: {
      device: parseDevice(runtime.device),
      store: {
        id: text(store.id, 'CLOUD_IDENTITY_INVALID'),
        code: text(store.code, 'CLOUD_IDENTITY_INVALID'),
        name: text(store.name, 'CLOUD_IDENTITY_INVALID'),
        status: text(store.status, 'CLOUD_IDENTITY_INVALID'),
      },
    },
    binding: parseBinding(body.binding),
  }
}

function parseTask(value: unknown): StoreRuntimeCloudTask | null {
  if (value === null) return null
  const task = record(value)
  const payload = record(task.payload)
  const binding = record(task.printerBinding)
  exactKeys(task, [
    'id', 'tenantId', 'storeId', 'taskType', 'schemaVersion', 'idempotencyKey', 'payload',
    'printerBinding', 'status', 'claimedByDeviceId', 'leaseExpiresAt', 'attemptCount',
    'acceptedAt', 'executingAt', 'completedAt', 'result', 'createdAt', 'updatedAt',
  ], 'CLOUD_TASK_INVALID')
  exactKeys(payload, ['receipt'], 'CLOUD_TASK_INVALID')
  exactKeys(binding, ['id', 'version', 'targetType', 'printerName'], 'CLOUD_TASK_INVALID')
  validateRuntimeReceiptPayload(payload.receipt)
  if (
    task.taskType !== 'PRINT_RECEIPT' ||
    task.schemaVersion !== 1 ||
    task.status !== 'ACCEPTED' ||
    binding.targetType !== 'WINDOWS_QUEUE' ||
    typeof binding.version !== 'number' || !Number.isInteger(binding.version) || binding.version < 1 ||
    typeof task.attemptCount !== 'number' || !Number.isInteger(task.attemptCount) || task.attemptCount < 1 ||
    typeof task.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(task.idempotencyKey)
  ) {
    throw new StoreRuntimeCloudError('CLOUD_TASK_INVALID')
  }
  return {
    id: text(task.id, 'CLOUD_TASK_INVALID'),
    tenantId: text(task.tenantId, 'CLOUD_TASK_INVALID'),
    storeId: text(task.storeId, 'CLOUD_TASK_INVALID'),
    taskType: 'PRINT_RECEIPT',
    schemaVersion: 1,
    idempotencyKey: text(task.idempotencyKey, 'CLOUD_TASK_INVALID'),
    payload: { receipt: payload.receipt },
    printerBinding: {
      id: text(binding.id, 'CLOUD_TASK_INVALID'),
      version: binding.version,
      targetType: 'WINDOWS_QUEUE',
      printerName: text(binding.printerName, 'CLOUD_TASK_INVALID'),
    },
    status: 'ACCEPTED',
    claimedByDeviceId: text(task.claimedByDeviceId, 'CLOUD_TASK_INVALID'),
    leaseExpiresAt: text(task.leaseExpiresAt, 'CLOUD_TASK_INVALID'),
    attemptCount: task.attemptCount,
  }
}

export class StoreRuntimeCloudClient {
  private readonly baseUrl: string
  private readonly fetchImpl: StoreRuntimeFetch
  private readonly timeoutMs: number

  constructor(options: {
    baseUrl: string
    deviceToken: string
    fetchImpl?: StoreRuntimeFetch
    timeoutMs?: number
  }) {
    this.baseUrl = secureCloudBaseUrl(options.baseUrl)
    this.deviceToken = options.deviceToken
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private readonly deviceToken: string

  async bootstrap(): Promise<StoreRuntimeBootstrap> {
    return parseBootstrap(await this.post('/api/store-runtime/runtime/bootstrap'))
  }

  async heartbeat(): Promise<StoreRuntimePrinterBinding | null> {
    const body = record(await this.post('/api/store-runtime/runtime/heartbeat'))
    if (body.ok !== true) throw new StoreRuntimeCloudError('CLOUD_RESPONSE_INVALID')
    return parseBinding(body.binding)
  }

  async claimTask(): Promise<{ binding: StoreRuntimePrinterBinding | null; task: StoreRuntimeCloudTask | null }> {
    const body = record(await this.post('/api/store-runtime/runtime/tasks/claim'))
    return { binding: parseBinding(body.binding), task: parseTask(body.task) }
  }

  async markExecuting(taskId: string): Promise<void> {
    await this.post(`/api/store-runtime/runtime/tasks/${encodeURIComponent(taskId)}/status`, { state: 'EXECUTING' })
  }

  async reportResult(taskId: string, result: StoreRuntimeTaskResult): Promise<void> {
    await this.post(`/api/store-runtime/runtime/tasks/${encodeURIComponent(taskId)}/status`, result)
  }

  private async post(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.deviceToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const raw = await response.text()
      if (raw.length > MAX_RESPONSE_CHARS) throw new StoreRuntimeCloudError('CLOUD_RESPONSE_TOO_LARGE', response.status)
      let parsed: unknown
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        throw new StoreRuntimeCloudError('CLOUD_RESPONSE_INVALID', response.status)
      }
      if (!response.ok) {
        const value = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {}
        throw new StoreRuntimeCloudError(typeof value.error === 'string' ? value.error : 'CLOUD_REQUEST_FAILED', response.status)
      }
      return parsed
    } catch (error) {
      if (error instanceof StoreRuntimeCloudError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new StoreRuntimeCloudError('CLOUD_REQUEST_TIMEOUT')
      throw new StoreRuntimeCloudError('CLOUD_NETWORK_ERROR')
    } finally {
      clearTimeout(timer)
    }
  }
}

function secureCloudBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new StoreRuntimeCloudError('CLOUD_BASE_URL_INVALID')
  }
  const localDevelopment = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localDevelopment)) {
    throw new StoreRuntimeCloudError('CLOUD_BASE_URL_INSECURE')
  }
  return url.toString().replace(/\/+$/, '')
}
