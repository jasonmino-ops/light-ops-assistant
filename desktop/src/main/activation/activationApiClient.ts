import type {
  CloudActivateResult,
  CloudApiFailure,
  CloudVerifyResult,
  PublicDeviceIdentity,
  PublicSubscriptionState,
} from './activationTypes'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_RESPONSE_CHARS = 64 * 1024

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type ActivationApiClientOptions = {
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseSubscription(value: unknown): PublicSubscriptionState | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.accessState === 'string' &&
    typeof value.status === 'string' &&
    (value.warning === null || typeof value.warning === 'string')
  ) {
    return {
      accessState: value.accessState,
      status: value.status,
      warning: value.warning,
    }
  }
  return undefined
}

function parseDevice(value: unknown): PublicDeviceIdentity | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.deviceId === 'string' &&
    typeof value.tenantId === 'string' &&
    typeof value.storeId === 'string' &&
    typeof value.storeCode === 'string' &&
    typeof value.status === 'string' &&
    typeof value.tokenExpiresAt === 'string' &&
    typeof value.credentialVersion === 'number'
  ) {
    return {
      deviceId: value.deviceId,
      tenantId: value.tenantId,
      storeId: value.storeId,
      storeCode: value.storeCode,
      status: value.status,
      tokenExpiresAt: value.tokenExpiresAt,
      credentialVersion: value.credentialVersion,
    }
  }
  return undefined
}

function failure(
  kind: CloudApiFailure['kind'],
  errorCode: string,
  extra?: Omit<CloudApiFailure, 'ok' | 'kind' | 'errorCode'>,
): CloudApiFailure {
  return { ok: false, kind, errorCode, ...(extra ?? {}) }
}

async function readJsonSafely(response: Response): Promise<{ ok: true; body: unknown } | { ok: false; reason: 'too-large' | 'malformed' }> {
  const text = await response.text()
  if (text.length > MAX_RESPONSE_CHARS) return { ok: false, reason: 'too-large' }
  try {
    return { ok: true, body: text ? JSON.parse(text) : null }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

function cloudErrorFromBody(response: Response, body: unknown): CloudApiFailure {
  if (!isRecord(body) || typeof body.error !== 'string') {
    return failure('SCHEMA', 'MALFORMED_RESPONSE', { status: response.status })
  }
  const retryAfterSeconds = typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined
  const subscription = parseSubscription(body.subscription)
  return failure('HTTP', body.error, {
    status: response.status,
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    ...(subscription ? { subscription } : {}),
  })
}

export class ActivationApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: FetchLike

  constructor(options: ActivationApiClientOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  activate(input: { storeCode: string; pin: string; installationId: string }): Promise<CloudActivateResult> {
    return this.requestActivate(input)
  }

  verify(input: { deviceToken: string }): Promise<CloudVerifyResult> {
    return this.requestVerify(input)
  }

  private async requestActivate(input: { storeCode: string; pin: string; installationId: string }): Promise<CloudActivateResult> {
    const result = await this.postJson('/api/desktop/activate', {
      storeCode: input.storeCode,
      pin: input.pin,
      installationId: input.installationId,
    })
    if (!result.ok) return result.failure
    if (!result.response.ok) return cloudErrorFromBody(result.response, result.body)
    if (!isRecord(result.body)) return failure('SCHEMA', 'MALFORMED_RESPONSE', { status: result.response.status })
    const device = parseDevice(result.body.device)
    const subscription = parseSubscription(result.body.subscription)
    if (
      typeof result.body.deviceToken !== 'string' ||
      result.body.deviceToken.length < 24 ||
      typeof result.body.tokenExpiresAt !== 'string' ||
      !device ||
      !subscription
    ) {
      return failure('SCHEMA', 'MALFORMED_RESPONSE', { status: result.response.status })
    }
    return {
      ok: true,
      deviceToken: result.body.deviceToken,
      tokenExpiresAt: result.body.tokenExpiresAt,
      device,
      subscription,
    }
  }

  private async requestVerify(input: { deviceToken: string }): Promise<CloudVerifyResult> {
    const result = await this.postJson('/api/desktop/auth/verify', undefined, {
      Authorization: `Bearer ${input.deviceToken}`,
    })
    if (!result.ok) return result.failure
    if (!result.response.ok) return cloudErrorFromBody(result.response, result.body)
    if (!isRecord(result.body) || result.body.ok !== true) {
      return failure('SCHEMA', 'MALFORMED_RESPONSE', { status: result.response.status })
    }
    const device = parseDevice(result.body.device)
    const subscription = parseSubscription(result.body.subscription)
    if (!device || !subscription) {
      return failure('SCHEMA', 'MALFORMED_RESPONSE', { status: result.response.status })
    }
    return { ok: true, device, subscription }
  }

  private async postJson(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<
    | { ok: true; response: Response; body: unknown }
    | { ok: false; failure: CloudApiFailure }
  > {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(headers ?? {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const parsed = await readJsonSafely(response)
      if (!parsed.ok) {
        return {
          ok: false,
          failure: failure(parsed.reason === 'malformed' ? 'MALFORMED_JSON' : 'SCHEMA', 'MALFORMED_RESPONSE', {
            status: response.status,
          }),
        }
      }
      return { ok: true, response, body: parsed.body }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      return {
        ok: false,
        failure: failure(isAbort ? 'TIMEOUT' : 'NETWORK', isAbort ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR'),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
