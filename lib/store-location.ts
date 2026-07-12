export type StoreLocationInput = {
  storeAddress?: unknown
  storeLat?: unknown
  storeLng?: unknown
}

export type StoreLocationFields = {
  storeAddress: string | null
  storeLat: number | null
  storeLng: number | null
  mapUrl: string | null
}

export type StoreLocationPatch = {
  storeAddress?: string | null
  storeLat?: number | null
  storeLng?: number | null
}

export type StoreLocationRow = {
  id: string
  storeAddress: string | null
  storeLat: number | null
  storeLng: number | null
}

export function cleanStoreAddress(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 500) : null
}

export function cleanStoreCoordinate(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) ? next : null
}

export function isValidStoreLat(value: number | null | undefined): boolean {
  return value == null || (value >= -90 && value <= 90)
}

export function isValidStoreLng(value: number | null | undefined): boolean {
  return value == null || (value >= -180 && value <= 180)
}

export function buildStoreMapUrl(location: { storeAddress?: string | null; storeLat?: number | null; storeLng?: number | null }): string | null {
  if (typeof location.storeLat === 'number' && typeof location.storeLng === 'number') {
    return `https://maps.google.com/?q=${location.storeLat},${location.storeLng}`
  }
  const address = location.storeAddress?.trim()
  return address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : null
}

export function emptyStoreLocation(): StoreLocationFields {
  return { storeAddress: null, storeLat: null, storeLng: null, mapUrl: null }
}

export function toStoreLocationFields(row: Omit<StoreLocationRow, 'id'>): StoreLocationFields {
  const location = {
    storeAddress: row.storeAddress ?? null,
    storeLat: typeof row.storeLat === 'number' ? row.storeLat : null,
    storeLng: typeof row.storeLng === 'number' ? row.storeLng : null,
  }
  return { ...location, mapUrl: buildStoreMapUrl(location) }
}

export function isMissingStoreLocationColumnError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; meta?: { column?: unknown } } | null
  const text = `${String(e?.code ?? '')} ${String(e?.message ?? '')} ${String(e?.meta?.column ?? '')}`
  return text.includes('P2022') ||
    text.includes('storeAddress') ||
    text.includes('storeLat') ||
    text.includes('storeLng')
}
