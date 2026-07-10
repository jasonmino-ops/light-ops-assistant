export type TelegramStartParamSource =
  | 'initDataUnsafe.start_param'
  | 'tgWebAppStartParam'
  | 'query.startapp'
  | 'query.start_param'
  | 'query.token'
  | 'initData.start_param'

export type TelegramStartParamResolution = {
  value: string
  raw: string
  source: TelegramStartParamSource
}

type ResolveInput = {
  initDataUnsafeStartParam?: unknown
  initData?: string
  search?: string
  hash?: string
}

function decodeStartParam(raw: string): string {
  let value = raw.trim()
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) break
      value = decoded.trim()
    } catch {
      break
    }
  }
  return value
}

function normalizeCandidate(
  raw: unknown,
  source: TelegramStartParamSource,
): TelegramStartParamResolution | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = decodeStartParam(trimmed)
  if (!value) return null
  return { value, raw: trimmed, source }
}

function paramsFrom(input: string | undefined, stripHash = false) {
  if (!input) return new URLSearchParams()
  const value = stripHash && input.startsWith('#') ? input.slice(1) : input
  return new URLSearchParams(value.startsWith('?') ? value.slice(1) : value)
}

export function resolveTelegramStartParam(input: ResolveInput): TelegramStartParamResolution | null {
  const searchParams = paramsFrom(input.search)
  const hashParams = paramsFrom(input.hash, true)
  const initDataParams = paramsFrom(input.initData)

  const candidates: Array<[unknown, TelegramStartParamSource]> = [
    [input.initDataUnsafeStartParam, 'initDataUnsafe.start_param'],
    [searchParams.get('tgWebAppStartParam') || hashParams.get('tgWebAppStartParam'), 'tgWebAppStartParam'],
    [searchParams.get('startapp') || hashParams.get('startapp'), 'query.startapp'],
    [searchParams.get('start_param') || hashParams.get('start_param'), 'query.start_param'],
    [searchParams.get('token') || hashParams.get('token'), 'query.token'],
    [initDataParams.get('start_param'), 'initData.start_param'],
  ]

  for (const [raw, source] of candidates) {
    const resolved = normalizeCandidate(raw, source)
    if (resolved) return resolved
  }
  return null
}

export function getBindTokenFromStartParam(value: string | null | undefined): string {
  const normalized = decodeStartParam(value ?? '')
  return normalized.startsWith('bind_') ? normalized.slice(5).trim() : ''
}

export function redactStartParam(value: string | null | undefined): string | null {
  const normalized = decodeStartParam(value ?? '')
  if (!normalized) return null
  const prefix = normalized.startsWith('bind_') ? 'bind_' : ''
  const body = prefix ? normalized.slice(prefix.length) : normalized
  return `${prefix}${body.slice(0, 6)}...len${body.length}`
}
