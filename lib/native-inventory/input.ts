import { Prisma } from '@prisma/client'

export class InventoryError extends Error {
  constructor(readonly code: string, readonly status = 422) {
    super(code)
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InventoryError('INVALID_PAYLOAD')
  }
  return value as Record<string, unknown>
}

export function requiredText(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new InventoryError('INVALID_TEXT')
  }
  return value.trim()
}

export function optionalText(value: unknown, max = 120): string | null {
  return value == null || value === '' ? null : requiredText(value, max)
}

export function operationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) {
    throw new InventoryError('INVALID_OPERATION_ID')
  }
  return value
}

export function revision(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2147483646) {
    throw new InventoryError('INVALID_REVISION')
  }
  return value
}

export function decimal(value: unknown, options: { min?: number; nonzero?: boolean } = {}): Prisma.Decimal {
  if (typeof value !== 'string' || !/^-?\d{1,9}(\.\d{1,6})?$/.test(value)) {
    throw new InventoryError('INVALID_DECIMAL')
  }
  const parsed = new Prisma.Decimal(value)
  if ((options.min !== undefined && parsed.lt(options.min)) || (options.nonzero && parsed.isZero())) {
    throw new InventoryError('INVALID_DECIMAL')
  }
  return parsed
}

export function baseQuantity(quantity: Prisma.Decimal, factor: Prisma.Decimal): Prisma.Decimal {
  const base = quantity.mul(factor)
  if (base.decimalPlaces() > 6 || base.gte('1000000000000')) {
    throw new InventoryError('INVALID_BASE_QUANTITY')
  }
  return base
}
