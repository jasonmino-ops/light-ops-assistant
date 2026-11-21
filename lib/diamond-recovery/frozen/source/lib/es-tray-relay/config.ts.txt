export const ES_TRAY_RELAY_SCHEMA_VERSION = 1 as const
export const ES_TRAY_RELAY_VERSION = '0.1' as const
export const ES_TRAY_CLIENT_VERSION = '0.1.3' as const
export const ES_TRAY_CLIENT_VERSION_HEADER = 'x-es-tray-version' as const
export const ES_TRAY_QUEUE_NAME = '前台' as const
export const ES_TRAY_MAX_COMMAND_BYTES = 3 * 1024 * 1024

const DEFAULT_CLAIM_LEASE_MS = 30_000
const DEFAULT_EXECUTION_TIMEOUT_MS = 60_000
const DEFAULT_JOB_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 3

type RelayEnvironment = Readonly<Record<string, string | undefined>>

export type RelayTimingConfig = {
  claimLeaseMs: number
  executionTimeoutMs: number
  jobTtlMs: number
  maxAttempts: number
}

export class RelayConfigurationError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'RelayConfigurationError'
  }
}

function boundedInteger(
  env: RelayEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  if (!/^\d+$/.test(raw)) throw new RelayConfigurationError(`ES_TRAY_02_INVALID_${name}`)
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RelayConfigurationError(`ES_TRAY_02_INVALID_${name}`)
  }
  return parsed
}

export function readRelayTimingConfig(env: RelayEnvironment = process.env): RelayTimingConfig {
  return {
    claimLeaseMs: boundedInteger(env, 'ES_TRAY_02_CLAIM_LEASE_MS', DEFAULT_CLAIM_LEASE_MS, 5_000, 5 * 60_000),
    executionTimeoutMs: boundedInteger(env, 'ES_TRAY_02_EXECUTION_TIMEOUT_MS', DEFAULT_EXECUTION_TIMEOUT_MS, 20_000, 10 * 60_000),
    jobTtlMs: boundedInteger(env, 'ES_TRAY_02_JOB_TTL_MS', DEFAULT_JOB_TTL_MS, 60_000, 7 * 24 * 60 * 60 * 1000),
    maxAttempts: boundedInteger(env, 'ES_TRAY_02_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 10),
  }
}
