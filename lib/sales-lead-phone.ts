import crypto from 'node:crypto'
import { normalizeMemberPhone } from '@/lib/member-phone'

export type SalesLeadPhoneError = 'PHONE_REQUIRED' | 'PHONE_INVALID'

export type SalesLeadPhoneResult =
  | { ok: true; normalizedPhone: string }
  | { ok: false; error: SalesLeadPhoneError }

/**
 * Sales Lead phone guard. The canonical normalization is deliberately delegated
 * to the existing member helper so public lead creation and /open proof cannot
 * drift into two phone standards.
 */
export function validateSalesLeadPhone(value: string | null | undefined): SalesLeadPhoneResult {
  if (!String(value ?? '').trim()) return { ok: false, error: 'PHONE_REQUIRED' }

  const normalizedPhone = normalizeMemberPhone(value)
  if (!normalizedPhone) return { ok: false, error: 'PHONE_INVALID' }

  // E.164 permits up to 15 digits. Cambodia mobile/landline forms normalized by
  // normalizeMemberPhone are normally 10–12 digits including country code.
  if (!/^\d{10,15}$/.test(normalizedPhone)) {
    return { ok: false, error: 'PHONE_INVALID' }
  }

  if (/^(\d)\1+$/.test(normalizedPhone)) {
    return { ok: false, error: 'PHONE_INVALID' }
  }

  const subscriber = normalizedPhone.startsWith('855')
    ? normalizedPhone.slice(3)
    : normalizedPhone
  if (!subscriber || /^(\d)\1+$/.test(subscriber)) {
    return { ok: false, error: 'PHONE_INVALID' }
  }

  return { ok: true, normalizedPhone }
}

/** Constant-time comparison once both values are already canonical digits. */
export function salesLeadPhonesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}
