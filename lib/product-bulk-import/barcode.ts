import { createHash } from 'node:crypto'

const INTERNAL_PREFIX = '29'

export function ean13CheckDigit(firstTwelveDigits: string): string {
  if (!/^\d{12}$/.test(firstTwelveDigits)) throw new Error('EAN13_BODY_INVALID')
  let sum = 0
  for (let index = 0; index < firstTwelveDigits.length; index += 1) {
    const digit = Number(firstTwelveDigits[index])
    sum += digit * (index % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === value[12]
}

/**
 * Produces a deterministic E-Shop internal EAN-13 candidate. It is scan-safe,
 * but is not represented as a globally registered GTIN.
 */
export function internalEan13Candidate(identity: string, attempt = 0): string {
  const digest = createHash('sha256').update(`eshop-internal-ean13:v1:${identity}:${attempt}`).digest('hex')
  // Thirteen hex digits fit inside JavaScript's exact integer range, avoiding
  // BigInt syntax because this repository still targets ES2017.
  const value = Number.parseInt(digest.slice(0, 13), 16) % 10_000_000_000
  const body = `${INTERNAL_PREFIX}${value.toString().padStart(10, '0')}`
  return body + ean13CheckDigit(body)
}

export function stableRowIdentity(parts: Array<string | number | null | undefined>): string {
  return createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
}
