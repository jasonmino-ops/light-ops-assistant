import crypto from 'node:crypto'
import type { AcquisitionSourceChannel } from '@prisma/client'
import { publicUrl } from '@/lib/public-url'

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const PUBLIC_INVITE_SOURCES = new Set<AcquisitionSourceChannel>([
  'FACEBOOK',
  'TIKTOK',
  'SALES',
  'POSTER',
  'TELEGRAM',
  'OTHER',
])

export function generateAcquisitionInviteCode(): string {
  return Array.from({ length: 12 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('')
}

export function normalizeAcquisitionInviteCode(value: string | null | undefined): string {
  const code = String(value ?? '').trim().toUpperCase()
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/.test(code) ? code : ''
}

export function isPublicAcquisitionSource(value: unknown): value is AcquisitionSourceChannel {
  return typeof value === 'string' && PUBLIC_INVITE_SOURCES.has(value as AcquisitionSourceChannel)
}

export function acquisitionInviteUrl(code: string, origin?: string | null): string {
  return publicUrl(`/lead/${encodeURIComponent(code)}`, origin)
}

export function cleanInviteLabel(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}
