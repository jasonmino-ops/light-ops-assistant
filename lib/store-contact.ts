export type StoreContactInput = {
  contactPhone?: unknown
  contactTelegram?: unknown
  contactWhatsApp?: unknown
}

export type StoreContactFields = {
  contactPhone: string | null
  contactTelegram: string | null
  contactWhatsApp: string | null
}

export function cleanContactValue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function isValidContactPhone(value: string | null | undefined): boolean {
  if (!value) return true
  return /^\+?[0-9][0-9\s().-]{5,24}$/.test(value)
}

export function isValidContactTelegram(value: string | null | undefined): boolean {
  if (!value) return true
  return /^@?[A-Za-z0-9_]{5,32}$/.test(value) ||
    /^https?:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_]{5,32}\/?$/.test(value)
}

export function isValidContactWhatsApp(value: string | null | undefined): boolean {
  if (!value) return true
  return /^\+?[0-9][0-9\s().-]{6,24}$/.test(value) ||
    /^https?:\/\/(wa\.me\/[0-9]{7,20}|api\.whatsapp\.com\/send\?phone=[0-9]{7,20})/.test(value)
}

export function normalizeStoreContactInput(body: StoreContactInput): StoreContactFields {
  return {
    contactPhone: cleanContactValue(body.contactPhone) ?? null,
    contactTelegram: cleanContactValue(body.contactTelegram) ?? null,
    contactWhatsApp: cleanContactValue(body.contactWhatsApp) ?? null,
  }
}

export function validateStoreContactFields(fields: StoreContactFields): 'contactPhone' | 'contactTelegram' | 'contactWhatsApp' | null {
  if (!isValidContactPhone(fields.contactPhone)) return 'contactPhone'
  if (!isValidContactTelegram(fields.contactTelegram)) return 'contactTelegram'
  if (!isValidContactWhatsApp(fields.contactWhatsApp)) return 'contactWhatsApp'
  return null
}
