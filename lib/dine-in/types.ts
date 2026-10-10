import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'

/** Same shape the existing network print contract uses for request ids. */
export const DINE_IN_REQUEST_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export type DiningRole = 'OWNER' | 'STAFF'
export type DiningPaymentMethod = 'CASH' | 'KHQR'
export type DiningScope = { tenantId: string; storeId: string }
export type DiningActor = { userId: string; role: DiningRole }

/**
 * A refusal the caller can act on. `audit` marks refusals that must leave a FAILED
 * OperationLog row; it is written outside the rolled-back transaction.
 */
export class DiningCommandError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 409,
    public readonly details?: unknown,
    public readonly audit?: { actionType: string; targetType: string; targetId: string; requestId?: string; payload?: unknown },
  ) {
    super(code)
    this.name = 'DiningCommandError'
  }
}

export function requireRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !DINE_IN_REQUEST_KEY_PATTERN.test(value)) {
    throw new DiningCommandError('REQUEST_KEY_REQUIRED', 400)
  }
  return value
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return value
}

/** SHA-256 over the canonical business content of a request. */
export function requestDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/** Money leaves the server as a fixed two-decimal string so equality is exact. */
export function money(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2)
}

export function parseMoney(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null
  return new Prisma.Decimal(value)
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function isUniqueViolation(error: unknown, ...needles: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  if (needles.length === 0) return true
  const evidence = `${error.message}\n${JSON.stringify(error.meta ?? {})}`
  return needles.some((needle) => evidence.includes(needle))
}
